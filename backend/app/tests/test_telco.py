import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient

from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models import (
    TelcoOnboardingStatus,
    User,
    UserRoleEnum,
)
from app.services.telco_collector import TelcoCollectionResult


@pytest.fixture
async def admin_user() -> User:
    async with AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="admin-telco@example.com",
            full_name="Telco Admin",
            hashed_password=get_password_hash("adminpass"),
            role=UserRoleEnum.ADMIN,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


async def _login(client: AsyncClient, email: str, password: str) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return token


@pytest.mark.anyio("asyncio")
async def test_create_telco_onboarding_job(async_client: AsyncClient, admin_user: User) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    payload = {
        "name": "DC1 Fabric",
        "fabric_type": "aci",
        "target_host": "10.10.10.10",
        "port": 443,
        "username": "admin",
        "description": "Primary datacenter fabric",
        "connection_params": {"protocol": "https"},
        "verify_ssl": False,
        "poll_interval_seconds": 600,
        "password": "cisco-apic",
        "auto_validate": False,
    }

    response = await async_client.post(
        "/api/v1/telco/onboarding/jobs",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == payload["name"]
    assert data["status"] == TelcoOnboardingStatus.PENDING.value
    assert data["has_credentials"] is True
    assert data["poll_interval_seconds"] == payload["poll_interval_seconds"]
    assert data["verify_ssl"] == payload["verify_ssl"]

    list_response = await async_client.get(
        "/api/v1/telco/onboarding/jobs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert list_response.status_code == 200
    job_list = list_response.json()
    assert len(job_list) == 1
    assert job_list[0]["target_host"] == payload["target_host"]


@pytest.mark.anyio("asyncio")
async def test_validate_telco_onboarding_job(async_client: AsyncClient, admin_user: User, monkeypatch: pytest.MonkeyPatch) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    async def _fake_collection(session, job, password_override=None):  # noqa: ANN001
        return TelcoCollectionResult(
            success=True,
            timestamp=datetime.now(timezone.utc),
            snapshot={"module_count": 3},
        )

    monkeypatch.setattr("app.routers.telco.run_collection_for_job", _fake_collection)

    create_resp = await async_client.post(
        "/api/v1/telco/onboarding/jobs",
        json={
            "name": "NXOS Core",
            "fabric_type": "nxos",
            "target_host": "core-switch.local",
            "port": 8443,
            "username": "svc-net",
            "connection_params": {"transport": "nxapi-https"},
            "verify_ssl": False,
            "poll_interval_seconds": 720,
            "password": "nxos-secret",
            "auto_validate": False,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_resp.status_code == 201
    job_id = create_resp.json()["id"]

    validate_resp = await async_client.post(
        f"/api/v1/telco/onboarding/jobs/{job_id}/validate",
        json={"force_fail": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert validate_resp.status_code == 200
    validated = validate_resp.json()
    assert validated["status"] == TelcoOnboardingStatus.READY.value
    assert validated["last_error"] is None
    assert validated["last_snapshot"] == {"module_count": 3}

    # simulate failure path
    fail_resp = await async_client.post(
        f"/api/v1/telco/onboarding/jobs/{job_id}/validate",
        json={"force_fail": True, "error_message": "SSH handshake failed"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert fail_resp.status_code == 200
    failed_job = fail_resp.json()
    assert failed_job["status"] == TelcoOnboardingStatus.FAILED.value
    assert failed_job["last_error"] == "SSH handshake failed"