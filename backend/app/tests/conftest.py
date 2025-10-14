import asyncio
from typing import AsyncIterator, List

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core import database
from app.core.config import Settings, get_settings
from app.main import app


class TestSettings(Settings):
    database_url: str = "sqlite+aiosqlite:///./test.db"
    secret_key: str = "test-secret-key"
    password_salt: str = "test-salt"
    fernet_key: str = "Z3VsbGl2ZXJzLXJvY2stY2Fja2xlLXNhbHQtMTIzNDU2Nzg5MDEyMzQ1Ng=="
    cors_origins: List[str] = ["http://localhost"]


@pytest.fixture(scope="session")
def event_loop() -> AsyncIterator[asyncio.AbstractEventLoop]:
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session", autouse=True)
def override_settings() -> AsyncIterator[None]:
    original_settings = get_settings()
    original_engine = database.engine
    original_session_factory = database.AsyncSessionLocal
    original_settings_obj = database.settings

    test_settings = TestSettings()

    app.dependency_overrides[get_settings] = lambda: test_settings
    get_settings.cache_clear()
    database.settings = test_settings
    database.engine = create_async_engine(test_settings.database_url, future=True, echo=False)
    database.AsyncSessionLocal = async_sessionmaker(bind=database.engine, expire_on_commit=False)
    yield
    app.dependency_overrides.pop(get_settings, None)
    get_settings.cache_clear()
    database.settings = original_settings
    database.engine = original_engine
    database.AsyncSessionLocal = original_session_factory


@pytest.fixture(autouse=True)
async def setup_database() -> AsyncIterator[None]:
    async with database.engine.begin() as conn:
        await conn.run_sync(database.Base.metadata.create_all)
    yield
    async with database.engine.begin() as conn:
        await conn.run_sync(database.Base.metadata.drop_all)


@pytest.fixture()
async def async_client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
