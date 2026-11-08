"""Check, or explicitly add, the US8.1 table in foodorder_dev only.

    .venv/bin/python -B migrate_interactions.py          # SELECT/inspection only
    .venv/bin/python -B migrate_interactions.py --apply  # create the missing table
"""

import argparse
import asyncio
import json
import sys

from sqlalchemy import func, select

import models
from database import engine
from init_database import (
    DEVELOPMENT_DATABASE, EXPECTED_TABLES, DevelopmentDatabaseError,
    inspect_schema, validate_target, verify_connection,
)


async def main(apply=False):
    try:
        validate_target(engine.url, models.Base.metadata)
        async with engine.begin() as connection:
            await verify_connection(connection)
            before, issues = await connection.run_sync(inspect_schema)
            required = EXPECTED_TABLES - {"user_interactions"}
            if issues or not required.issubset(before):
                raise DevelopmentDatabaseError(
                    "Dung lai: schema nen chua khop models. " + "; ".join(issues)
                )
            counts = {}
            for name in sorted(required):
                counts[name] = (await connection.execute(
                    select(func.count()).select_from(models.Base.metadata.tables[name])
                )).scalar_one()
            if apply and "user_interactions" not in before:
                # Only this new table is eligible. No create_all, ALTER, seed or DML.
                await connection.run_sync(models.UserInteraction.__table__.create, checkfirst=True)
            after, issues = await connection.run_sync(inspect_schema)
            if issues or (apply and "user_interactions" not in after):
                raise DevelopmentDatabaseError("Schema sau kiem tra chua hop le: " + "; ".join(issues))
            for name, count in counts.items():
                actual = (await connection.execute(
                    select(func.count()).select_from(models.Base.metadata.tables[name])
                )).scalar_one()
                if actual != count:
                    raise DevelopmentDatabaseError("So dong bang nen da thay doi trong luc kiem tra.")
            report = {
                "database": DEVELOPMENT_DATABASE, "mode": "apply" if apply else "check",
                "created_tables": sorted(after - before),
                "pending_tables": [] if "user_interactions" in after else ["user_interactions"],
                "existing_row_counts": counts,
            }
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except DevelopmentDatabaseError as exc:
        print(f"LOI: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        args = getattr(getattr(exc, "orig", None), "args", ())
        code = args[0] if args and isinstance(args[0], int) else None
        print(f"LOI: {type(exc).__name__}, database code {code}. Khong in thong tin ket noi.", file=sys.stderr)
        if code in (1044, 1142):
            print("Can quyen CREATE/INDEX tren foodorder_dev; khong cap quyen database khac.", file=sys.stderr)
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Tao duy nhat bang user_interactions con thieu")
    raise SystemExit(asyncio.run(main(apply=parser.parse_args().apply)))
