"""US8.2 API, ownership and concurrent uniqueness; only disposable SQLite writes."""

import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import jwt
from sqlalchemy.orm import Session

import main
import models
from test_development import request
from test_interactions import InteractionFixture


class CartInteractions(InteractionFixture):
    story = "US8.2"
    endpoint = "/api/interactions/add-to-cart"

    async def view(self, payload):
        return await request("POST", "/api/interactions/views", self.headers(), payload)

    async def test_authenticated_customer_records_add_to_cart_with_utc(self):
        payload = self.payload()
        status, headers, body = await self.post(payload)
        self.assertEqual(status, 201)
        data = json.loads(body)
        self.assertEqual(data["event_id"], payload["event_id"])
        self.assertEqual(data["dish_id"], payload["dish_id"])
        self.assertEqual(data["event_type"], "add_to_cart")
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
        self.assertEqual((await self.post(headers=self.headers(token="invalid-token")))[0], 401)
        self.assertEqual(self.rows(), [])

    async def test_expired_jwt(self):
        token = jwt.encode({"sub": str(self.user_ids[0]),
                            "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
                           main.SECRET_KEY, algorithm=main.ALGORITHM)
        self.assertEqual((await self.post(headers=self.headers(token=token)))[0], 401)
        self.assertEqual(self.rows(), [])

    async def test_nonexistent_dish(self):
        self.assertEqual((await self.post(self.payload(dish_id=str(uuid4()))))[0], 404)
        self.assertEqual(self.rows(), [])

    async def test_unavailable_dish(self):
        self.assertEqual((await self.post(self.payload(dish_id=str(self.dish_ids[2]))))[0], 404)
        self.assertEqual(self.rows(), [])

    async def test_validates_uuids_fields_and_cart_event_type_only(self):
        for payload in ({}, self.payload(event_id="bad"), self.payload(dish_id="bad"),
                        self.payload(event_type="view"), self.payload(event_type="purchase"),
                        self.payload(event_type="rating"), self.payload(event_type=None),
                        self.payload(created_at=datetime.now(timezone.utc).isoformat()),
                        self.payload(quantity=2)):
            with self.subTest(fields=list(payload)):
                self.assertEqual((await self.post(payload))[0], 422)
        self.assertEqual(self.rows(), [])

    async def test_explicit_add_to_cart_type_is_accepted(self):
        status, _, body = await self.post(self.payload(event_type="add_to_cart"))
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(body)["event_type"], "add_to_cart")

    async def test_client_cannot_submit_user_id(self):
        self.assertEqual((await self.post(self.payload(user_id=str(self.user_ids[1]))))[0], 422)
        self.assertEqual(self.rows(), [])

    async def test_query_user_id_does_not_override_jwt_identity(self):
        self.assertEqual((await self.post(suffix=f"?user_id={self.user_ids[1]}"))[0], 201)
        self.assertEqual(self.rows()[0][1], self.user_ids[0])

    async def test_identical_event_replay_keeps_original_row_and_timestamp(self):
        payload = self.payload()
        first_status, _, first = await self.post(payload)
        original = self.rows()
        replay_status, _, replay = await self.post(payload)
        self.assertEqual((first_status, replay_status), (201, 200))
        self.assertTrue(json.loads(replay)["duplicate"])
        self.assertEqual(json.loads(replay)["created_at"], json.loads(first)["created_at"])
        self.assertEqual(self.rows(), original)

    async def test_two_independent_add_actions_have_two_event_ids(self):
        for _ in range(2): self.assertEqual((await self.post())[0], 201)
        self.assertEqual(len(self.rows()), 2)
        self.assertEqual(len({row[0] for row in self.rows()}), 2)

    async def test_two_customers_adding_same_dish_have_separate_ownership(self):
        for user in (0, 1): self.assertEqual((await self.post(user=user))[0], 201)
        self.assertEqual({row[1] for row in self.rows()}, set(self.user_ids))
        self.assertEqual({row[2] for row in self.rows()}, {self.dish_ids[0]})

    async def test_conflicting_dish_preserves_original_event(self):
        payload = self.payload()
        await self.post(payload)
        original = self.rows()
        self.assertEqual((await self.post({**payload, "dish_id": str(self.dish_ids[1])}))[0], 409)
        self.assertEqual(self.rows(), original)

    async def test_other_customer_cannot_reuse_or_discover_event_contents(self):
        payload = self.payload()
        await self.post(payload)
        original = self.rows()
        status, _, body = await self.post(payload, user=1)
        self.assertEqual(status, 409)
        data = json.loads(body)
        self.assertEqual(set(data), {"detail"})
        for private in (str(self.user_ids[0]), str(self.dish_ids[0]), payload["event_id"]):
            self.assertNotIn(private, data["detail"])
        self.assertEqual(self.rows(), original)

    async def test_existing_view_uuid_cannot_be_reused_as_add_to_cart(self):
        payload = self.payload()
        self.assertEqual((await self.view(payload))[0], 201)
        original = self.rows()
        self.assertEqual((await self.post(payload))[0], 409)
        self.assertEqual(self.rows(), original)
        self.assertEqual((await self.view(payload))[0], 200)

    async def test_existing_add_to_cart_uuid_cannot_be_reused_as_view(self):
        payload = self.payload()
        self.assertEqual((await self.post(payload))[0], 201)
        original = self.rows()
        self.assertEqual((await self.view(payload))[0], 409)
        self.assertEqual(self.rows(), original)

    async def test_concurrent_identical_requests_use_database_unique_constraint(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(self.post(payload), self.post(payload)), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [200, 201])
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(json.loads(responses[0][2])["created_at"], json.loads(responses[1][2])["created_at"])

    async def test_concurrent_cross_account_collision_preserves_winner(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(self.post(payload, user=0), self.post(payload, user=1)), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [201, 409])
        winner = next(index for index, response in enumerate(responses) if response[0] == 201)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][1], self.user_ids[winner])

    async def test_concurrent_dish_collision_preserves_winner(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(
            self.post(payload), self.post({**payload, "dish_id": str(self.dish_ids[1])}),
        ), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [201, 409])
        winner = next(index for index, response in enumerate(responses) if response[0] == 201)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][2], self.dish_ids[winner])

    async def test_concurrent_view_and_add_to_cart_share_the_same_unique_constraint(self):
        self.barrier = asyncio.Barrier(2)
        payload = self.payload()
        responses = await asyncio.wait_for(asyncio.gather(self.view(payload), self.post(payload)), timeout=10)
        self.assertEqual(sorted(response[0] for response in responses), [201, 409])
        winner = "view" if responses[0][0] == 201 else "add_to_cart"
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0][3], winner)

    async def test_no_read_edit_or_delete_route_for_other_customers(self):
        payload = self.payload()
        await self.post(payload)
        original = self.rows()
        for method in ("GET", "PUT", "DELETE"):
            self.assertEqual((await request(method, self.endpoint, self.headers(1), payload))[0], 405)
            self.assertEqual((await request(method, f"/api/interactions/{payload['event_id']}", self.headers(1), payload))[0], 404)
        self.assertEqual(self.rows(), original)

    async def test_inactive_or_non_customer_accounts_are_rejected(self):
        for role, status in ((models.UserRole.ADMIN, models.UserStatus.ACTIVE),
                             (models.UserRole.SHIPPER, models.UserStatus.ACTIVE),
                             (models.UserRole.CUSTOMER, models.UserStatus.BANNED)):
            with Session(self.engine) as session:
                user = session.get(models.User, self.user_ids[0])
                user.role, user.status = role, status
                session.commit()
            self.assertEqual((await self.post())[0], 403)
        self.assertEqual(self.rows(), [])

    async def test_adding_new_cart_event_preserves_existing_view_and_its_replay(self):
        view = self.payload()
        await self.view(view)
        original = self.rows()[0]
        self.assertEqual((await self.post())[0], 201)
        self.assertEqual(self.rows()[0], original)
        self.assertEqual(len(self.rows()), 2)
        self.assertEqual((await self.view(view))[0], 200)


if __name__ == "__main__":
    unittest.main()
