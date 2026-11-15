from pathlib import Path
import os
from dotenv import load_dotenv
from fastapi import Request
from sqlalchemy import event, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

load_dotenv(Path(__file__).with_name(".env"))

data_dir = Path(__file__).parent / ".local"
data_dir.mkdir(exist_ok=True)

raw_database_url = os.getenv("DATABASE_URL", "").strip()

if raw_database_url:
    parsed_url = make_url(raw_database_url)

    if parsed_url.drivername in {
        "postgres",
        "postgresql",
        "postgresql+asyncpg",
    }:
        query = dict(parsed_url.query)
        query.pop("sslmode", None)

        drivername = (
            "postgresql+asyncpg"
            if parsed_url.drivername in {"postgres", "postgresql"}
            else parsed_url.drivername
        )

        parsed_url = parsed_url.set(
            drivername=drivername,
            query=query,
        )

    DATABASE_URL = parsed_url.render_as_string(hide_password=False)
else:
    DATABASE_URL = (
        f"sqlite+aiosqlite:///{(data_dir / 'foodorder.db').as_posix()}"
    )

IS_SQLITE = DATABASE_URL.startswith("sqlite")
engine_options = {"pool_pre_ping": True}

if IS_SQLITE:
    engine_options["connect_args"] = {"timeout": 30}
else:
    engine_options.update({
        "connect_args": {"ssl": "require"},
        "pool_size": 3,
        "max_overflow": 2,
    })

engine = create_async_engine(DATABASE_URL, **engine_options)


class Base(DeclarativeBase):
    pass


if IS_SQLITE:
    @event.listens_for(engine.sync_engine, "connect")
    def configure_sqlite(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")


AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    autoflush=False,
)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db(request: Request):
    async with AsyncSessionLocal() as session:
        if IS_SQLITE and request.method not in ("GET", "HEAD", "OPTIONS"):
            await session.execute(text("BEGIN IMMEDIATE"))
        try:
            yield session
        finally:
            await session.rollback()


async def ping_db():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
