from typing import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

from .config import get_settings


def build_engine(database_url: str, *, echo: bool = False) -> AsyncEngine:
    """Create an async engine with SQLite-safe defaults when needed."""

    connect_args = {}
    is_sqlite = database_url.startswith("sqlite")

    if is_sqlite:
        # Allow longer waits while other connections finish writes.
        connect_args["timeout"] = 30

    engine = create_async_engine(database_url, future=True, echo=echo, connect_args=connect_args)

    if is_sqlite:

        @event.listens_for(engine.sync_engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, connection_record) -> None:  # type: ignore[unused-argument]
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA busy_timeout=30000")
            finally:
                cursor.close()

    return engine


settings = get_settings()
engine = build_engine(settings.database_url)
AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)
Base = declarative_base()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
