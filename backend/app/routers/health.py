from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["meta"])


def _version_payload() -> dict:
    s = get_settings()
    return {
        "status": "ok",
        "name": s.app_name,
        "version": s.app_version,
        "environment": s.environment,
        "git_sha": s.git_sha,
        "build_date": s.build_date,
    }


@router.get("/health")
async def health() -> dict:
    """Liveness + build traceability."""
    return _version_payload()


@router.get("/version")
async def version() -> dict:
    """Running build version, git SHA, and build date."""
    return _version_payload()
