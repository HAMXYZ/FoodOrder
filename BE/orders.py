"""Read-only customer tracking. Never completes orders or records purchases."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import models
from schemas import CustomerOrderResponse, CustomerOrderItemResponse


async def get_customer_order(db: AsyncSession, user: models.User, order_id: UUID) -> CustomerOrderResponse:
    headers = {"Cache-Control": "private, no-store"}
    if user.role != models.UserRole.CUSTOMER:
        raise HTTPException(403, "Chỉ khách hàng được tra cứu đơn của mình.", headers=headers)
    try:
        # Filter ownership in SQL before fetching items, including for known foreign IDs.
        # No flush, commit, status update, payment update or interaction recorder here.
        with db.no_autoflush:
            result = await db.execute(select(models.Order).where(
                models.Order.id == order_id, models.Order.customer_id == user.id,
            ).options(selectinload(models.Order.items).joinedload(models.OrderItem.dish)))
            order = result.scalar_one_or_none()
        if order is None:
            raise HTTPException(404, "Không tìm thấy đơn hàng của bạn.", headers=headers)
        return CustomerOrderResponse(
            id=order.id, order_code=order.order_code, order_status=order.order_status,
            delivery_address=order.delivery_address, created_at=order.created_at, updated_at=order.updated_at,
            total_amount=order.total_amount, shipping_fee=order.shipping_fee,
            discount_amount=order.discount_amount, final_amount=order.final_amount,
            payment_method=order.payment_method, payment_status=order.payment_status,
            # Order currently has no cancellation-reason column. Its note is NOT that reason.
            cancellation_reason=None,
            items=[CustomerOrderItemResponse(
                id=item.id, dish_id=item.dish_id, dish_name=item.dish.name,
                quantity=item.quantity, unit_price=item.unit_price, subtotal=item.subtotal,
                options_selected=item.options_selected,
            ) for item in sorted(order.items, key=lambda item: str(item.id))],
        )
    except SQLAlchemyError:
        raise HTTPException(503, "Chưa thể tải đơn hàng. Vui lòng thử lại.", headers=headers) from None
