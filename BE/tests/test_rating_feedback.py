"""US8.4 verified sources, revision replacement and persistence, SQLite only."""

import asyncio
import hashlib
import json
import tempfile
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from jose import jwt
from sqlalchemy import event, insert, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import main
import models
from rating_feedback import (
    feedback_metadata, rating_feedback_versions as feedback, normalize_stars,
    record_verified_rating, current_rating_signals, RatingSourceAdapter,
    RatingAuthorizationError, RatingRevisionConflict, RatingSourceUnavailable,
    InvalidRatingSource, RatingTransactionRequired, RatingPersistenceError,
)
from rating_fixtures import PersistedReviewAdapter, source_metadata, reviews
from test_development import request


class RacingSession(AsyncSession):
    def __init__(self, *args, barrier, **kwargs):
        super().__init__(*args, **kwargs)
        self.barrier = barrier

    async def execute(self, statement, *args, **kwargs):
        if getattr(statement, "is_insert", False) and statement.table is feedback:
            await self.barrier.wait()
        return await super().execute(statement, *args, **kwargs)


class RatingFeedback(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="foodorder-rating-isolated-")
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{Path(self.directory.name) / 'test.db'}",
                                          connect_args={"timeout": 0.2})

        @event.listens_for(self.engine.sync_engine, "connect")
        def settings(connection, _):
            connection.isolation_level = None
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

        @event.listens_for(self.engine.sync_engine, "begin")
        def begin(connection):
            connection.exec_driver_sql("BEGIN")

        async with self.engine.begin() as c:
            await c.run_sync(models.Base.metadata.create_all)
            await c.run_sync(source_metadata.create_all)
            await c.run_sync(feedback_metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)
        self.users, self.dishes = [uuid4() for _ in range(4)], [uuid4(), uuid4()]
        self.orders = [uuid4(), uuid4()]
        self.items = [[uuid4(), uuid4()], [uuid4(), uuid4()]]
        self.source = PersistedReviewAdapter()
        async with self.sessions.begin() as db:
            db.add_all([models.User(id=uid, full_name=f"Rating fixture {i}", email=f"rating-{i}@example.test",
                password_hash="unused", role=models.UserRole.ADMIN if i == 2 else models.UserRole.CUSTOMER,
                status=models.UserStatus.INACTIVE if i == 3 else models.UserStatus.ACTIVE)
                for i, uid in enumerate(self.users)])
            category = models.Category(name="Rating fixture")
            db.add_all([models.Dish(id=did, category=category, name=f"Rating dish {i}", description="Fixture",
                base_price=10000, calories=100, spiciness_level=0, is_vegetarian=False, is_available=bool(i))
                for i, did in enumerate(self.dishes)])
            await db.flush()
            for user in range(2):
                order = models.Order(id=self.orders[user], order_code=f"ISOLATED-{user}", customer_id=self.users[user],
                    delivery_address="Isolated fixture", total_amount=40000, shipping_fee=0, discount_amount=0,
                    final_amount=40000, payment_method=models.PaymentMethod.COD, payment_status=models.PaymentStatus.PAID,
                    order_status=models.OrderStatus.COMPLETED)
                order.items = [models.OrderItem(id=self.items[user][i], dish_id=did, quantity=2, unit_price=10000,
                    subtotal=20000, options_selected={}) for i, did in enumerate(self.dishes)]
                db.add(order)
            await db.flush()
            db.add_all([models.UserInteraction(event_id=uuid4(), user_id=self.users[0], dish_id=self.dishes[0],
                event_type=kind, **({"order_id": self.orders[0], "order_item_id": self.items[0][0], "quantity": 2}
                                  if kind == "purchase" else {})) for kind in ("view", "add_to_cart", "purchase")])

        async def dependency():
            async with self.sessions() as db:
                yield db
        main.app.dependency_overrides[main.get_db] = dependency

    async def asyncTearDown(self):
        main.app.dependency_overrides.clear()
        await self.engine.dispose()
        self.directory.cleanup()

    async def new_source(self, user=0, **changes):
        data = dict(source_id=str(uuid4()), user_id=self.users[user], dish_id=self.dishes[0],
                    order_item_id=self.items[user][0], rating=3, revision=1, status="published",
                    updated_at=datetime(2026, 11, 8, 10, tzinfo=timezone.utc))
        data.update(changes)
        async with self.sessions.begin() as db:
            await db.execute(insert(reviews).values(**data))
        return data["source_id"]

    async def edit(self, sid, **changes):
        async with self.sessions.begin() as db:
            await db.execute(update(reviews).where(reviews.c.source_id == sid).values(**changes))

    async def write(self, sid, user=0, adapter=None):
        async with self.sessions.begin() as db:
            actor = await db.get(models.User, self.users[user]) if user is not None else None
            return await record_verified_rating(db, sid, actor, source=adapter or self.source)

    async def rows(self):
        async with self.sessions() as db:
            return (await db.execute(select(feedback).order_by(feedback.c.source_revision, feedback.c.source_id))).mappings().all()

    async def current(self, adapter=None):
        async with self.sessions() as db:
            return await current_rating_signals(db, source=adapter or self.source)

    async def base_digest(self):
        async with self.sessions() as db:
            data = {}
            for table in models.Base.metadata.sorted_tables:
                rows = (await db.execute(select(table).order_by(*table.primary_key.columns))).all()
                data[table.name] = hashlib.sha256(json.dumps([list(row) for row in rows], default=str).encode()).hexdigest()
            return data

    async def test_scores_one_to_five_remain_raw_and_have_no_reward_field(self):
        for rating in range(1, 6):
            result = await self.write(await self.new_source(rating=rating))
            self.assertEqual(result.signal.rating, rating)
            self.assertEqual(result.signal.rating_scale, (1, 5))
            self.assertEqual(result.signal.schema_version, 1)
            self.assertFalse(hasattr(result.signal, "reward"))
        self.assertEqual(len(await self.current()), 5)

    async def test_invalid_values_are_never_coerced_into_stars(self):
        for rating in (0, -1, 6, 3.0, 1.5, "5", None, True, False, float("nan"), float("inf")):
            with self.assertRaises(InvalidRatingSource):
                normalize_stars(rating)

    async def test_missing_production_adapter_and_client_verified_flag_fail_closed(self):
        async with self.sessions.begin() as db:
            user = await db.get(models.User, self.users[0])
            for source in (None, {"verified": True, "rating": 5}):
                with self.assertRaises(RatingSourceUnavailable):
                    await record_verified_rating(db, "anything", user, source=source)
            with self.assertRaises(RatingSourceUnavailable):
                await current_rating_signals(db)
        self.assertEqual(await self.rows(), [])
        self.assertNotIn(feedback.name, models.Base.metadata.tables)
        self.assertEqual(len(models.Base.metadata.tables), 9)

    async def test_missing_source(self):
        with self.assertRaises(InvalidRatingSource):
            await self.write(str(uuid4()))
        self.assertEqual(await self.rows(), [])

    async def test_pending_or_removed_reviews_are_not_feedback(self):
        for status in ("pending", "removed", "client-verified"):
            with self.assertRaises(InvalidRatingSource):
                await self.write(await self.new_source(status=status))
        self.assertEqual(await self.rows(), [])

    async def test_invalid_persisted_stars_and_revision(self):
        for changes in ({"rating": 0}, {"rating": 6}, {"rating": 3.5}, {"revision": 0}, {"revision": -1}):
            with self.assertRaises(InvalidRatingSource):
                await self.write(await self.new_source(**changes))
        self.assertEqual(await self.rows(), [])

    async def test_broken_adapter_cannot_claim_invalid_identity_timestamp_or_revision(self):
        sid = await self.new_source()
        class BrokenAdapter(PersistedReviewAdapter):
            async def load_for_update(adapter, db, source_id):
                record = await super().load_for_update(db, source_id)
                return replace(record, **adapter.changes)
        adapter = BrokenAdapter()
        for changes in ({"rating": True}, {"revision": 1.0}, {"user_id": "not-a-uuid"},
                        {"updated_at": datetime(2026, 11, 8)}):
            adapter.changes = changes
            with self.assertRaises(InvalidRatingSource):
                await self.write(sid, adapter=adapter)
        adapter.namespace = None
        with self.assertRaises(InvalidRatingSource):
            await self.write(sid, adapter=adapter)
        self.assertEqual(await self.rows(), [])

    async def test_missing_authenticated_actor(self):
        with self.assertRaises(RatingAuthorizationError):
            await self.write(await self.new_source(), user=None)

    async def test_forged_actor_cannot_claim_another_source(self):
        with self.assertRaises(RatingAuthorizationError):
            await self.write(await self.new_source(user=1), user=0)
        self.assertEqual(await self.rows(), [])

    async def test_inactive_and_admin_owners_are_rejected(self):
        for user in (2, 3):
            sid = await self.new_source(user_id=self.users[user])
            with self.assertRaises(RatingAuthorizationError):
                await self.write(sid, user=user)

    async def test_review_without_purchase_reference(self):
        with self.assertRaises(InvalidRatingSource):
            await self.write(await self.new_source(order_item_id=uuid4()))

    async def test_review_cannot_reference_another_buyers_purchase(self):
        with self.assertRaises(InvalidRatingSource):
            await self.write(await self.new_source(order_item_id=self.items[1][0]))

    async def test_review_cannot_reference_a_different_dish(self):
        with self.assertRaises(InvalidRatingSource):
            await self.write(await self.new_source(dish_id=self.dishes[1]))

    async def test_noncompleted_orders_never_create_feedback(self):
        sid = await self.new_source()
        for status in models.OrderStatus:
            if status == models.OrderStatus.COMPLETED:
                continue
            async with self.sessions.begin() as db:
                await db.execute(update(models.Order).where(models.Order.id == self.orders[0]).values(order_status=status))
            with self.assertRaises(InvalidRatingSource):
                await self.write(sid)
        self.assertEqual(await self.rows(), [])

    async def test_unpaid_and_refunded_orders_never_create_feedback(self):
        sid = await self.new_source()
        for payment in (models.PaymentStatus.UNPAID, models.PaymentStatus.REFUNDED):
            async with self.sessions.begin() as db:
                await db.execute(update(models.Order).where(models.Order.id == self.orders[0]).values(payment_status=payment))
            with self.assertRaises(InvalidRatingSource):
                await self.write(sid)

    async def test_zero_purchase_quantity_is_not_verified(self):
        sid = await self.new_source()
        async with self.sessions.begin() as db:
            await db.execute(update(models.OrderItem).where(models.OrderItem.id == self.items[0][0]).values(quantity=0))
        with self.assertRaises(InvalidRatingSource):
            await self.write(sid)

    async def test_off_sale_dish_keeps_a_genuine_rating(self):
        result = await self.write(await self.new_source())
        self.assertEqual(result.signal.dish_id, self.dishes[0])
        self.assertEqual(len(await self.current()), 1)

    async def test_same_source_revision_is_idempotent(self):
        sid = await self.new_source()
        first, replay = await self.write(sid), await self.write(sid)
        self.assertFalse(first.duplicate)
        self.assertTrue(replay.duplicate)
        self.assertEqual(first.signal, replay.signal)
        self.assertEqual(len(await self.rows()), 1)

    async def test_edited_rating_supersedes_without_mutating_or_counting_old_version(self):
        sid = await self.new_source(rating=1)
        first = await self.write(sid)
        old_rows = await self.rows()
        await self.edit(sid, rating=5, revision=2, updated_at=datetime(2026, 11, 8, 11, tzinfo=timezone.utc))
        second = await self.write(sid)
        self.assertEqual(second.signal.supersedes_id, first.signal.feedback_id)
        self.assertEqual(second.signal.source_key, first.signal.source_key)
        self.assertEqual((await self.rows())[0], old_rows[0])
        self.assertEqual(len(await self.rows()), 2)
        self.assertEqual(await self.current(), (second.signal,))

    async def test_same_revision_changed_score_conflicts_and_reader_hides_unsynced_source(self):
        sid = await self.new_source()
        await self.write(sid)
        before = await self.rows()
        await self.edit(sid, rating=5)
        with self.assertRaises(RatingRevisionConflict):
            await self.write(sid)
        self.assertEqual(await self.rows(), before)
        self.assertEqual(await self.current(), ())

    async def test_same_score_with_new_revision_is_still_one_current_source(self):
        sid = await self.new_source()
        first = await self.write(sid)
        await self.edit(sid, revision=2)
        second = await self.write(sid)
        self.assertEqual(first.signal.rating, second.signal.rating)
        self.assertEqual(len(await self.rows()), 2)
        self.assertEqual(await self.current(), (second.signal,))

    async def test_same_revision_changed_timestamp_conflicts(self):
        sid = await self.new_source()
        await self.write(sid)
        await self.edit(sid, updated_at=datetime(2026, 11, 8, 12, tzinfo=timezone.utc))
        with self.assertRaises(RatingRevisionConflict):
            await self.write(sid)

    async def test_stale_revision_cannot_replace_latest(self):
        sid = await self.new_source(revision=2)
        await self.write(sid)
        await self.edit(sid, revision=1)
        with self.assertRaises(RatingRevisionConflict):
            await self.write(sid)
        self.assertEqual((await self.rows())[0]["source_revision"], 2)

    async def test_review_identity_cannot_move_to_another_genuine_purchase(self):
        sid = await self.new_source()
        await self.write(sid)
        await self.edit(sid, revision=2, dish_id=self.dishes[1], order_item_id=self.items[0][1])
        with self.assertRaises(RatingRevisionConflict):
            await self.write(sid)
        self.assertEqual(len(await self.rows()), 1)

    async def test_two_customers_remain_independent(self):
        first = await self.write(await self.new_source(user=0))
        second = await self.write(await self.new_source(user=1), user=1)
        self.assertNotEqual(first.signal.source_key, second.signal.source_key)
        self.assertEqual({signal.user_id for signal in await self.current()}, set(self.users[:2]))

    async def test_existing_source_cannot_change_to_another_valid_owner(self):
        sid = await self.new_source()
        await self.write(sid)
        await self.edit(sid, revision=2, user_id=self.users[1], order_item_id=self.items[1][0])
        with self.assertRaises(RatingRevisionConflict):
            await self.write(sid, user=1)
        self.assertEqual(len(await self.rows()), 1)

    async def test_reader_omits_removed_and_unsynchronized_reviews(self):
        sid = await self.new_source()
        await self.write(sid)
        await self.edit(sid, status="removed")
        self.assertEqual(await self.current(), ())
        await self.edit(sid, status="published", revision=2, rating=4)
        self.assertEqual(await self.current(), ())
        result = await self.write(sid)
        self.assertEqual(await self.current(), (result.signal,))

    async def test_reader_rechecks_active_owner(self):
        await self.write(await self.new_source())
        async with self.sessions.begin() as db:
            await db.execute(update(models.User).where(models.User.id == self.users[0]).values(status=models.UserStatus.INACTIVE))
        self.assertEqual(await self.current(), ())

    async def test_reader_does_not_serve_feedback_when_source_disappears(self):
        await self.write(await self.new_source())
        class MissingSource(PersistedReviewAdapter):
            async def load_for_update(self, db, source_id):
                return None
        self.assertEqual(await self.current(adapter=MissingSource()), ())
        self.assertEqual(len(await self.rows()), 1)

    async def test_outer_rollback_reverts_source_edit_and_feedback_together(self):
        sid = await self.new_source()
        first = await self.write(sid)
        with self.assertRaisesRegex(RuntimeError, "rollback fixture"):
            async with self.sessions.begin() as db:
                actor = await db.get(models.User, self.users[0])
                await db.execute(update(reviews).where(reviews.c.source_id == sid).values(revision=2, rating=5))
                await record_verified_rating(db, sid, actor, source=self.source)
                raise RuntimeError("rollback fixture")
        self.assertEqual(len(await self.rows()), 1)
        self.assertEqual(await self.current(), (first.signal,))

    async def test_transaction_and_flushed_source_required(self):
        sid = await self.new_source()
        async with self.sessions() as db:
            with self.assertRaises(RatingTransactionRequired):
                await record_verified_rating(db, sid, models.User(id=self.users[0]), source=self.source)
        with self.assertRaises(RatingTransactionRequired):
            async with self.sessions.begin() as db:
                actor = await db.get(models.User, self.users[0])
                actor.full_name = "Unflushed change"
                await record_verified_rating(db, sid, actor, source=self.source)

    async def test_concurrent_replay_uses_unique_source_and_fresh_transaction_retry(self):
        sid = await self.new_source()
        sessions = async_sessionmaker(self.engine, class_=RacingSession, barrier=asyncio.Barrier(2), autoflush=False)
        async def worker():
            try:
                async with sessions.begin() as db:
                    actor = await db.get(models.User, self.users[0])
                    return await record_verified_rating(db, sid, actor, source=self.source)
            except RatingPersistenceError as error:
                self.assertTrue(error.retryable)
                return error
        results = await asyncio.gather(worker(), worker())
        self.assertEqual(sum(not isinstance(result, RatingPersistenceError) for result in results), 1)
        self.assertTrue((await self.write(sid)).duplicate)
        self.assertEqual(len(await self.rows()), 1)

    async def test_database_constraints_reject_duplicate_source_and_out_of_range_values(self):
        result = await self.write(await self.new_source())
        for changes in ({"feedback_id": uuid4()}, {"feedback_id": uuid4(), "source_revision": 2, "rating": 6},
                        {"feedback_id": uuid4(), "source_revision": 0}):
            with self.assertRaises(IntegrityError):
                async with self.sessions.begin() as db:
                    await db.execute(insert(feedback).values(**{**result.signal.__dict__, **changes}))
        self.assertEqual(len(await self.rows()), 1)

    async def test_persistence_failure_is_safe_and_rolls_back(self):
        sid = await self.new_source()
        original = AsyncSession.execute
        async def fail(db, statement, *args, **kwargs):
            if getattr(statement, "is_insert", False) and statement.table is feedback:
                raise OperationalError("private-connection-details", {}, RuntimeError("hidden"))
            return await original(db, statement, *args, **kwargs)
        with patch.object(AsyncSession, "execute", fail):
            with self.assertRaises(RatingPersistenceError) as caught:
                await self.write(sid)
        self.assertNotIn("private-connection-details", str(caught.exception))
        self.assertEqual(await self.rows(), [])

    async def test_legacy_view_cart_purchase_and_core_tables_remain_unchanged(self):
        before = await self.base_digest()
        sid = await self.new_source()
        await self.write(sid)
        await self.edit(sid, revision=2, rating=5)
        await self.write(sid)
        await self.current()
        self.assertEqual(await self.base_digest(), before)

    async def test_no_public_rating_api_and_jwt_or_user_id_cannot_forge_a_signal(self):
        paths = main.app.openapi()["paths"]
        self.assertFalse(any("rating" in path or "review" in path or "feedback" in path for path in paths))
        valid = main.create_access_token(str(self.users[0]))
        expired = jwt.encode({"sub": str(self.users[0]), "exp": datetime.now(timezone.utc)-timedelta(seconds=1)},
                             main.SECRET_KEY, algorithm=main.ALGORITHM)
        payload = {"event_id": str(uuid4()), "dish_id": str(self.dishes[0]), "event_type": "rating",
                   "rating": 5, "user_id": str(self.users[1]), "verified": True, "source_id": "fake"}
        for token in (None, "invalid-token", expired, valid):
            headers = [] if token is None else [(b"authorization", f"Bearer {token}".encode())]
            for path in ("/api/interactions/ratings", "/api/interactions/rating", "/api/ratings/feedback"):
                self.assertEqual((await request("POST", path, headers, payload))[0], 404)
            status = (await request("POST", "/api/interactions/views", headers, payload))[0]
            self.assertEqual(status, 422 if token == valid else 401)
        self.assertEqual(await self.rows(), [])
