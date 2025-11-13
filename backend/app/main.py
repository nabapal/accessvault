import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.api_v1 import api_router
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.core.migrator import run_migrations
from app.services.inventory_poller import build_inventory_poller
from app.services.telco_collector import build_telco_poller

settings = get_settings()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001 - FastAPI signature contract
    await run_migrations()

    inventory_poller = None
    telco_poller = None

    if settings.inventory_poller_enabled:
        inventory_poller = build_inventory_poller(
            session_factory=AsyncSessionLocal,
            tick_seconds=settings.inventory_poll_tick_seconds,
        )
        await inventory_poller.start()
    else:
        logger.info("Inventory poller disabled via configuration")

    if settings.telco_poller_enabled:
        telco_poller = build_telco_poller(
            session_factory=AsyncSessionLocal,
            tick_seconds=settings.telco_poll_tick_seconds,
        )
        await telco_poller.start()
    else:
        logger.info("Telco poller disabled via configuration")

    try:
        yield
    finally:
        if telco_poller:
            await telco_poller.stop()
        if inventory_poller:
            await inventory_poller.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.include_router(api_router, prefix=settings.api_v1_prefix)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
