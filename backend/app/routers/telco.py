from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models.telco import TelcoFabricOnboardingJob
from app.schemas import TelcoOnboardingJobCreate, TelcoOnboardingJobRead, TelcoOnboardingValidationRequest
from app.services.crypto import encrypt_secret
from app.services.telco_collector import run_collection_for_job

router = APIRouter(prefix="/telco", tags=["telco"])


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
