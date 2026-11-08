"""Initialize only foodorder_dev from the existing models; seed an empty menu on request."""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, inspect, insert, select, text

import models
from database import engine
from schemas import DishCreate

DEVELOPMENT_DATABASE = "foodorder_dev"
DEVELOPMENT_USER = "foodorder_app"
EXPECTED_TABLES = frozenset({
    "users", "user_addresses", "categories", "dishes", "dish_options",
    "dish_option_items", "orders", "order_items", "user_interactions",
})


class DevelopmentDatabaseError(RuntimeError):
    pass


def validate_target(url, metadata):
    # Validate before opening a connection, including when imported by another script.
    if (url.database != DEVELOPMENT_DATABASE or url.username != DEVELOPMENT_USER
            or url.drivername != "mysql+asyncmy"):
        raise DevelopmentDatabaseError(
            "Chi cho phep mysql+asyncmy, database foodorder_dev, tai khoan foodorder_app."
        )
    if set(metadata.tables) != EXPECTED_TABLES or any(
        table.schema is not None for table in metadata.tables.values()
    ):
        raise DevelopmentDatabaseError("Metadata khong khop cac bang phat trien du kien.")


async def verify_connection(connection):
    database, account = (await connection.execute(
        text("SELECT DATABASE(), CURRENT_USER()")
    )).one()
    if database != DEVELOPMENT_DATABASE or account.rsplit("@", 1)[0] != DEVELOPMENT_USER:
        raise DevelopmentDatabaseError("Dung lai: database hoac tai khoan thuc te khong dung.")


def delete_rule(value):
    # MariaDB omits the default RESTRICT action from reflected foreign keys.
    rule = (value or "RESTRICT").upper()
    return "RESTRICT" if rule == "NO ACTION" else rule


def normalize_check(expression):
    # MariaDB adds identifier quotes and grouping parentheses when reflecting CHECKs.
    return re.sub(r"[\s`()]+", "", str(expression)).lower()


def inspect_schema(connection, metadata=None):
    inspector = inspect(connection)
    tables = set(inspector.get_table_names(schema=DEVELOPMENT_DATABASE))
    views = set(inspector.get_view_names(schema=DEVELOPMENT_DATABASE))
    issues = []
    for table in (metadata if metadata is not None else models.Base.metadata).sorted_tables:
        if table.name in views:
            issues.append(f"{table.name}: trung ten view")
        if table.name not in tables:
            continue
        columns = inspector.get_columns(table.name, schema=DEVELOPMENT_DATABASE)
        if {column["name"] for column in columns} != set(table.columns.keys()):
            issues.append(f"{table.name}: danh sach cot khac models")
        primary_key = inspector.get_pk_constraint(table.name, schema=DEVELOPMENT_DATABASE)
        if primary_key["constrained_columns"] != list(table.primary_key.columns.keys()):
            issues.append(f"{table.name}: khoa chinh khac models")
        foreign_keys = inspector.get_foreign_keys(table.name, schema=DEVELOPMENT_DATABASE)
        actual_fks = {
            (tuple(fk["constrained_columns"]), fk["referred_table"],
             tuple(fk["referred_columns"]), delete_rule(fk.get("options", {}).get("ondelete")))
            for fk in foreign_keys
        }
        expected_fks = {
            (tuple(fk.column_keys), fk.elements[0].column.table.name,
             tuple(item.column.name for item in fk.elements), delete_rule(fk.ondelete))
            for fk in table.foreign_key_constraints
        }
        if actual_fks != expected_fks or any(
            fk.get("referred_schema") not in (None, DEVELOPMENT_DATABASE) for fk in foreign_keys
        ):
            issues.append(f"{table.name}: khoa ngoai khac models")
        actual_unique = {tuple(item["column_names"]) for item in inspector.get_unique_constraints(
            table.name, schema=DEVELOPMENT_DATABASE
        )}
        expected_unique = {tuple(constraint.columns.keys()) for constraint in table.constraints
                           if isinstance(constraint, models.UniqueConstraint)}
        if not expected_unique.issubset(actual_unique):
            issues.append(f"{table.name}: thieu rang buoc unique trong models")
        if table.name == "user_interactions":
            for column in columns:
                expected = table.columns.get(column["name"])
                if expected is not None and column["nullable"] != expected.nullable:
                    issues.append(f"user_interactions: nullable cua {column['name']} khac models")
        checks = {normalize_check(item["sqltext"]) for item in inspector.get_check_constraints(
            table.name, schema=DEVELOPMENT_DATABASE
        )}
        for constraint in table.constraints:
            if isinstance(constraint, models.CheckConstraint) and normalize_check(constraint.sqltext) not in checks:
                issues.append(f"{table.name}: thieu CHECK {constraint.name} trong models")
        indexes = {index["name"]: index for index in inspector.get_indexes(
            table.name, schema=DEVELOPMENT_DATABASE
        )}
        for index in table.indexes:
            actual = indexes.get(index.name)
            if (actual is None or actual["column_names"] != list(index.columns.keys())
                    or bool(actual["unique"]) != bool(index.unique)):
                issues.append(f"{table.name}: chi muc {index.name} khac models")
    return tables, issues


