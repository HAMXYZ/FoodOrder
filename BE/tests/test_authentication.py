"""Exercise real auth queries against disposable test users; no MariaDB writes."""

import json
import secrets
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from jose import jwt
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

import main
import models
from test_development import request


class Authentication(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = secrets.token_urlsafe(24)
        cls.password_hash = main.password_hasher.hash(cls.password)

    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(self.engine, tables=[models.User.__table__])
        self.session = Session(self.engine)
        self.users = [models.User(
            id=uuid4(), full_name=f"Customer {label}", email=f"customer-{label}@example.test",
            password_hash=self.password_hash, role=models.UserRole.CUSTOMER,
            status=models.UserStatus.ACTIVE,
        ) for label in ("a", "b")]
        self.session.add_all(self.users)
        self.session.commit()

        async def execute(statement): return self.session.execute(statement)
        async def commit(): self.session.commit()
        async def rollback(): self.session.rollback()
        async def refresh(user): self.session.refresh(user)
        database = SimpleNamespace(execute=execute, commit=commit, rollback=rollback,
                                   refresh=refresh, add=self.session.add)

        async def dependency(): yield database
        main.app.dependency_overrides[main.get_db] = dependency

    def tearDown(self):
        main.app.dependency_overrides.clear()
        self.session.close()
        self.engine.dispose()

    def headers(self, user=None, token=None):
        if token is None:
            token = main.create_access_token(str((user or self.users[0]).id))
        return [(b"authorization", f"Bearer {token}".encode())]

    def signed(self, **claims):
        return jwt.encode(claims, main.SECRET_KEY, algorithm=main.ALGORITHM)

    async def login(self, **overrides):
        payload = {"email": self.users[0].email, "password": self.password, **overrides}
        return await request("POST", "/api/auth/login", json_body=payload)

    async def test_valid_login_and_profile(self):
        status, headers, body = await self.login(email="  CUSTOMER-A@EXAMPLE.TEST  ")
        self.assertEqual(status, 200)
        data = json.loads(body)
        claims = jwt.decode(data["access_token"], main.SECRET_KEY, algorithms=[main.ALGORITHM])
        self.assertEqual(claims["sub"], str(self.users[0].id))
        self.assertGreater(claims["exp"], datetime.now(timezone.utc).timestamp())
        self.assertEqual(headers[b"cache-control"], b"no-store")
        status, _, body = await request("GET", "/api/users/me", self.headers(token=data["access_token"]))
        self.assertEqual(status, 200)
        user = json.loads(body)["user"]
        self.assertEqual(user["id"], str(self.users[0].id))
        self.assertTrue("password_hash" not in user and "password" not in user)

    async def test_wrong_password(self):
        status, _, _ = await self.login(password=secrets.token_urlsafe(24))
        self.assertEqual(status, 401)

    async def test_unknown_email(self):
        status, _, _ = await self.login(email="missing@example.test")
        self.assertEqual(status, 401)

    async def test_missing_token(self):
        status, headers, _ = await request("GET", "/api/users/me")
        self.assertEqual(status, 401)
        self.assertEqual(headers[b"www-authenticate"], b"Bearer")

    async def test_invalid_token(self):
        status, _, _ = await request("GET", "/api/users/me", self.headers(token="invalid"))
        self.assertEqual(status, 401)

    async def test_expired_token(self):
        token = self.signed(sub=str(self.users[0].id), exp=datetime.now(timezone.utc)-timedelta(minutes=1))
        status, _, _ = await request("GET", "/api/users/me", self.headers(token=token))
        self.assertEqual(status, 401)

    async def test_expiration_is_required(self):
        token = self.signed(sub=str(self.users[0].id))
        status, _, _ = await request("GET", "/api/users/me", self.headers(token=token))
        self.assertEqual(status, 401)

    async def test_subject_is_required_and_must_be_uuid(self):
        for claims in ({}, {"sub": "not-a-user-id"}):
            token = self.signed(exp=datetime.now(timezone.utc)+timedelta(minutes=1), **claims)
            status, _, _ = await request("GET", "/api/users/me", self.headers(token=token))
            self.assertEqual(status, 401)

    async def test_forged_token_for_another_user(self):
        token = jwt.encode({"sub": str(self.users[1].id),
                            "exp": datetime.now(timezone.utc)+timedelta(minutes=1)},
                           secrets.token_urlsafe(48), algorithm=main.ALGORITHM)
        status, _, _ = await request("GET", "/api/users/me", self.headers(token=token))
        self.assertEqual(status, 401)

    async def test_valid_token_for_deleted_or_unknown_user(self):
        token = main.create_access_token(str(uuid4()))
        status, _, _ = await request("GET", "/api/users/me", self.headers(token=token))
        self.assertEqual(status, 401)

    async def test_inactive_account_cannot_log_in_or_use_token(self):
        token = main.create_access_token(str(self.users[0].id))
        self.users[0].status = models.UserStatus.BANNED
        self.session.commit()
        status, _, _ = await self.login()
        self.assertEqual(status, 403)
        status, _, _ = await request("GET", "/api/users/me", self.headers(token=token))
        self.assertEqual(status, 403)

    async def test_client_user_id_cannot_select_another_profile(self):
        status, _, body = await request("GET", f"/api/users/me?user_id={self.users[1].id}", self.headers())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["user"]["id"], str(self.users[0].id))

    async def test_client_user_id_cannot_update_another_profile(self):
        status, _, _ = await request("PUT", "/api/users/me", self.headers(), {
            "full_name": "Attempted change", "user_id": str(self.users[1].id),
        })
        self.assertEqual(status, 422)
        self.session.refresh(self.users[1])
        self.assertEqual(self.users[1].full_name, "Customer b")

    async def test_profile_update_only_changes_token_owner(self):
        status, _, body = await request("PUT", "/api/users/me", self.headers(), {"full_name": "Changed customer A"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["user"]["id"], str(self.users[0].id))
        self.session.refresh(self.users[1])
        self.assertEqual(self.users[1].full_name, "Customer b")

    async def test_another_users_profile_has_no_public_route(self):
        status, _, _ = await request("GET", f"/api/users/{self.users[1].id}", self.headers())
        self.assertEqual(status, 404)

    async def test_profile_and_password_changes_require_login(self):
        for path, payload in (("/api/users/me", {"full_name": "Not signed in"}),
                              ("/api/users/me/change-password", {"current_password": self.password,
                               "new_password": self.password, "confirm_new_password": self.password})):
            status, _, _ = await request("PUT", path, json_body=payload)
            self.assertEqual(status, 401)

    async def test_registration_hashes_password_and_sets_customer_role(self):
        status, _, body = await request("POST", "/api/auth/register", json_body={
            "full_name": "New customer", "email": "new@example.test", "password": self.password,
        })
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(body)["user"]["role"], "customer")
        user = self.session.execute(select(models.User).where(models.User.email == "new@example.test")).scalar_one()
        self.assertTrue(main.password_hasher.verify(self.password, user.password_hash))
        self.assertTrue(user.password_hash != self.password)

    async def test_registration_cannot_assign_role_or_identity(self):
        status, _, _ = await request("POST", "/api/auth/register", json_body={
            "full_name": "Attempted admin", "email": "admin@example.test", "password": self.password,
            "role": "admin", "user_id": str(self.users[1].id),
        })
        self.assertEqual(status, 422)
        self.assertEqual(self.session.execute(select(func.count()).select_from(models.User)).scalar_one(), 2)


if __name__ == "__main__":
    unittest.main()
