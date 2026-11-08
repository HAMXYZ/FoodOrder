"""US8.1 API/constraints with real, disposable SQLite transactions, no MariaDB writes."""

import asyncio
import contextlib
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from jose import jwt
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import main
import migrate_interactions
import models
from test_development import request


class AsyncSessionFacade:
    """Execute the production statements, with separate sessions per ASGI request."""

    def __init__(self, session, barrier=None):
        self.session, self.barrier, self.waited = session, barrier, False

    async def execute(self, statement):
        result = self.session.execute(statement)
        if (self.barrier is not None and not self.waited and statement.is_select
                and statement.get_final_froms() == [models.UserInteraction.__table__]):
            self.waited = True
            # Fully consume the SQLite read cursor before yielding. A synchronous
            # open cursor would block another writer while also blocking this loop.
            result = result.freeze()()
            # Both requests see no row before either INSERT. The UNIQUE constraint,
            # not a SELECT precheck, must resolve the race.
            await self.barrier.wait()
        return result

    def add(self, value): self.session.add(value)
    async def commit(self): self.session.commit()
    async def rollback(self): self.session.rollback()
    async def refresh(self, value): self.session.refresh(value)


class InteractionFixture(unittest.IsolatedAsyncioTestCase):
    persisted_events = 0
    story = "US8.1"
    endpoint = "/api/interactions/views"

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="foodorder-interactions-test-")
        self.engine = create_engine(f"sqlite:///{Path(self.directory.name) / 'isolated.db'}")

        @event.listens_for(self.engine, "connect")
        def enforce_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        models.Base.metadata.create_all(self.engine, tables=[
            models.User.__table__, models.Category.__table__, models.Dish.__table__,
            models.Order.__table__, models.OrderItem.__table__, models.UserInteraction.__table__,
        ])
        self.user_ids = [uuid4(), uuid4()]
        self.dish_ids = [uuid4(), uuid4(), uuid4()]
        with Session(self.engine) as session:
            session.add_all([models.User(
                id=identifier, full_name=f"Isolated customer {index}",
                email=f"isolated-{index}@example.test", password_hash="unused",
                role=models.UserRole.CUSTOMER, status=models.UserStatus.ACTIVE,
            ) for index, identifier in enumerate(self.user_ids)])
            category = models.Category(name="Isolated dishes")
            session.add_all([models.Dish(
                id=identifier, category=category, name=f"Isolated dish {index}",
                description="Fixture", base_price=10000, calories=100, spiciness_level=0,
                is_vegetarian=False, is_available=index < 2,
            ) for index, identifier in enumerate(self.dish_ids)])
            session.commit()
        self.barrier = None

        async def dependency():
            with Session(self.engine, expire_on_commit=False) as session:
                yield AsyncSessionFacade(session, self.barrier)

        main.app.dependency_overrides[main.get_db] = dependency

    def tearDown(self):
        main.app.dependency_overrides.clear()
        with Session(self.engine) as session:
            type(self).persisted_events += session.scalar(select(func.count()).select_from(models.UserInteraction))
        self.engine.dispose()
        self.directory.cleanup()

    @classmethod
    def tearDownClass(cls):
        print(f"{cls.story} isolated rows persisted: {cls.persisted_events}; all temporary SQLite databases disposed.")

    def headers(self, user=0, token=None):
        token = token or main.create_access_token(str(self.user_ids[user]))
        return [(b"authorization", f"Bearer {token}".encode())]

    def payload(self, **values):
        return {"event_id": str(uuid4()), "dish_id": str(self.dish_ids[0]), **values}

    async def post(self, payload=None, user=0, headers=None, suffix=""):
        return await request("POST", self.endpoint + suffix,
                             self.headers(user) if headers is None else headers,
                             self.payload() if payload is None else payload)

    def rows(self):
        with Session(self.engine) as session:
            return [(row.event_id, row.user_id, row.dish_id, row.event_type, row.created_at)
                    for row in session.scalars(select(models.UserInteraction).order_by(models.UserInteraction.id))]


