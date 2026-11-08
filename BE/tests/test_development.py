import asyncio
import contextlib
import importlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
from urllib.parse import urlsplit

from sqlalchemy import MetaData, Table, create_engine
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session
from fastapi import HTTPException

import init_database
import main
import models


class DevelopmentGuards(unittest.IsolatedAsyncioTestCase):
    async def test_other_database_is_rejected_before_connecting(self):
        fake = SimpleNamespace(
            url=URL.create("mysql+asyncmy", username="foodorder_app", database="another_database"),
            begin=MagicMock(), dispose=AsyncMock(),
        )
        with patch.object(init_database, "engine", fake), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(await init_database.main(seed=True), 1)
        fake.begin.assert_not_called()

    async def test_wrong_authenticated_database_is_rejected(self):
        result = MagicMock()
        result.one.return_value = ("another_database", "foodorder_app@localhost")
        connection = SimpleNamespace(execute=AsyncMock(return_value=result))
        with self.assertRaises(init_database.DevelopmentDatabaseError):
            await init_database.verify_connection(connection)

    async def test_wrong_account_is_rejected(self):
        url = URL.create("mysql+asyncmy", username="root", database="foodorder_dev")
        with self.assertRaises(init_database.DevelopmentDatabaseError):
            init_database.validate_target(url, models.Base.metadata)

    async def test_existing_menu_is_never_seeded_again(self):
        result = MagicMock()
        result.scalar_one.return_value = 1
        connection = SimpleNamespace(execute=AsyncMock(return_value=result))
        report = await init_database.seed_menu(connection)
        self.assertTrue(report["seed_skipped"])
        self.assertEqual(report["dishes_added"], 0)
        self.assertEqual(connection.execute.await_count, 1)

    async def test_import_does_not_initialize_database(self):
        with patch.object(type(init_database.engine), "begin") as begin, patch("asyncio.run") as run:
            importlib.reload(init_database)
            begin.assert_not_called()
            run.assert_not_called()

    async def test_metadata_cannot_reference_another_schema(self):
        metadata = MetaData()
        Table("users", metadata, schema="another_database")
        url = URL.create("mysql+asyncmy", username="foodorder_app", database="foodorder_dev")
        with self.assertRaises(init_database.DevelopmentDatabaseError):
            init_database.validate_target(url, metadata)


async def request(method, path, headers=(), json_body=None):
    messages = []
    target = urlsplit(path)
    request_headers = list(headers)
    body = b"" if json_body is None else json.dumps(json_body).encode()
    if json_body is not None:
        request_headers.append((b"content-type", b"application/json"))

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        messages.append(message)

    await main.app({
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method, "scheme": "http", "path": target.path, "raw_path": target.path.encode(),
        "query_string": target.query.encode(), "root_path": "", "headers": request_headers,
        "server": ("127.0.0.1", 8000), "client": ("127.0.0.1", 12345),
    }, receive, send)
    start = next(message for message in messages if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
    return start["status"], dict(start["headers"]), body


class CorsAndMenuAPI(unittest.IsolatedAsyncioTestCase):
    async def test_allowed_origins_and_authorization_header(self):
        for origin in (b"http://localhost:3000", b"http://127.0.0.1:3000"):
            status, headers, _ = await request("OPTIONS", "/api/dishes", [
                (b"origin", origin), (b"access-control-request-method", b"GET"),
                (b"access-control-request-headers", b"authorization,content-type"),
            ])
            self.assertEqual(status, 200)
            self.assertEqual(headers[b"access-control-allow-origin"], origin)

    async def test_unlisted_origin_is_rejected(self):
        status, headers, _ = await request("OPTIONS", "/api/dishes", [
            (b"origin", b"https://example.invalid"),
            (b"access-control-request-method", b"GET"),
        ])
        self.assertEqual(status, 400)
        self.assertNotIn(b"access-control-allow-origin", headers)

    async def test_missing_dish_returns_404(self):
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        database = SimpleNamespace(execute=AsyncMock(return_value=result))

        async def dependency():
            yield database

        main.app.dependency_overrides[main.get_db] = dependency
        try:
            status, _, body = await request("GET", f"/api/dishes/{uuid4()}")
            self.assertEqual(status, 404)
            self.assertIn("detail", json.loads(body))
        finally:
            main.app.dependency_overrides.clear()

    async def test_malformed_dish_id_returns_422(self):
        async def dependency():
            yield SimpleNamespace(execute=AsyncMock())

        main.app.dependency_overrides[main.get_db] = dependency
        try:
            status, _, _ = await request("GET", "/api/dishes/not-a-uuid")
            self.assertEqual(status, 422)
        finally:
            main.app.dependency_overrides.clear()


class MenuAvailability(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Disposable SQL database for query behavior; never uses BE/.env or MariaDB.
        self.engine = create_engine("sqlite:///:memory:")
        models.Base.metadata.create_all(self.engine, tables=[
            models.Category.__table__, models.Dish.__table__,
        ])
        self.session = Session(self.engine)
        category = models.Category(name="Test category")
        self.visible_id, self.hidden_id = uuid4(), uuid4()
        for identifier, available in ((self.visible_id, True), (self.hidden_id, False)):
            self.session.add(models.Dish(
                id=identifier, category=category, name=str(identifier), description="Test dish",
                base_price=10000, calories=100, spiciness_level=0,
                is_vegetarian=False, is_available=available,
            ))
        self.session.commit()

        async def execute(statement):
            return self.session.execute(statement)

        self.database = SimpleNamespace(execute=execute)

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    async def test_unavailable_dishes_are_excluded_from_menu(self):
        rows = await main.get_dishes(db=self.database)
        self.assertEqual([row["id"] for row in rows], [str(self.visible_id)])

    async def test_unavailable_dish_detail_is_not_served(self):
        with self.assertRaises(HTTPException) as failure:
            await main.get_dish(self.hidden_id, db=self.database)
        self.assertEqual(failure.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
