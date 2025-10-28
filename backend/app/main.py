import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.api_v1 import api_router
from app.core.config import get_settings
from sqlalchemy import select, text

from app.core.database import AsyncSessionLocal, Base, engine
from app.models.telco import TelcoFabricOnboardingJob
from app.services.inventory_poller import build_inventory_poller
from app.services.telco_collector import build_telco_poller, run_collection_for_job

settings = get_settings()

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN001 - FastAPI signature contract
    needs_aci_backfill = False

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

        aci_result = await conn.execute(text("PRAGMA table_info('aci_fabric_nodes')"))
        aci_columns = {row[1] for row in aci_result}
        if aci_columns and "fabric_job_id" not in aci_columns:
            await conn.execute(text("ALTER TABLE aci_fabric_nodes ADD COLUMN fabric_job_id CHAR(36)"))

        if aci_columns:
            index_list = await conn.execute(text("PRAGMA index_list('aci_fabric_nodes')"))
            has_composite_unique = False
            for index_row in index_list:
                if not index_row[2]:
                    continue
                index_name = index_row[1]
                safe_index_name = index_name.replace("'", "''")
                index_info = await conn.execute(text(f"PRAGMA index_info('{safe_index_name}')"))
                index_columns = [info_row[2] for info_row in index_info]
                if index_columns == ["fabric_job_id", "distinguished_name"]:
                    has_composite_unique = True
                    break

            if aci_columns and not has_composite_unique:
                await conn.execute(text("ALTER TABLE aci_fabric_nodes RENAME TO aci_fabric_nodes_old"))
                await conn.run_sync(Base.metadata.create_all)
                await conn.execute(
                    text(
                        """
                        INSERT INTO aci_fabric_nodes (
                            id,
                            distinguished_name,
                            name,
                            role,
                            node_id,
                            address,
                            serial,
                            model,
                            version,
                            vendor,
                            node_type,
                            apic_type,
                            fabric_state,
                            admin_state,
                            delayed_heartbeat,
                            pod,
                            fabric_job_id,
                            raw_attributes,
                            last_state_change_at,
                            last_modified_at,
                            notes,
                            created_at,
                            updated_at
                        )
                        SELECT
                            id,
                            distinguished_name,
                            name,
                            role,
                            node_id,
                            address,
                            serial,
                            model,
                            version,
                            vendor,
                            node_type,
                            apic_type,
                            fabric_state,
                            admin_state,
                            delayed_heartbeat,
                            pod,
                            fabric_job_id,
                            raw_attributes,
                            last_state_change_at,
                            last_modified_at,
                            notes,
                            created_at,
                            updated_at
                        FROM aci_fabric_nodes_old
                        """
                    )
                )
                await conn.execute(text("DROP TABLE aci_fabric_nodes_old"))
                needs_aci_backfill = True

        telco_result = await conn.execute(text("PRAGMA table_info('telco_fabric_onboarding_jobs')"))
        telco_columns = {row[1] for row in telco_result}
        if telco_columns:  # table exists
            if "port" not in telco_columns:
                await conn.execute(
                    text("ALTER TABLE telco_fabric_onboarding_jobs ADD COLUMN port INTEGER NOT NULL DEFAULT 443")
                )
            if "password_secret" not in telco_columns:
                await conn.execute(text("ALTER TABLE telco_fabric_onboarding_jobs ADD COLUMN password_secret BLOB"))
            if "verify_ssl" not in telco_columns:
                await conn.execute(
                    text("ALTER TABLE telco_fabric_onboarding_jobs ADD COLUMN verify_ssl BOOLEAN NOT NULL DEFAULT 0")
                )
            if "poll_interval_seconds" not in telco_columns:
                await conn.execute(
                    text(
                        "ALTER TABLE telco_fabric_onboarding_jobs ADD COLUMN poll_interval_seconds INTEGER NOT NULL DEFAULT 900"
                    )
                )
            if "last_snapshot" not in telco_columns:
                await conn.execute(text("ALTER TABLE telco_fabric_onboarding_jobs ADD COLUMN last_snapshot JSON"))
            if "last_polled_at" not in telco_columns:
                await conn.execute(text("ALTER TABLE telco_fabric_onboarding_jobs ADD COLUMN last_polled_at DATETIME"))

    inventory_poller = None
    telco_poller = None
    if needs_aci_backfill:
        jobs: list[TelcoFabricOnboardingJob] = []
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(TelcoFabricOnboardingJob))
            jobs = result.scalars().all()
            if jobs:
                logger.info("Running Cisco ACI backfill for %d onboarding jobs", len(jobs))
            for job in jobs:
                job.start_validation()
                collection = await run_collection_for_job(session, job)
                if collection.success:
                    job.mark_validation_success()
                    job.last_snapshot = collection.snapshot
                    job.last_polled_at = collection.timestamp
                else:
                    job.mark_validation_failure(collection.message)
                    job.last_snapshot = None
                    logger.warning(
                        "ACI backfill failed for job %s: %s",
                        job.id,
                        collection.message or "unknown error",
                    )
                await session.commit()
        if jobs:
            logger.info("ACI backfill completed")

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

    if needs_aci_backfill:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(TelcoFabricOnboardingJob))
            jobs = result.scalars().all()
            if jobs:
                logger.info("Running Cisco ACI backfill for %d onboarding jobs", len(jobs))
            for job in jobs:
                job.start_validation()
                collection = await run_collection_for_job(session, job)
                if collection.success:
                    job.mark_validation_success()
                    job.last_snapshot = collection.snapshot
                    job.last_polled_at = collection.timestamp
                else:
                    job.mark_validation_failure(collection.message)
                    job.last_snapshot = None
                    logger.warning(
                        "ACI backfill failed for job %s: %s",
                        job.id,
                        collection.message or "unknown error",
                    )
                await session.commit()
        logger.info("ACI backfill completed")

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