class DishViews(InteractionFixture):
    async def test_authenticated_customer_records_view_with_server_utc_timestamp(self):
        payload = self.payload()
        status, headers, body = await self.post(payload)
        self.assertEqual(status, 201)
        data = json.loads(body)
        self.assertEqual(data["event_id"], payload["event_id"])
        self.assertEqual(data["dish_id"], payload["dish_id"])
        self.assertEqual(data["event_type"], "view")
        self.assertFalse(data["duplicate"])
        self.assertNotIn("user_id", data)
        self.assertEqual(headers[b"cache-control"], b"no-store")
        timestamp = datetime.fromisoformat(data["created_at"])
        self.assertEqual(timestamp.utcoffset(), timedelta(0))
        self.assertLess(abs((datetime.now(timezone.utc) - timestamp).total_seconds()), 5)
        self.assertEqual(self.rows()[0][1], self.user_ids[0])

    async def test_missing_jwt(self):
        status, headers, _ = await self.post(headers=[])
        self.assertEqual(status, 401)
        self.assertEqual(headers[b"www-authenticate"], b"Bearer")
        self.assertEqual(self.rows(), [])

    async def test_invalid_jwt(self):
        status, _, _ = await self.post(headers=self.headers(token="invalid-token"))
        self.assertEqual(status, 401)
        self.assertEqual(self.rows(), [])

    async def test_expired_jwt(self):
        token = jwt.encode({"sub": str(self.user_ids[0]),
                            "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
                           main.SECRET_KEY, algorithm=main.ALGORITHM)
        status, _, _ = await self.post(headers=self.headers(token=token))
        self.assertEqual(status, 401)
        self.assertEqual(self.rows(), [])

    async def test_nonexistent_dish(self):
        status, _, _ = await self.post(self.payload(dish_id=str(uuid4())))
        self.assertEqual(status, 404)
        self.assertEqual(self.rows(), [])

    async def test_unavailable_dish_cannot_be_recorded_as_a_successful_detail_view(self):
        status, _, _ = await self.post(self.payload(dish_id=str(self.dish_ids[2])))
        self.assertEqual(status, 404)
        self.assertEqual(self.rows(), [])

    async def test_validates_uuids_required_fields_and_view_only(self):
        for payload in ({}, self.payload(event_id="bad-id"), self.payload(dish_id="bad-id"),
                        self.payload(event_type="add_to_cart"), self.payload(event_type=None),
                        self.payload(created_at=datetime.now(timezone.utc).isoformat())):
            with self.subTest(fields=list(payload)):
                status, _, _ = await self.post(payload)
                self.assertEqual(status, 422)
        self.assertEqual(self.rows(), [])

    async def test_explicit_view_type_is_accepted(self):
        status, _, body = await self.post(self.payload(event_type="view"))
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(body)["event_type"], "view")

    async def test_client_cannot_submit_user_id(self):
        status, _, _ = await self.post(self.payload(user_id=str(self.user_ids[1])))
        self.assertEqual(status, 422)
        self.assertEqual(self.rows(), [])

    async def test_query_user_id_does_not_override_authenticated_identity(self):
        status, _, _ = await self.post(suffix=f"?user_id={self.user_ids[1]}")
        self.assertEqual(status, 201)
        self.assertEqual(self.rows()[0][1], self.user_ids[0])

    async def test_identical_event_replay_does_not_change_row_or_timestamp(self):
        payload = self.payload()
        first_status, _, first_body = await self.post(payload)
        before = self.rows()
        second_status, _, second_body = await self.post(payload)
        self.assertEqual((first_status, second_status), (201, 200))
        self.assertTrue(json.loads(second_body)["duplicate"])
        self.assertEqual(json.loads(first_body)["created_at"], json.loads(second_body)["created_at"])
        self.assertEqual(self.rows(), before)

    async def test_different_event_ids_for_same_user_and_dish_are_distinct_views(self):
        for _ in range(2):
            self.assertEqual((await self.post())[0], 201)
        self.assertEqual(len(self.rows()), 2)
        self.assertEqual(len({row[0] for row in self.rows()}), 2)

    async def test_two_accounts_viewing_same_dish_have_separate_rows(self):
        for user in (0, 1):
            self.assertEqual((await self.post(user=user))[0], 201)
        self.assertEqual({row[1] for row in self.rows()}, set(self.user_ids))
        self.assertEqual({row[2] for row in self.rows()}, {self.dish_ids[0]})

    async def test_same_event_id_cannot_be_changed_to_another_dish(self):
        payload = self.payload()
        await self.post(payload)
        before = self.rows()
        status, _, _ = await self.post({**payload, "dish_id": str(self.dish_ids[1])})
        self.assertEqual(status, 409)
        self.assertEqual(self.rows(), before)

    async def test_another_account_cannot_reuse_or_discover_event_contents(self):
        payload = self.payload()
        await self.post(payload)
        before = self.rows()
        status, _, body = await self.post(payload, user=1)
        self.assertEqual(status, 409)
        data = json.loads(body)
        self.assertEqual(set(data), {"detail"})
        for private in (str(self.user_ids[0]), str(self.dish_ids[0]), payload["event_id"]):
            self.assertNotIn(private, data["detail"])
        self.assertEqual(self.rows(), before)

    async def test_concurrent_identical_requests_use_database_unique_constraint(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(self.post(payload), self.post(payload)), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [200, 201])
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual({json.loads(response[2])["created_at"] for response in responses},
                         {json.loads(responses[0][2])["created_at"]})

    async def test_concurrent_cross_account_collision_preserves_winner(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(self.post(payload, user=0), self.post(payload, user=1)), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [201, 409])
        winner = next(index for index, response in enumerate(responses) if response[0] == 201)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][1], self.user_ids[winner])

    async def test_concurrent_changed_payload_collision_preserves_winner(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(
            self.post(payload), self.post({**payload, "dish_id": str(self.dish_ids[1])}),
        ), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [201, 409])
        winner = next(index for index, response in enumerate(responses) if response[0] == 201)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][2], self.dish_ids[winner])

    async def test_no_public_read_update_or_delete_event_routes(self):
        payload = self.payload()
        await self.post(payload)
        before = self.rows()
        for method in ("GET", "PUT", "DELETE"):
            status, _, _ = await request(method, "/api/interactions/views", self.headers(1), payload)
            self.assertEqual(status, 405)
            status, _, _ = await request(method, f"/api/interactions/{payload['event_id']}", self.headers(1), payload)
            self.assertEqual(status, 404)
        self.assertEqual(self.rows(), before)

    async def test_inactive_account_is_rejected(self):
        with Session(self.engine) as session:
            session.get(models.User, self.user_ids[0]).status = models.UserStatus.BANNED
            session.commit()
        self.assertEqual((await self.post())[0], 403)
        self.assertEqual(self.rows(), [])

    async def test_staff_views_are_excluded_from_customer_personalization(self):
        with Session(self.engine) as session:
            session.get(models.User, self.user_ids[0]).role = models.UserRole.ADMIN
            session.commit()
        self.assertEqual((await self.post())[0], 403)
        self.assertEqual(self.rows(), [])

    async def test_foreign_keys_enforce_existing_user_and_dish(self):
        for user_id, dish_id in ((uuid4(), self.dish_ids[0]), (self.user_ids[0], uuid4())):
            with Session(self.engine) as session:
                session.add(models.UserInteraction(event_id=uuid4(), user_id=user_id,
                                                   dish_id=dish_id, event_type="view"))
                with self.assertRaises(IntegrityError): session.commit()
                session.rollback()
        self.assertEqual(self.rows(), [])

    async def test_utc_storage_round_trip_preserves_instant(self):
        local_time = datetime.now(timezone(timedelta(hours=7)))
        with Session(self.engine) as session:
            session.add(models.UserInteraction(event_id=uuid4(), user_id=self.user_ids[0],
                                               dish_id=self.dish_ids[0], event_type="view", created_at=local_time))
            session.commit()
            raw = session.execute(text("SELECT created_at FROM user_interactions")).scalar_one()
            self.assertLess(abs((datetime.fromisoformat(raw) - local_time.astimezone(timezone.utc).replace(tzinfo=None)).total_seconds()), 0.001)
        self.assertEqual(self.rows()[0][4], local_time.astimezone(timezone.utc))


