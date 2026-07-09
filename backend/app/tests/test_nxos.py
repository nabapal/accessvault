import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import database
from app.core.security import get_password_hash
from app.models import NxosDevice, User, UserRoleEnum


@pytest.fixture
async def admin_user() -> User:
    async with database.AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="admin-nxos@example.com",
            full_name="NX-OS Admin",
            hashed_password=get_password_hash("adminpass"),
            role=UserRoleEnum.ADMIN,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.fixture
async def normal_user() -> User:
    async with database.AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="user-nxos@example.com",
            full_name="NX-OS User",
            hashed_password=get_password_hash("userpass"),
            role=UserRoleEnum.USER,
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
    return response.json()["access_token"]


async def _create_device(client: AsyncClient, token: str, *, name: str, mgmt_ip: str, password: str = "secret1") -> dict:
    resp = await client.post(
        "/api/v1/nxos/devices",
        json={
            "name": name,
            "mgmt_ip": mgmt_ip,
            "platform": "nxos",
            "role": "Nexus",
            "username": "netadmin",
            "password": password,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _stored_secret(device_id: str) -> bytes:
    async with database.AsyncSessionLocal() as session:
        device = (
            await session.execute(select(NxosDevice).where(NxosDevice.id == uuid.UUID(device_id)))
        ).scalar_one()
        return device.password_secret


@pytest.mark.anyio("asyncio")
async def test_update_device_fields_and_keep_secret(async_client: AsyncClient, admin_user: User) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")
    device = await _create_device(async_client, token, name="nexus-1", mgmt_ip="10.1.0.1")
    original_secret = await _stored_secret(device["id"])

    resp = await async_client.patch(
        f"/api/v1/nxos/devices/{device['id']}",
        json={"name": "nexus-1-renamed", "role": "Spine", "poll_interval_seconds": 600, "password": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "nexus-1-renamed"
    assert body["role"] == "Spine"
    assert body["poll_interval_seconds"] == 600
    assert "password" not in body and "password_secret" not in body
    assert await _stored_secret(device["id"]) == original_secret


@pytest.mark.anyio("asyncio")
async def test_update_device_rotates_password(async_client: AsyncClient, admin_user: User) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")
    device = await _create_device(async_client, token, name="nexus-2", mgmt_ip="10.1.0.2")
    original_secret = await _stored_secret(device["id"])

    resp = await async_client.patch(
        f"/api/v1/nxos/devices/{device['id']}",
        json={"password": "rotated-secret"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    new_secret = await _stored_secret(device["id"])
    assert new_secret is not None and new_secret != original_secret


@pytest.mark.anyio("asyncio")
async def test_update_duplicate_mgmt_ip_conflict(async_client: AsyncClient, admin_user: User) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")
    await _create_device(async_client, token, name="nexus-3", mgmt_ip="10.1.0.3")
    device_b = await _create_device(async_client, token, name="nexus-4", mgmt_ip="10.1.0.4")

    resp = await async_client.patch(
        f"/api/v1/nxos/devices/{device_b['id']}",
        json={"mgmt_ip": "10.1.0.3"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 409, resp.text


@pytest.mark.anyio("asyncio")
async def test_update_same_mgmt_ip_allowed(async_client: AsyncClient, admin_user: User) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")
    device = await _create_device(async_client, token, name="nexus-5", mgmt_ip="10.1.0.5")

    resp = await async_client.patch(
        f"/api/v1/nxos/devices/{device['id']}",
        json={"mgmt_ip": "10.1.0.5", "name": "nexus-5b"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == "nexus-5b"


@pytest.mark.anyio("asyncio")
async def test_update_requires_admin(async_client: AsyncClient, admin_user: User, normal_user: User) -> None:
    admin_token = await _login(async_client, admin_user.email, "adminpass")
    device = await _create_device(async_client, admin_token, name="nexus-6", mgmt_ip="10.1.0.6")

    user_token = await _login(async_client, normal_user.email, "userpass")
    resp = await async_client.patch(
        f"/api/v1/nxos/devices/{device['id']}",
        json={"name": "hacked"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert resp.status_code == 403, resp.text
