"""Internal purchase recording for a real, authorized order completion transaction.

This module never changes order status, trusts no client user/dish IDs, and never
commits the caller's transaction. There is deliberately no public purchase API.
"""

from dataclasses import dataclass
from uuid import UUID, uuid5

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

import models

# Stable namespace: a line has one purchase event even when jobs/requests retry.
PURCHASE_NAMESPACE = UUID("99181f0b-a41e-43d2-9c7c-37fe49beb6a3")


class PurchaseError(RuntimeError):
    """Safe domain error, with no SQL, connection string or credentials."""


class PurchaseTransactionRequired(PurchaseError):
    pass


class PurchaseOrderNotFound(PurchaseError):
    pass


class InvalidPurchaseSource(PurchaseError):
    pass


class PurchaseSourceConflict(PurchaseError):
    pass


class PurchasePersistenceError(PurchaseError):
    def __init__(self, retryable: bool):
        super().__init__("Khong the ghi purchase; rollback giao dich va xu ly lai sau khi kiem tra loi.")
        self.retryable = retryable


@dataclass(frozen=True)
class PurchaseResult:
    order_id: UUID
    eligible: bool
    created_count: int = 0
    duplicate_count: int = 0
    event_ids: tuple[UUID, ...] = ()
    skipped_reason: str | None = None


def purchase_event_id(order_item_id: UUID) -> UUID:
    return uuid5(PURCHASE_NAMESPACE, str(order_item_id))


def retryable_database_error(error: SQLAlchemyError) -> bool:
    original = getattr(error, "orig", None)
    args = getattr(original, "args", ())
    code = args[0] if args and isinstance(args[0], int) else None
    sqlite_code = getattr(original, "sqlite_errorcode", 0)
    return (isinstance(error, OperationalError) or code in (1062, 1205, 1213)
            or sqlite_code in (5, 6, 517, 2067))


async def record_completed_order_purchase(db: AsyncSession, order_id: UUID) -> PurchaseResult:
    """Stage one purchase per order_item inside the caller's transaction.

    Flush the genuine completion/payment updates before calling. The outer
    transaction must commit BOTH status and purchases, or roll back BOTH on error.
    The savepoint prevents partial purchase batches if an insert fails. A caller
    must propagate errors; retry a transient error in a fresh outer transaction.
    """
    if not db.in_transaction():
        raise PurchaseTransactionRequired("Purchase can giao dich ben ngoai; service khong tu commit.")
    order_id = UUID(str(order_id))
    try:
        async with db.begin_nested():
            # Column reads use persisted state, not a cached ORM status. FOR UPDATE
            # serializes workers on MariaDB and uses a current read at REPEATABLE READ.
            order = (await db.execute(select(
                models.Order.id, models.Order.customer_id,
                models.Order.order_status, models.Order.payment_status,
            ).where(models.Order.id == order_id).with_for_update())).one_or_none()
            if order is None:
                raise PurchaseOrderNotFound("Khong tim thay don hang.")
            if order.order_status != models.OrderStatus.COMPLETED:
                return PurchaseResult(order_id, False, skipped_reason="order_not_completed")
            if order.payment_status != models.PaymentStatus.PAID:
                return PurchaseResult(order_id, False, skipped_reason="payment_not_paid")
            items = (await db.execute(select(
                models.OrderItem.id, models.OrderItem.order_id,
                models.OrderItem.dish_id, models.OrderItem.quantity,
            ).where(models.OrderItem.order_id == order_id).order_by(models.OrderItem.id).with_for_update())).all()
            if not items or any(
                item.dish_id is None or not isinstance(item.quantity, int) or item.quantity <= 0
                for item in items
            ):
                raise InvalidPurchaseSource("Don hoan thanh phai co dong hang hop le va so luong duong.")
            # No availability filter: a genuine purchase remains valid if a dish
            # subsequently goes off sale. Source FKs guarantee user/dish existence.
            source = {item.id: item for item in items}
            expected_ids = {purchase_event_id(item.id): item.id for item in items}
            existing = (await db.execute(select(models.UserInteraction).where(or_(
                and_(models.UserInteraction.event_type == "purchase",
                     models.UserInteraction.order_item_id.in_(list(source))),
                models.UserInteraction.event_id.in_(list(expected_ids)),
            )).order_by(models.UserInteraction.id).with_for_update())).scalars().all()
            events = {}
            for event in existing:
                item = source.get(event.order_item_id)
                if (item is None or event.event_type != "purchase" or event.order_id != order_id
                        or event.user_id != order.customer_id or event.dish_id != item.dish_id
                        or event.quantity != item.quantity
                        or expected_ids.get(event.event_id, item.id) != item.id):
                    raise PurchaseSourceConflict("Nguon purchase da ton tai voi noi dung khac; khong ghi de.")
                events[item.id] = event.event_id
            duplicates = len(events)
            additions = []
            for item in items:
                if item.id in events:
                    continue
                identifier = purchase_event_id(item.id)
                additions.append(models.UserInteraction(
                    event_id=identifier, user_id=order.customer_id, dish_id=item.dish_id,
                    event_type="purchase", order_id=order_id, order_item_id=item.id,
                    quantity=item.quantity,
                ))
                events[item.id] = identifier
            db.add_all(additions)
            await db.flush()
            return PurchaseResult(order_id, True, len(additions), duplicates,
                                  tuple(events[item.id] for item in items))
    except SQLAlchemyError as error:
        # Never turn a database error into a reported successful purchase. No raw
        # SQL is exposed. The caller can retry the WHOLE transaction if appropriate.
        raise PurchasePersistenceError(retryable_database_error(error)) from None
