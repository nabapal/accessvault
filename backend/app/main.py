import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.api_v1 import api_router
from app.core.config import get_settings
from sqlalchemy import text

from app.core.database import AsyncSessionLocal, Base, engine
from app.services.inventory_poller import build_inventory_poller

settings = get_settings()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001 - FastAPI signature contract
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        result = await conn.execute(text("PRAGMA table_info('system_credentials')"))
        columns = {row[1] for row in result}
        if "login_endpoint" not in columns:
            await conn.execute(text("ALTER TABLE system_credentials ADD COLUMN login_endpoint VARCHAR NOT NULL DEFAULT ''"))
            await conn.execute(
                text(
                    """
                    UPDATE system_credentials
                    SET login_endpoint = (
                        SELECT ip_address FROM systems WHERE systems.id = system_credentials.system_id
                    )
                    WHERE login_endpoint = ''
                    """
                )
            )

        vm_result = await conn.execute(text("PRAGMA table_info('inventory_virtual_machines')"))
        vm_columns = {row[1] for row in vm_result}
        if "cpu_usage_mhz" not in vm_columns:
            await conn.execute(text("ALTER TABLE inventory_virtual_machines ADD COLUMN cpu_usage_mhz INTEGER"))
        if "memory_usage_mb" not in vm_columns:
            await conn.execute(text("ALTER TABLE inventory_virtual_machines ADD COLUMN memory_usage_mb INTEGER"))
        if "datastores" not in vm_columns:
            await conn.execute(
                text("ALTER TABLE inventory_virtual_machines ADD COLUMN datastores JSON DEFAULT '[]'")
            )
        if "networks" not in vm_columns:
            await conn.execute(
                text("ALTER TABLE inventory_virtual_machines ADD COLUMN networks JSON DEFAULT '[]'")
            )
        if "tools_status" not in vm_columns:
            await conn.execute(text("ALTER TABLE inventory_virtual_machines ADD COLUMN tools_status VARCHAR"))

        host_result = await conn.execute(text("PRAGMA table_info('inventory_hosts')"))
        host_columns = {row[1] for row in host_result}
        if "hardware_model" not in host_columns:
            await conn.execute(text("ALTER TABLE inventory_hosts ADD COLUMN hardware_model VARCHAR"))

    poller = None
    if settings.inventory_poller_enabled:
        poller = build_inventory_poller(
            session_factory=AsyncSessionLocal,
            tick_seconds=settings.inventory_poll_tick_seconds,
        )
        await poller.start()
    else:
        logger.info("Inventory poller disabled via configuration")

    try:
        yield
    finally:
        if poller:
            await poller.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(api_router, prefix=settings.api_v1_prefix)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