class InteractionMigrationGuards(unittest.IsolatedAsyncioTestCase):
    async def test_wrong_database_is_rejected_before_connection_or_ddl(self):
        fake = SimpleNamespace(url=URL.create("mysql+asyncmy", username="foodorder_app", database="other"),
                               begin=MagicMock(), dispose=AsyncMock())
        with patch.object(migrate_interactions, "engine", fake), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(await migrate_interactions.main(apply=True), 1)
        fake.begin.assert_not_called()

    async def test_wrong_actual_database_never_reaches_schema_creation(self):
        result = MagicMock()
        result.one.return_value = ("other", "foodorder_app@localhost")
        connection = SimpleNamespace(execute=AsyncMock(return_value=result), run_sync=AsyncMock())
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=connection)
        context.__aexit__ = AsyncMock(return_value=False)
        fake = SimpleNamespace(url=URL.create("mysql+asyncmy", username="foodorder_app", database="foodorder_dev"),
                               begin=MagicMock(return_value=context), dispose=AsyncMock())
        with patch.object(migrate_interactions, "engine", fake), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(await migrate_interactions.main(apply=True), 1)
        connection.run_sync.assert_not_called()

    async def test_api_lifespan_only_pings_and_never_creates_schema(self):
        with patch.object(main, "ping_db", new=AsyncMock()) as ping, patch.object(main, "engine", SimpleNamespace(dispose=AsyncMock())):
            with patch.object(models.Base.metadata, "create_all") as create:
                with contextlib.redirect_stdout(io.StringIO()):
                    async with main.lifespan(main.app): pass
                create.assert_not_called()
                ping.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