async def seed_menu(connection):
    if (await connection.execute(select(func.count()).select_from(models.Dish))).scalar_one():
        return {"categories_added": 0, "dishes_added": 0, "seed_skipped": True}
    data = json.loads((Path(__file__).parent / "data" / "dev_menu.json").read_text())
    category_names = {category["name"] for category in data["categories"]}
    for dish in data["dishes"]:
        if UUID(dish["id"]).version != 4 or dish["category"] not in category_names:
            raise DevelopmentDatabaseError("Du lieu mau khong hop le.")
        DishCreate(category_id=1, **{key: value for key, value in dish.items()
                                    if key not in ("id", "category")})
    categories = dict((await connection.execute(
        select(models.Category.name, models.Category.id)
    )).all())
    added_categories = 0
    for category in data["categories"]:
        if category["name"] not in categories:
            result = await connection.execute(insert(models.Category).values(**category))
            categories[category["name"]] = result.inserted_primary_key[0]
            added_categories += 1
    for dish in data["dishes"]:
        values = DishCreate(category_id=categories[dish["category"]], **{
            key: value for key, value in dish.items() if key not in ("id", "category")
        }).model_dump()
        await connection.execute(insert(models.Dish).values(id=UUID(dish["id"]), **values))
    return {"categories_added": added_categories, "dishes_added": len(data["dishes"]),
            "seed_skipped": False}


async def main(seed=False):
    try:
        validate_target(engine.url, models.Base.metadata)
        async with engine.begin() as connection:
            await verify_connection(connection)
            before, issues = await connection.run_sync(inspect_schema)
            if issues:
                raise DevelopmentDatabaseError("; ".join(issues))
            # Only the verified connection may create tables. Existing objects are preserved.
            await connection.run_sync(models.Base.metadata.create_all, checkfirst=True)
            after, issues = await connection.run_sync(inspect_schema)
            if issues or not EXPECTED_TABLES.issubset(after):
                raise DevelopmentDatabaseError("Schema sau khoi tao chua khop models: " + "; ".join(issues))
            report = {"database": DEVELOPMENT_DATABASE, "created_tables": sorted(after - before),
                      "verified_model_tables": sorted(EXPECTED_TABLES)}
            if seed:
                report.update(await seed_menu(connection))
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except DevelopmentDatabaseError as exc:
        print(f"LOI: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        args = getattr(getattr(exc, "orig", None), "args", ())
        code = f", database error {args[0]}" if args and isinstance(args[0], int) else ""
        print(f"LOI: {type(exc).__name__}{code}. Khong in thong tin ket noi.", file=sys.stderr)
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", action="store_true", help="Them thuc don mau neu chua co mon an")
    arguments = parser.parse_args()
    raise SystemExit(asyncio.run(main(seed=arguments.seed)))
