"""Add purchase source references to foodorder_dev without touching existing values.

Default: inspect only. --apply: one additive ALTER on user_interactions.
No seed/backfill/order creation, no DROP/TRUNCATE/UPDATE, no other database.
"""

import argparse
import asyncio
import hashlib
import json
import sys

from sqlalchemy import BigInteger, Column, ForeignKey, Index, Integer, MetaData, String, Table, UniqueConstraint, inspect, select, text
from sqlalchemy.schema import AddConstraint, CreateColumn

import init_database as development
import models
from database import engine

SOURCE_COLUMNS = ("order_id", "order_item_id", "quantity")
SOURCE_CONSTRAINTS = frozenset({
    "fk_user_interactions_order", "fk_user_interactions_order_item",
    "uq_user_interactions_purchase_item", "ck_user_interactions_purchase_source",
})
SOURCE_INDEXES = frozenset({"ix_user_interactions_order_time", "ix_user_interactions_order_item"})
LEGACY_COLUMNS = ("id", "event_id", "user_id", "dish_id", "event_type", "created_at")
LOCK_NAME = "foodorder_dev.us83.purchase_sources"


def legacy_metadata():
    """The known US8.2 schema, isolated from the current ORM metadata."""
    metadata = MetaData()
    for table in models.Base.metadata.sorted_tables:
        if table.name != "user_interactions":
            table.to_metadata(metadata)
    table = Table("user_interactions", metadata,
        Column("id", BigInteger(), primary_key=True, autoincrement=True),
        Column("event_id", models.UUIDChar(), nullable=False),
        Column("user_id", models.UUIDChar(), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        Column("dish_id", models.UUIDChar(), ForeignKey("dishes.id", ondelete="RESTRICT"), nullable=False),
        Column("event_type", String(32), nullable=False),
        Column("created_at", models.UTCDateTime(), nullable=False),
        UniqueConstraint("event_id", name="uq_user_interactions_event_id"),
    )
    for index in models.UserInteraction.__table__.indexes:
        if index.name not in SOURCE_INDEXES:
            Index(index.name, *(table.c[column.name] for column in index.columns), unique=index.unique)
    return metadata


def schema_state(connection):
    inspector = inspect(connection)
    if not development.EXPECTED_TABLES.issubset(inspector.get_table_names()):
        raise development.DevelopmentDatabaseError("Can du 9 bang US8.2 truoc migration purchase.")
    columns = inspector.get_columns("user_interactions")
    names = {column["name"] for column in columns}
    if names == set(LEGACY_COLUMNS):
        if inspector.get_check_constraints("user_interactions"):
            raise development.DevelopmentDatabaseError("Bang tuong tac cu co CHECK ngoai du kien; dung de kiem tra.")
        _, issues = development.inspect_schema(connection, metadata=legacy_metadata())
        state = "legacy"
    elif names == set(LEGACY_COLUMNS) | set(SOURCE_COLUMNS):
        _, issues = development.inspect_schema(connection)
        state = "current"
        by_name = {column["name"]: column for column in columns}
        for name in ("order_id", "order_item_id"):
            if not isinstance(by_name[name]["type"], String) or by_name[name]["type"].length != 36:
                issues.append(f"user_interactions: {name} phai luu UUID 36 ky tu")
        if not isinstance(by_name["quantity"]["type"], Integer):
            issues.append("user_interactions: quantity phai la so nguyen")
    else:
        raise development.DevelopmentDatabaseError("Schema khong phai US8.2 hoac US8.3 du kien; khong tu sua bang.")
    if issues:
        raise development.DevelopmentDatabaseError("; ".join(issues))
    return state


def additive_ddl(dialect):
    """Compile current model columns/constraints. Never isolate them from create_all."""
    table = models.UserInteraction.__table__
    preparer = dialect.identifier_preparer
    clauses = ["ADD COLUMN " + str(CreateColumn(table.c[name]).compile(dialect=dialect))
               for name in SOURCE_COLUMNS]
    prefix = "ALTER TABLE " + preparer.format_table(table) + " "
    for constraint in sorted((item for item in table.constraints if item.name in SOURCE_CONSTRAINTS),
                             key=lambda item: item.name):
        statement = str(AddConstraint(constraint, isolate_from_table=False).compile(dialect=dialect))
        if not statement.startswith(prefix):
            raise development.DevelopmentDatabaseError("DDL constraint khong khop bang phat trien.")
        clauses.append(statement[len(prefix):])
    for index in sorted((item for item in table.indexes if item.name in SOURCE_INDEXES), key=lambda item: item.name):
        columns = ", ".join(preparer.quote(column.name) for column in index.columns)
        clauses.append(f"ADD INDEX {preparer.quote(index.name)} ({columns})")
    target = preparer.quote(development.DEVELOPMENT_DATABASE) + "." + preparer.quote(table.name)
    return "ALTER TABLE " + target + " " + ", ".join(clauses)


async def snapshot(connection):
    # Project only the original six interaction fields, before and after ALTER.
    metadata = legacy_metadata()
    report = {"base": {}, "events": {}, "row_counts": {}}
    for table in metadata.sorted_tables:
        rows = (await connection.execute(select(table).order_by(*table.primary_key.columns))).all()
        report["row_counts"][table.name] = len(rows)
        if table.name == "user_interactions":
            report["events"] = {str(row.event_id): hashlib.sha256(
                json.dumps(list(row), default=str).encode()
            ).hexdigest() for row in rows}
        else:
            report["base"][table.name] = hashlib.sha256(
                json.dumps([list(row) for row in rows], default=str).encode()
            ).hexdigest()
    return report


async def main(apply=False):
    try:
        development.validate_target(engine.url, models.Base.metadata)
        async with engine.begin() as connection:
            await development.verify_connection(connection)
            locked = False
            try:
                if apply:
                    locked = (await connection.execute(text("SELECT GET_LOCK(:name, 0)"), {"name": LOCK_NAME})).scalar_one() == 1
                    if not locked:
                        raise development.DevelopmentDatabaseError("Migration dang chay o ket noi khac; thu lai sau.")
                state = await connection.run_sync(schema_state)
                before = await snapshot(connection)
                if state == "legacy":
                    # Old untraceable purchases cannot be guessed or backfilled.
                    count = (await connection.execute(text(
                        "SELECT COUNT(*) FROM user_interactions WHERE event_type = 'purchase'"
                    ))).scalar_one()
                    if count:
                        raise development.DevelopmentDatabaseError("Co purchase chua ro nguon; dung lai, khong backfill gia.")
                altered = apply and state == "legacy"
                if altered:
                    await connection.exec_driver_sql(additive_ddl(connection.dialect))
                after_state = await connection.run_sync(schema_state)
                if apply and after_state != "current":
                    raise development.DevelopmentDatabaseError("Schema sau migration chua dat US8.3.")
                after = await snapshot(connection)
                if before["base"] != after["base"] or any(
                    after["events"].get(identifier) != digest for identifier, digest in before["events"].items()
                ):
                    raise development.DevelopmentDatabaseError("Du lieu cu thay doi trong luc kiem tra; khong tu rollback DDL.")
                report = {
                    "database": development.DEVELOPMENT_DATABASE, "mode": "apply" if apply else "check",
                    "schema_state": after_state, "altered_tables": ["user_interactions"] if altered else [],
                    "pending_columns": list(SOURCE_COLUMNS) if after_state == "legacy" else [],
                    "preserved_events": len(before["events"]), "row_counts": after["row_counts"],
                    "purchase_events_created": 0,
                }
            finally:
                if locked:
                    await connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": LOCK_NAME})
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except development.DevelopmentDatabaseError as error:
        print(f"LOI: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        args = getattr(getattr(error, "orig", None), "args", ())
        code = args[0] if args and isinstance(args[0], int) else None
        print(f"LOI: {type(error).__name__}, database code {code}. Khong in thong tin ket noi.", file=sys.stderr)
        if code in (1044, 1142):
            print("Can quyen ALTER/INDEX/FK chi tren foodorder_dev; khong cap quyen database khac.", file=sys.stderr)
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Them cot/constraint purchase an toan trong foodorder_dev")
    raise SystemExit(asyncio.run(main(apply=parser.parse_args().apply)))
