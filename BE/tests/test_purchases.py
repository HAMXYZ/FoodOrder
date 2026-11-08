"""Purchase behavior with actual AsyncSession transactions in disposable SQLite files.

No completed order or purchase fixture is ever inserted into MariaDB.
"""

import asyncio
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from sqlalchemy import event, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import main
import models
from purchases import (
    InvalidPurchaseSource, PurchaseOrderNotFound, PurchasePersistenceError,
    PurchaseSourceConflict, PurchaseTransactionRequired,
    purchase_event_id, record_completed_order_purchase,
)
from test_development import request


class RacingSession(AsyncSession):
    def __init__(self, *args, barrier=None, arrivals=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.barrier, self.arrivals, self.waited = barrier, arrivals, False

    async def execute(self, statement, *args, **kwargs):
        result = await super().execute(statement, *args, **kwargs)
        if (self.barrier is not None and not self.waited and statement.is_select
                and statement.get_final_froms() == [models.UserInteraction.__table__]):
            self.waited = True
            result = result.freeze()()
            self.arrivals.append(1)
            await self.barrier.wait()
        return result


class Purchases(unittest.IsolatedAsyncioTestCase):
    persisted_purchases = 0

    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="foodorder-purchase-test-")
        self.engine = create_async_engine(
            f"sqlite+aiosqlite:///{Path(self.directory.name) / 'isolated.db'}",
            connect_args={"timeout": 0.2},
        )

        @event.listens_for(self.engine.sync_engine, "connect")
        def connection_settings(connection, _):
            # Explicit BEGIN is essential: legacy sqlite3 otherwise releases an
            # outermost SAVEPOINT as a commit, invalidating rollback assertions.
            connection.isolation_level = None
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

        @event.listens_for(self.engine.sync_engine, "begin")
        def explicit_begin(connection):
            connection.exec_driver_sql("BEGIN")

        async with self.engine.begin() as connection:
            await connection.run_sync(models.Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        self.user_ids, self.dish_ids = [uuid4(), uuid4()], [uuid4(), uuid4()]
        async with self.sessions.begin() as db:
            db.add_all([models.User(
                id=identifier, full_name=f"Purchase customer {index}",
                email=f"purchase-{index}@example.test", password_hash="unused",
                role=models.UserRole.CUSTOMER, status=models.UserStatus.ACTIVE,
            ) for index, identifier in enumerate(self.user_ids)])
            category = models.Category(name="Purchase fixture")
            db.add_all([models.Dish(
                id=identifier, category=category, name=f"Purchase dish {index}", description="Fixture",
                base_price=10000, calories=100, spiciness_level=0, is_vegetarian=False, is_available=True,
            ) for index, identifier in enumerate(self.dish_ids)])

        async def dependency():
            async with self.sessions() as db:
                yield db

        main.app.dependency_overrides[main.get_db] = dependency

    async def asyncTearDown(self):
        main.app.dependency_overrides.clear()
        async with self.sessions() as db:
            type(self).persisted_purchases += await db.scalar(select(func.count()).select_from(
                models.UserInteraction
            ).where(models.UserInteraction.event_type == "purchase"))
        await self.engine.dispose()
        self.directory.cleanup()

    @classmethod
    def tearDownClass(cls):
        print(f"US8.3 isolated purchase rows retained at teardown: {cls.persisted_purchases}; SQLite fixtures disposed; no MariaDB purchase writes.")

    async def new_order(self, status=models.OrderStatus.COMPLETED,
                        payment=models.PaymentStatus.PAID, quantities=(1, 3), user=0, same_dish=False):
        identifier = uuid4()
        item_ids = [uuid4() for _ in quantities]
        total = sum((Decimal("10000") * quantity for quantity in quantities), Decimal(0))
        async with self.sessions.begin() as db:
            order = models.Order(
                id=identifier, order_code=f"TEST-{identifier}", customer_id=self.user_ids[user],
                delivery_address="Isolated test address", total_amount=total, shipping_fee=0,
                discount_amount=0, final_amount=total, order_status=status,
                payment_method=models.PaymentMethod.COD, payment_status=payment,
            )
            order.items = [models.OrderItem(
                id=item_id, dish_id=self.dish_ids[0 if same_dish else index % len(self.dish_ids)],
                quantity=quantity, unit_price=10000, options_selected={}, subtotal=10000 * quantity,
            ) for index, (item_id, quantity) in enumerate(zip(item_ids, quantities))]
            db.add(order)
        return identifier, item_ids

    async def record(self, identifier):
        async with self.sessions.begin() as db:
            return await record_completed_order_purchase(db, identifier)

    async def rows(self):
        async with self.sessions() as db:
            result = await db.execute(select(models.UserInteraction.__table__).order_by(models.UserInteraction.id))
            return [dict(row) for row in result.mappings()]

    async def state(self, identifier):
        async with self.sessions() as db:
            return (await db.execute(select(models.Order.order_status, models.Order.payment_status).where(
                models.Order.id == identifier
            ))).one()

    async def test_transition_to_completed_and_paid_records_purchase_in_same_transaction(self):
        identifier, item_ids = await self.new_order(models.OrderStatus.PREPARING, models.PaymentStatus.UNPAID)
        async with self.sessions.begin() as db:
            order = await db.get(models.Order, identifier, with_for_update=True)
            order.order_status, order.payment_status = models.OrderStatus.COMPLETED, models.PaymentStatus.PAID
            await db.flush()
            result = await record_completed_order_purchase(db, identifier)
            self.assertEqual(result.created_count, 2)
        rows = await self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["order_item_id"] for row in rows}, set(item_ids))
        self.assertTrue(all(row["user_id"] == self.user_ids[0] and row["order_id"] == identifier for row in rows))
        self.assertEqual((await self.state(identifier)).order_status, models.OrderStatus.COMPLETED)

    async def test_pending_order_never_records_purchase(self):
        identifier, _ = await self.new_order(models.OrderStatus.PENDING)
        self.assertFalse((await self.record(identifier)).eligible)
        self.assertEqual(await self.rows(), [])

    async def test_preparing_order_never_records_purchase(self):
        identifier, _ = await self.new_order(models.OrderStatus.PREPARING)
        self.assertFalse((await self.record(identifier)).eligible)
        self.assertEqual(await self.rows(), [])

    async def test_cancelled_order_never_records_purchase(self):
        identifier, _ = await self.new_order(models.OrderStatus.CANCELLED)
        self.assertFalse((await self.record(identifier)).eligible)
        self.assertEqual(await self.rows(), [])

    async def test_other_non_completed_states_never_record_purchase(self):
        for status in (models.OrderStatus.CONFIRMED, models.OrderStatus.DELIVERING):
            identifier, _ = await self.new_order(status)
            self.assertEqual((await self.record(identifier)).skipped_reason, "order_not_completed")
        self.assertEqual(await self.rows(), [])

    async def test_completed_but_unpaid_order_never_records_purchase(self):
        identifier, _ = await self.new_order(payment=models.PaymentStatus.UNPAID)
        self.assertEqual((await self.record(identifier)).skipped_reason, "payment_not_paid")
        self.assertEqual(await self.rows(), [])

    async def test_refunded_order_never_records_a_new_purchase(self):
        identifier, _ = await self.new_order(payment=models.PaymentStatus.REFUNDED)
        self.assertFalse((await self.record(identifier)).eligible)
        self.assertEqual(await self.rows(), [])

    async def test_multiple_items_map_to_their_actual_dishes_and_sources(self):
        identifier, item_ids = await self.new_order(quantities=(1, 2))
        result = await self.record(identifier)
        self.assertEqual(result.created_count, 2)
        rows = {row["order_item_id"]: row for row in await self.rows()}
        for index, item_id in enumerate(item_ids):
            self.assertEqual(rows[item_id]["dish_id"], self.dish_ids[index])
            self.assertEqual(rows[item_id]["quantity"], index + 1)
            self.assertEqual(rows[item_id]["event_type"], "purchase")

    async def test_quantity_three_is_one_event_carrying_quantity_three(self):
        identifier, item_ids = await self.new_order(quantities=(3,))
        self.assertEqual((await self.record(identifier)).created_count, 1)
        rows = await self.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["quantity"], 3)
        self.assertEqual(rows[0]["event_id"], purchase_event_id(item_ids[0]))
        self.assertEqual(rows[0]["created_at"].utcoffset().total_seconds(), 0)

    async def test_separate_lines_of_same_dish_remain_separate_source_events(self):
        identifier, item_ids = await self.new_order(quantities=(1, 3), same_dish=True)
        await self.record(identifier)
        rows = await self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["dish_id"] for row in rows}, {self.dish_ids[0]})
        self.assertEqual({row["order_item_id"] for row in rows}, set(item_ids))

    async def test_repeated_completed_order_call_preserves_ids_quantities_and_timestamps(self):
        identifier, _ = await self.new_order()
        first = await self.record(identifier)
        original = await self.rows()
        repeated = await self.record(identifier)
        self.assertEqual((repeated.created_count, repeated.duplicate_count), (0, 2))
        self.assertEqual(repeated.event_ids, first.event_ids)
        self.assertEqual(await self.rows(), original)

    async def test_two_calls_inside_same_outer_transaction_are_idempotent(self):
        identifier, _ = await self.new_order()
        async with self.sessions.begin() as db:
            self.assertEqual((await record_completed_order_purchase(db, identifier)).created_count, 2)
            self.assertEqual((await record_completed_order_purchase(db, identifier)).duplicate_count, 2)
        self.assertEqual(len(await self.rows()), 2)

    async def test_concurrent_workers_on_same_order_do_not_duplicate_and_can_retry(self):
        identifier, _ = await self.new_order()
        barrier, arrivals = asyncio.Barrier(2), []

        async def worker():
            for attempt in range(4):
                try:
                    async with RacingSession(bind=self.engine, expire_on_commit=False, autoflush=False,
                                             barrier=barrier if attempt == 0 else None, arrivals=arrivals) as db:
                        async with db.begin():
                            return await record_completed_order_purchase(db, identifier)
                except PurchasePersistenceError as error:
                    if not error.retryable or attempt == 3:
                        raise
                    await asyncio.sleep(0.02 * (attempt + 1))

        results = await asyncio.wait_for(asyncio.gather(worker(), worker()), timeout=10)
        self.assertEqual(len(arrivals), 2)  # Both first attempts read before either INSERT.
        self.assertEqual(sum(result.created_count for result in results), 2)
        self.assertEqual(sum(result.duplicate_count for result in results), 2)
        self.assertEqual(len(await self.rows()), 2)

    async def test_two_customers_orders_never_mix_ownership(self):
        first, _ = await self.new_order(quantities=(1,), user=0)
        second, _ = await self.new_order(quantities=(3,), user=1)
        await self.record(first)
        await self.record(second)
        rows = {row["order_id"]: row for row in await self.rows()}
        self.assertEqual(rows[first]["user_id"], self.user_ids[0])
        self.assertEqual(rows[second]["user_id"], self.user_ids[1])

    async def test_customer_cannot_submit_forged_purchase_through_existing_endpoints(self):
        identifier, item_ids = await self.new_order(user=1)
        headers = [(b"authorization", f"Bearer {main.create_access_token(str(self.user_ids[0]))}".encode())]
        for path in ("/api/interactions/views", "/api/interactions/add-to-cart"):
            status, _, _ = await request("POST", path, headers, {
                "event_id": str(uuid4()), "dish_id": str(self.dish_ids[0]), "event_type": "purchase",
                "user_id": str(self.user_ids[1]), "order_id": str(identifier), "order_item_id": str(item_ids[0]),
            })
            self.assertEqual(status, 422)
        self.assertEqual(await self.rows(), [])

    async def test_no_public_purchase_or_customer_completion_endpoint_exists(self):
        identifier, _ = await self.new_order(models.OrderStatus.PENDING)
        headers = [(b"authorization", f"Bearer {main.create_access_token(str(self.user_ids[0]))}".encode())]
        for path in ("/api/interactions/purchase", "/api/interactions/purchases",
                     f"/api/orders/{identifier}/complete", f"/api/admin/orders/{identifier}/status"):
            self.assertEqual((await request("POST", path, headers, {"order_status": "completed"}))[0], 404)
        self.assertEqual((await self.state(identifier)).order_status, models.OrderStatus.PENDING)
        self.assertEqual(await self.rows(), [])

    async def test_outer_status_transaction_rollback_removes_all_staged_purchases(self):
        identifier, _ = await self.new_order(models.OrderStatus.PREPARING, models.PaymentStatus.UNPAID)
        with self.assertRaisesRegex(RuntimeError, "force outer rollback"):
            async with self.sessions.begin() as db:
                order = await db.get(models.Order, identifier)
                order.order_status, order.payment_status = models.OrderStatus.COMPLETED, models.PaymentStatus.PAID
                await db.flush()
                self.assertEqual((await record_completed_order_purchase(db, identifier)).created_count, 2)
                raise RuntimeError("force outer rollback")
        self.assertEqual(await self.rows(), [])
        self.assertEqual(tuple(await self.state(identifier)), (models.OrderStatus.PREPARING, models.PaymentStatus.UNPAID))

    async def test_failed_status_flush_cannot_create_any_purchase(self):
        identifier, _ = await self.new_order(models.OrderStatus.PREPARING, models.PaymentStatus.UNPAID)
        reached_recorder = False
        with self.assertRaises(IntegrityError):
            async with self.sessions.begin() as db:
                order = await db.get(models.Order, identifier)
                order.order_status, order.payment_status, order.order_code = models.OrderStatus.COMPLETED, models.PaymentStatus.PAID, None
                await db.flush()
                reached_recorder = True
                await record_completed_order_purchase(db, identifier)
        self.assertFalse(reached_recorder)
        self.assertEqual(await self.rows(), [])
        self.assertEqual((await self.state(identifier)).order_status, models.OrderStatus.PREPARING)

    async def test_service_never_commits_the_callers_outer_transaction(self):
        identifier, _ = await self.new_order()
        async with self.sessions() as db:
            transaction = await db.begin()
            await record_completed_order_purchase(db, identifier)
            self.assertEqual(await self.rows(), [])  # Separate connection cannot see uncommitted rows.
            await transaction.rollback()
        self.assertEqual(await self.rows(), [])

    async def test_batch_insert_failure_rolls_back_status_and_all_events_then_recovers(self):
        identifier, item_ids = await self.new_order(models.OrderStatus.PREPARING, models.PaymentStatus.UNPAID)
        last_item = max(item_ids, key=str)
        async with self.engine.begin() as connection:
            await connection.exec_driver_sql("CREATE TABLE isolated_failure_switch (enabled INTEGER NOT NULL)")
            await connection.exec_driver_sql("INSERT INTO isolated_failure_switch VALUES (1)")
            await connection.exec_driver_sql(f"""
CREATE TRIGGER isolated_purchase_failure BEFORE INSERT ON user_interactions
WHEN NEW.event_type = 'purchase' AND NEW.order_item_id = '{last_item}'
 AND (SELECT enabled FROM isolated_failure_switch) = 1
BEGIN SELECT RAISE(ABORT, 'isolated insert failure'); END
""")

        async def complete():
            async with self.sessions.begin() as db:
                order = await db.get(models.Order, identifier)
                order.order_status, order.payment_status = models.OrderStatus.COMPLETED, models.PaymentStatus.PAID
                await db.flush()
                return await record_completed_order_purchase(db, identifier)

        with self.assertRaises(PurchasePersistenceError):
            await complete()
        self.assertEqual(await self.rows(), [])
        self.assertEqual((await self.state(identifier)).order_status, models.OrderStatus.PREPARING)
        async with self.engine.begin() as connection:
            await connection.exec_driver_sql("UPDATE isolated_failure_switch SET enabled = 0")
        self.assertEqual((await complete()).created_count, 2)
        self.assertEqual((await self.record(identifier)).duplicate_count, 2)

    async def test_invalid_quantity_aborts_the_entire_batch_before_inserting(self):
        identifier, _ = await self.new_order(quantities=(1, 0))
        with self.assertRaises(InvalidPurchaseSource): await self.record(identifier)
        self.assertEqual(await self.rows(), [])

    async def test_completed_order_without_lines_is_invalid(self):
        identifier, _ = await self.new_order(quantities=())
        with self.assertRaises(InvalidPurchaseSource): await self.record(identifier)
        self.assertEqual(await self.rows(), [])

    async def test_existing_purchase_with_wrong_owner_is_not_overwritten(self):
        identifier, item_ids = await self.new_order()
        async with self.sessions.begin() as db:
            db.add(models.UserInteraction(event_id=uuid4(), user_id=self.user_ids[1], dish_id=self.dish_ids[0],
                event_type="purchase", order_id=identifier, order_item_id=item_ids[0], quantity=1))
        original = await self.rows()
        with self.assertRaises(PurchaseSourceConflict): await self.record(identifier)
        self.assertEqual(await self.rows(), original)

    async def test_source_quantity_changed_after_purchase_is_a_conflict_not_an_update(self):
        identifier, item_ids = await self.new_order(quantities=(1,))
        await self.record(identifier)
        original = await self.rows()
        async with self.sessions.begin() as db:
            (await db.get(models.OrderItem, item_ids[0])).quantity = 2
        with self.assertRaises(PurchaseSourceConflict): await self.record(identifier)
        self.assertEqual(await self.rows(), original)

    async def test_past_purchase_still_records_if_dish_is_now_unavailable(self):
        identifier, _ = await self.new_order(quantities=(1,))
        async with self.sessions.begin() as db:
            (await db.get(models.Dish, self.dish_ids[0])).is_available = False
        self.assertEqual((await self.record(identifier)).created_count, 1)

    async def test_database_unique_source_prevents_new_uuid_for_same_purchase_line(self):
        identifier, item_ids = await self.new_order(quantities=(1,))
        await self.record(identifier)
        with self.assertRaises(IntegrityError) as failure:
            async with self.sessions.begin() as db:
                db.add(models.UserInteraction(event_id=uuid4(), user_id=self.user_ids[0], dish_id=self.dish_ids[0],
                    event_type="purchase", order_id=identifier, order_item_id=item_ids[0], quantity=1))
        self.assertIn("UNIQUE constraint failed", str(failure.exception.orig))
        self.assertEqual(len(await self.rows()), 1)

    async def test_database_check_rejects_untraceable_purchase(self):
        with self.assertRaises(IntegrityError) as failure:
            async with self.sessions.begin() as db:
                db.add(models.UserInteraction(event_id=uuid4(), user_id=self.user_ids[0],
                    dish_id=self.dish_ids[0], event_type="purchase"))
        self.assertIn("CHECK constraint failed", str(failure.exception.orig))
        self.assertEqual(await self.rows(), [])

    async def test_database_check_rejects_zero_purchase_quantity(self):
        identifier, item_ids = await self.new_order(quantities=(1,))
        with self.assertRaises(IntegrityError) as failure:
            async with self.sessions.begin() as db:
                db.add(models.UserInteraction(event_id=uuid4(), user_id=self.user_ids[0], dish_id=self.dish_ids[0],
                    event_type="purchase", order_id=identifier, order_item_id=item_ids[0], quantity=0))
        self.assertIn("CHECK constraint failed", str(failure.exception.orig))
        self.assertEqual(await self.rows(), [])

    async def test_database_source_foreign_keys_reject_unknown_orders_and_lines(self):
        identifier, item_ids = await self.new_order(quantities=(1,))
        for order_id, item_id in ((uuid4(), item_ids[0]), (identifier, uuid4())):
            with self.assertRaises(IntegrityError) as failure:
                async with self.sessions.begin() as db:
                    db.add(models.UserInteraction(event_id=uuid4(), user_id=self.user_ids[0], dish_id=self.dish_ids[0],
                        event_type="purchase", order_id=order_id, order_item_id=item_id, quantity=1))
            self.assertIn("FOREIGN KEY constraint failed", str(failure.exception.orig))
        self.assertEqual(await self.rows(), [])

    async def test_payment_confirmation_later_allows_safe_recovery(self):
        identifier, _ = await self.new_order(payment=models.PaymentStatus.UNPAID, quantities=(1,))
        self.assertFalse((await self.record(identifier)).eligible)
        async with self.sessions.begin() as db:
            (await db.get(models.Order, identifier)).payment_status = models.PaymentStatus.PAID
            await db.flush()
            self.assertEqual((await record_completed_order_purchase(db, identifier)).created_count, 1)
        self.assertEqual((await self.record(identifier)).duplicate_count, 1)

    async def test_recovery_fills_missing_lines_using_source_key_not_random_event_id(self):
        identifier, item_ids = await self.new_order()
        existing_id = uuid4()  # A valid older writer may have used a different UUID scheme.
        async with self.sessions.begin() as db:
            db.add(models.UserInteraction(event_id=existing_id, user_id=self.user_ids[0], dish_id=self.dish_ids[0],
                event_type="purchase", order_id=identifier, order_item_id=item_ids[0], quantity=1))
        original = (await self.rows())[0]
        result = await self.record(identifier)
        self.assertEqual((result.created_count, result.duplicate_count), (1, 1))
        self.assertIn(existing_id, result.event_ids)
        self.assertEqual((await self.rows())[0], original)

    async def test_active_outer_transaction_is_required(self):
        identifier, _ = await self.new_order()
        async with self.sessions() as db:
            with self.assertRaises(PurchaseTransactionRequired):
                await record_completed_order_purchase(db, identifier)
        self.assertEqual(await self.rows(), [])

    async def test_unknown_order_cannot_record_purchase(self):
        with self.assertRaises(PurchaseOrderNotFound): await self.record(uuid4())
        self.assertEqual(await self.rows(), [])

    async def test_event_uuid_collision_with_view_cannot_overwrite_the_view(self):
        identifier, item_ids = await self.new_order(quantities=(1,))
        async with self.sessions.begin() as db:
            db.add(models.UserInteraction(event_id=purchase_event_id(item_ids[0]), user_id=self.user_ids[0],
                dish_id=self.dish_ids[0], event_type="view"))
        original = await self.rows()
        with self.assertRaises(PurchaseSourceConflict): await self.record(identifier)
        self.assertEqual(await self.rows(), original)


if __name__ == "__main__":
    unittest.main()
