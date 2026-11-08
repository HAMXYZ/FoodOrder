"""Fail-closed guards for the additive development-only purchase migration."""

import contextlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.dialects.mysql import dialect
from sqlalchemy.engine import URL

import init_database
import migrate_purchase_sources as migration
import models


class PurchaseMigration(unittest.IsolatedAsyncioTestCase):
    def fake_engine(self, *, database="foodorder_dev", actual="foodorder_dev", state="legacy", purchases=0):
        async def execute(statement, parameters=None):
            result = MagicMock()
            result.one.return_value = (actual, "foodorder_app@localhost")
            result.scalar_one.return_value = purchases if "COUNT(*)" in str(statement) else 1
            return result

        connection = SimpleNamespace(
            execute=AsyncMock(side_effect=execute),
            run_sync=AsyncMock(return_value=state), exec_driver_sql=AsyncMock(), dialect=dialect(),
        )
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=connection)
        context.__aexit__ = AsyncMock(return_value=False)
        engine = SimpleNamespace(
            url=URL.create("mysql+asyncmy", username="foodorder_app", database=database),
            begin=MagicMock(return_value=context), dispose=AsyncMock(),
        )
        return engine, connection

    async def run_migration(self, engine, apply=False):
        snapshot = {"base": {"users": "unchanged"}, "events": {"existing-id": "unchanged"},
                    "row_counts": {"users": 2, "user_interactions": 65}}
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(migration, "engine", engine), patch.object(migration, "snapshot", AsyncMock(return_value=snapshot)):
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                result = await migration.main(apply=apply)
        return result, output.getvalue(), errors.getvalue()

    async def test_wrong_url_database_is_rejected_before_connecting(self):
        engine, _ = self.fake_engine(database="other")
        self.assertEqual((await self.run_migration(engine, apply=True))[0], 1)
        engine.begin.assert_not_called()

    async def test_wrong_actual_database_is_rejected_before_any_schema_action(self):
        engine, connection = self.fake_engine(actual="other")
        self.assertEqual((await self.run_migration(engine, apply=True))[0], 1)
        connection.run_sync.assert_not_called()
        connection.exec_driver_sql.assert_not_called()

    async def test_default_check_mode_never_sends_alter(self):
        engine, connection = self.fake_engine()
        result, output, _ = await self.run_migration(engine)
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output)["pending_columns"], list(migration.SOURCE_COLUMNS))
        connection.exec_driver_sql.assert_not_called()

    async def test_current_schema_is_a_noop_even_with_apply(self):
        engine, connection = self.fake_engine(state="current")
        result, output, _ = await self.run_migration(engine, apply=True)
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output)["altered_tables"], [])
        connection.exec_driver_sql.assert_not_called()

    async def test_legacy_schema_applies_exactly_one_additive_statement(self):
        engine, connection = self.fake_engine()
        connection.run_sync.side_effect = ["legacy", "current"]
        result, output, _ = await self.run_migration(engine, apply=True)
        self.assertEqual(result, 0)
        connection.exec_driver_sql.assert_awaited_once()
        self.assertEqual(json.loads(output)["purchase_events_created"], 0)

    async def test_old_purchase_without_source_prevents_automatic_migration(self):
        engine, connection = self.fake_engine(purchases=1)
        self.assertEqual((await self.run_migration(engine, apply=True))[0], 1)
        connection.exec_driver_sql.assert_not_called()

    async def test_unrecognized_partial_schema_is_not_silently_repaired(self):
        inspector = MagicMock()
        inspector.get_table_names.return_value = list(init_database.EXPECTED_TABLES)
        inspector.get_columns.return_value = [{"name": name} for name in (*migration.LEGACY_COLUMNS, "order_id")]
        with patch.object(migration, "inspect", return_value=inspector):
            with self.assertRaises(init_database.DevelopmentDatabaseError):
                migration.schema_state(MagicMock())

    async def test_compiled_ddl_only_adds_and_does_not_disable_model_constraints(self):
        table = models.UserInteraction.__table__
        original_rules = {id(constraint): constraint._create_rule for constraint in table.constraints}
        statement = migration.additive_ddl(dialect())
        self.assertTrue(statement.startswith("ALTER TABLE foodorder_dev.user_interactions ADD COLUMN"))
        self.assertEqual(statement.count("ADD COLUMN"), 3)
        self.assertIn("UNIQUE (event_type, order_item_id)", statement)
        self.assertIn("quantity IS NOT NULL AND quantity > 0", statement)
        self.assertNotIn(";", statement)
        for forbidden in ("DROP ", "TRUNCATE ", "INSERT INTO ", "UPDATE ", "CREATE TABLE "):
            self.assertNotIn(forbidden, statement.upper())
        self.assertEqual(original_rules, {id(constraint): constraint._create_rule for constraint in table.constraints})
        self.assertEqual(set(migration.legacy_metadata().tables["user_interactions"].columns.keys()), set(migration.LEGACY_COLUMNS))
        self.assertTrue(set(migration.SOURCE_COLUMNS).issubset(table.columns.keys()))


if __name__ == "__main__":
    unittest.main()
