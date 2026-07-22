import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.api_v1 import api_router
from app.core.config import get_settings
from app.core.database import AsyncSessionLocal
from app.core.migrator import run_migrations
from app.services.inventory_poller import build_inventory_poller
from app.services.ipmpls_poller import build_ipmpls_poller
from app.services.nxos_poller import build_nxos_poller
from app.services.cgnat_poller import build_cgnat_poller
from app.services.telco_collector import build_telco_poller

settings = get_settings()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001 - FastAPI signature contract
    await run_migrations()

    inventory_poller = None
    telco_poller = None
    ipmpls_poller = None
    nxos_poller = None
    cgnat_poller = None

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

    if settings.ipmpls_poller_enabled:
        ipmpls_poller = build_ipmpls_poller(
            session_factory=AsyncSessionLocal,
            tick_seconds=settings.ipmpls_poll_tick_seconds,
        )
        await ipmpls_poller.start()
    else:
        logger.info("IP-MPLS poller disabled via configuration")

    if settings.nxos_poller_enabled:
        nxos_poller = build_nxos_poller(
            session_factory=AsyncSessionLocal,
            tick_seconds=settings.nxos_poll_tick_seconds,
        )
        await nxos_poller.start()
    else:
        logger.info("NX-OS poller disabled via configuration")

    if settings.cgnat_poller_enabled:
        cgnat_poller = build_cgnat_poller(
            session_factory=AsyncSessionLocal,
            tick_seconds=settings.cgnat_poll_tick_seconds,
        )
        await cgnat_poller.start()
    else:
        logger.info("CGNAT poller disabled via configuration")

    try:
        yield
    finally:
        if cgnat_poller:
            await cgnat_poller.stop()
        if nxos_poller:
            await nxos_poller.stop()
        if ipmpls_poller:
            await ipmpls_poller.stop()
        if telco_poller:
            await telco_poller.stop()
        if inventory_poller:
            await inventory_poller.stop()


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.include_router(api_router, prefix=settings.api_v1_prefix)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
