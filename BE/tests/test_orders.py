"""Actual authenticated order reads against disposable SQLite only."""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from jose import jwt
from sqlalchemy import event, select, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import main
import models
from test_development import request


class CustomerOrders(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="foodorder-order-read-test-")
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{Path(self.directory.name) / 'test.db'}")
        async with self.engine.begin() as connection:
            await connection.run_sync(models.Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        self.users = [uuid4() for _ in range(5)]
        self.dish = uuid4()
        async with self.sessions.begin() as db:
            db.add_all([models.User(
                id=identifier, full_name=f"Order fixture {i}", email=f"order-{i}@example.test", password_hash="unused",
                role=[models.UserRole.CUSTOMER, models.UserRole.CUSTOMER, models.UserRole.ADMIN,
                      models.UserRole.CUSTOMER, models.UserRole.SHIPPER][i],
                status=models.UserStatus.INACTIVE if i == 3 else models.UserStatus.ACTIVE,
            ) for i, identifier in enumerate(self.users)])
            db.add(models.Dish(id=self.dish, category=models.Category(name="Order fixture"), name="Món đã ngừng bán",
                               description="Fixture", base_price=99000, calories=100, spiciness_level=0,
                               is_vegetarian=False, is_available=False))
        self.own = await self.new_order(0)
        self.foreign = await self.new_order(1)
        self.recording = False
        self.statements = []

        @event.listens_for(self.engine.sync_engine, "before_cursor_execute")
        def capture(_connection, _cursor, statement, *_):
            if self.recording:
                self.statements.append(statement)

        async def dependency():
            async with self.sessions() as db:
                yield db
        main.app.dependency_overrides[main.get_db] = dependency

    async def asyncTearDown(self):
        main.app.dependency_overrides.clear()
        await self.engine.dispose()
        self.directory.cleanup()

    async def new_order(self, user=0, state=models.OrderStatus.PENDING, payment=models.PaymentStatus.UNPAID, empty=False):
        identifier = uuid4()
        async with self.sessions.begin() as db:
            order = models.Order(
                id=identifier, order_code=f"TEST-{identifier}", customer_id=self.users[user],
                delivery_address=f"Private address {user}", total_amount=20000, shipping_fee=15000,
                discount_amount=5000, final_amount=30000, order_status=state, payment_status=payment,
                payment_method=models.PaymentMethod.COD, note="Kitchen note, not a cancellation reason",
                created_at=datetime(2026, 11, 8, 9), updated_at=datetime(2026, 11, 8, 10),
            )
            if not empty:
                order.items = [models.OrderItem(id=uuid4(), dish_id=self.dish, quantity=2,
                    unit_price=10000, subtotal=20000, options_selected={"size": "L", "note": "Ít cay"})]
            db.add(order)
        return identifier

    def headers(self, user=0, token=None):
        return [(b"authorization", f"Bearer {token or main.create_access_token(str(self.users[user]))}".encode())]

    async def get(self, identifier=None, user=0, headers=None, query=""):
        self.statements = []
        self.recording = True
        try:
            result = await request("GET", f"/api/orders/{identifier or self.own}{query}",
                                   self.headers(user) if headers is None else headers)
            return result[0], result[1], json.loads(result[2])
        finally:
            self.recording = False

    async def test_owner_reads_database_status_items_prices_and_update_time(self):
        status, headers, data = await self.get()
        self.assertEqual(status, 200)
        self.assertIn(b"no-store", headers[b"cache-control"])
        self.assertEqual(data["id"], str(self.own))
        self.assertEqual(data["order_status"], "pending")
        self.assertEqual(data["updated_at"], "2026-11-08T10:00:00")
        self.assertEqual(data["final_amount"], "30000.00")
        self.assertEqual(data["items"][0]["quantity"], 2)
        self.assertEqual(data["items"][0]["unit_price"], "10000.00")
        self.assertEqual(data["items"][0]["dish_name"], "Món đã ngừng bán")
        self.assertEqual(data["items"][0]["options_selected"]["size"], "L")

    async def test_other_customers_order_is_indistinguishable_from_missing(self):
        foreign = await self.get(self.foreign)
        missing = await self.get(uuid4())
        self.assertEqual(foreign[0], 404)
        self.assertEqual(foreign[2], missing[2])
        self.assertNotIn("Private address 1", json.dumps(foreign[2]))

    async def test_client_user_id_and_customer_id_cannot_override_jwt_owner(self):
        query = f"?user_id={self.users[1]}&customer_id={self.users[1]}"
        self.assertEqual((await self.get(query=query))[0], 200)
        self.assertEqual((await self.get(self.foreign, query=f"?user_id={self.users[1]}"))[0], 404)

    async def test_missing_jwt(self):
        self.assertEqual((await self.get(headers=[]))[0], 401)

    async def test_invalid_jwt(self):
        self.assertEqual((await self.get(headers=self.headers(token="invalid-token")))[0], 401)

    async def test_expired_jwt(self):
        token = jwt.encode({"sub": str(self.users[0]), "exp": datetime.now(timezone.utc)-timedelta(seconds=5)},
                           main.SECRET_KEY, algorithm=main.ALGORITHM)
        self.assertEqual((await self.get(headers=self.headers(token=token)))[0], 401)

    async def test_forged_signature(self):
        token = jwt.encode({"sub": str(self.users[0]), "exp": datetime.now(timezone.utc)+timedelta(minutes=1)},
                           "isolated-untrusted-key", algorithm=main.ALGORITHM)
        self.assertEqual((await self.get(headers=self.headers(token=token)))[0], 401)

    async def test_unknown_authenticated_subject(self):
        token = main.create_access_token(str(uuid4()))
        self.assertEqual((await self.get(headers=self.headers(token=token)))[0], 401)

    async def test_inactive_customer(self):
        self.assertEqual((await self.get(user=3))[0], 403)

    async def test_admin_and_shipper_do_not_bypass_customer_ownership(self):
        for user in (2, 4):
            self.assertEqual((await self.get(user=user))[0], 403)

    async def test_missing_order(self):
        self.assertEqual((await self.get(uuid4()))[0], 404)

    async def test_invalid_order_uuid(self):
        self.assertEqual((await self.get("invalid-order"))[0], 422)

    async def test_all_six_model_statuses_are_read_without_mutation(self):
        for state in models.OrderStatus:
            identifier = await self.new_order(state=state)
            status, _, data = await self.get(identifier)
            self.assertEqual(status, 200)
            self.assertEqual(data["order_status"], state.value)

    async def test_refresh_reflects_fixture_status_and_updated_at_change(self):
        self.assertEqual((await self.get())[2]["order_status"], "pending")
        async with self.sessions.begin() as db:
            order = await db.get(models.Order, self.own)
            order.order_status = models.OrderStatus.PREPARING
            order.updated_at = datetime(2026, 11, 8, 11)
        data = (await self.get())[2]
        self.assertEqual(data["order_status"], "preparing")
        self.assertEqual(data["updated_at"], "2026-11-08T11:00:00")

    async def test_cancelled_order_does_not_misrepresent_customer_note_as_reason(self):
        identifier = await self.new_order(state=models.OrderStatus.CANCELLED)
        data = (await self.get(identifier))[2]
        self.assertIsNone(data["cancellation_reason"])
        self.assertNotIn("Kitchen note", json.dumps(data))

    async def test_get_cannot_set_status_or_payment_through_query(self):
        data = (await self.get(query="?order_status=completed&payment_status=paid"))[2]
        self.assertEqual((data["order_status"], data["payment_status"]), ("pending", "unpaid"))

    async def test_mutating_methods_not_allowed(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual((await request(method, f"/api/orders/{self.own}", self.headers(),
                {"order_status": "completed", "payment_status": "paid"}))[0], 405)
        self.assertEqual((await self.get())[2]["order_status"], "pending")

    async def test_completed_paid_fixture_read_never_records_purchase_or_executes_dml(self):
        identifier = await self.new_order(state=models.OrderStatus.COMPLETED, payment=models.PaymentStatus.PAID)
        self.assertEqual((await self.get(identifier))[0], 200)
        self.assertTrue(self.statements)
        self.assertTrue(all(statement.lstrip().upper().startswith("SELECT") for statement in self.statements))
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(models.UserInteraction)), 0)
            order = await db.get(models.Order, identifier)
            self.assertEqual((order.order_status, order.payment_status), (models.OrderStatus.COMPLETED, models.PaymentStatus.PAID))

    async def test_private_account_fields_are_not_exposed(self):
        data = (await self.get())[2]
        for name in ("customer_id", "shipper_id", "password_hash", "email", "access_token", "note"):
            self.assertNotIn(name, data)

    async def test_empty_items_are_returned_without_sample_substitution(self):
        identifier = await self.new_order(empty=True)
        self.assertEqual((await self.get(identifier))[2]["items"], [])

    async def test_database_failure_returns_safe_503(self):
        original = AsyncSession.execute
        async def fail_order(db, statement, *args, **kwargs):
            if any(column.get("entity") is models.Order for column in statement.column_descriptions):
                raise SQLAlchemyError("private-database-details")
            return await original(db, statement, *args, **kwargs)
        with patch.object(AsyncSession, "execute", fail_order):
            status, _, data = await self.get()
        self.assertEqual(status, 503)
        self.assertNotIn("private-database-details", json.dumps(data))
