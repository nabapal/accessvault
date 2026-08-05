from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models.telco import TelcoFabricOnboardingJob, TelcoFabricType
from app.schemas import (
    TelcoConnectivityResult,
    TelcoOnboardingJobCreate,
    TelcoOnboardingJobRead,
    TelcoOnboardingJobUpdate,
    TelcoOnboardingValidationRequest,
    TelcoSyncResult,
)
from app.services.crypto import encrypt_secret
from app.services.pbr_collector import collect_pbr_for_job
from app.services.telco_collector import run_collection_for_job, test_connection_for_job

router = APIRouter(prefix="/telco", tags=["telco"])


async def _get_job_or_404(db: AsyncSession, job_id: UUID) -> TelcoFabricOnboardingJob:
    result = await db.execute(select(TelcoFabricOnboardingJob).where(TelcoFabricOnboardingJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding job not found")
    return job


@router.get("/onboarding/jobs", response_model=list[TelcoOnboardingJobRead])
async def list_onboarding_jobs(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),  # noqa: B008
) -> list[TelcoOnboardingJobRead]:
    result = await db.execute(select(TelcoFabricOnboardingJob).order_by(TelcoFabricOnboardingJob.created_at.desc()))
    jobs = result.scalars().all()
    return [TelcoOnboardingJobRead.model_validate(job) for job in jobs]


@router.post("/onboarding/jobs", response_model=TelcoOnboardingJobRead, status_code=status.HTTP_201_CREATED)
async def create_onboarding_job(
    payload: TelcoOnboardingJobCreate,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
) -> TelcoOnboardingJobRead:
    job = TelcoFabricOnboardingJob(
        name=payload.name.strip(),
        fabric_type=payload.fabric_type,
        target_host=payload.target_host.strip(),
        port=payload.port,
        username=payload.username.strip() if payload.username else None,
        description=payload.description.strip() if payload.description else None,
        connection_params=payload.connection_params or {},
        verify_ssl=payload.verify_ssl,
        poll_interval_seconds=payload.poll_interval_seconds,
    )
    job.password_secret = encrypt_secret(payload.password)

    db.add(job)
    await db.flush()

    if payload.auto_validate:
        job.start_validation()
        result = await run_collection_for_job(db, job, password_override=payload.password)
        if result.success:
            job.mark_validation_success()
            job.last_snapshot = result.snapshot
            job.last_polled_at = result.timestamp
        else:
            job.mark_validation_failure(result.message)
            job.last_snapshot = None

    await db.commit()
    await db.refresh(job)
    return TelcoOnboardingJobRead.model_validate(job)


@router.get("/onboarding/jobs/{job_id}", response_model=TelcoOnboardingJobRead)
async def get_onboarding_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),  # noqa: B008
) -> TelcoOnboardingJobRead:
    result = await db.execute(select(TelcoFabricOnboardingJob).where(TelcoFabricOnboardingJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding job not found")
    return TelcoOnboardingJobRead.model_validate(job)


@router.post("/onboarding/jobs/{job_id}/validate", response_model=TelcoOnboardingJobRead)
async def validate_onboarding_job(
    job_id: UUID,
    payload: TelcoOnboardingValidationRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
) -> TelcoOnboardingJobRead:
    result = await db.execute(select(TelcoFabricOnboardingJob).where(TelcoFabricOnboardingJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding job not found")
    password_override = payload.password
    if payload.password:
        job.password_secret = encrypt_secret(payload.password)
    job.start_validation()
    if payload.force_fail:
        job.mark_validation_failure(payload.error_message)
        job.last_snapshot = None
    else:
        collection_result = await run_collection_for_job(db, job, password_override=password_override)
        if collection_result.success:
            job.mark_validation_success()
            job.last_snapshot = collection_result.snapshot
            job.last_polled_at = collection_result.timestamp
        else:
            job.mark_validation_failure(collection_result.message or payload.error_message)
            job.last_snapshot = None
    await db.commit()
    await db.refresh(job)
    return TelcoOnboardingJobRead.model_validate(job)


@router.patch("/onboarding/jobs/{job_id}", response_model=TelcoOnboardingJobRead)
async def update_onboarding_job(
    job_id: UUID,
    payload: TelcoOnboardingJobUpdate,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
) -> TelcoOnboardingJobRead:
    job = await _get_job_or_404(db, job_id)

    data = payload.model_dump(exclude_unset=True)
    password = data.pop("password", None)

    if "name" in data and data["name"] is not None:
        job.name = data["name"].strip()
    if "target_host" in data and data["target_host"] is not None:
        job.target_host = data["target_host"].strip()
    if "port" in data and data["port"] is not None:
        job.port = data["port"]
    if "username" in data:
        job.username = data["username"].strip() if data["username"] else None
    if "verify_ssl" in data and data["verify_ssl"] is not None:
        job.verify_ssl = data["verify_ssl"]
    if "description" in data:
        job.description = data["description"].strip() if data["description"] else None
    if "connection_params" in data and data["connection_params"] is not None:
        job.connection_params = data["connection_params"]
    if "poll_interval_seconds" in data and data["poll_interval_seconds"] is not None:
        job.poll_interval_seconds = data["poll_interval_seconds"]

    # A non-empty password rotates the stored credential; blank keeps the existing one.
    if password and password.strip():
        job.password_secret = encrypt_secret(password)

    await db.commit()
    await db.refresh(job)
    return TelcoOnboardingJobRead.model_validate(job)


@router.post("/onboarding/jobs/{job_id}/test", response_model=TelcoConnectivityResult)
async def test_onboarding_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
) -> TelcoConnectivityResult:
    job = await _get_job_or_404(db, job_id)
    probe = await test_connection_for_job(job)
    return TelcoConnectivityResult(
        success=probe.success,
        message=probe.message,
        latency_ms=probe.latency_ms,
        checked_at=datetime.now(timezone.utc),
    )


@router.post("/onboarding/jobs/{job_id}/sync", response_model=TelcoSyncResult)
async def sync_onboarding_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
) -> TelcoSyncResult:
    job = await _get_job_or_404(db, job_id)

    job.start_validation()
    result = await run_collection_for_job(db, job)
    if not result.success:
        job.mark_validation_failure(result.message)
        job.last_snapshot = None
        await db.commit()
        await db.refresh(job)
        return TelcoSyncResult(
            success=False,
            message=result.message or "Inventory collection failed.",
            snapshot=None,
            pbr_service_count=None,
            job=TelcoOnboardingJobRead.model_validate(job),
        )

    job.mark_validation_success()
    job.last_snapshot = result.snapshot
    job.last_polled_at = result.timestamp

    # For ACI fabrics, a full sync also refreshes PBR flow monitoring (a separate
    # collector). A PBR failure never overwrites good data and only degrades the message.
    pbr_service_count = None
    pbr_note = ""
    if job.fabric_type == TelcoFabricType.ACI:
        pbr_result = await collect_pbr_for_job(db, job)
        if pbr_result.success:
            pbr_service_count = (pbr_result.snapshot or {}).get("service_count")
            pbr_note = f" PBR: {pbr_service_count} service(s)."
        else:
            pbr_note = f" PBR refresh failed: {pbr_result.message}."

    await db.commit()
    await db.refresh(job)

    return TelcoSyncResult(
        success=True,
        message=f"Inventory synced.{pbr_note}".strip(),
        snapshot=result.snapshot,
        pbr_service_count=pbr_service_count,
        job=TelcoOnboardingJobRead.model_validate(job),
    )


@router.delete("/onboarding/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_onboarding_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_admin),
) -> None:
    result = await db.execute(select(TelcoFabricOnboardingJob).where(TelcoFabricOnboardingJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Onboarding job not found")
    await db.delete(job)
    await db.commit()
