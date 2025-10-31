import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import database
from app.core.security import get_password_hash
from app.models import User, UserRoleEnum


@pytest.fixture
async def admin_user() -> User:
    async with database.AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="admin@example.com",
            full_name="Admin User",
            hashed_password=get_password_hash("adminpass"),
            role=UserRoleEnum.ADMIN,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.mark.anyio("asyncio")
async def test_login_flow(async_client: AsyncClient, admin_user: User):
    response = await async_client.post(
        "/api/v1/auth/login",
        data={"username": admin_user.email, "password": "adminpass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert "access_token" in payload
    token = payload["access_token"]

    headers = {"Authorization": f"Bearer {token}"}
    me_response = await async_client.get("/api/v1/auth/me", headers=headers)
    assert me_response.status_code == 200
    me_data = me_response.json()
    assert me_data["email"] == admin_user.email


@pytest.mark.anyio("asyncio")
async def test_register_user(async_client: AsyncClient, admin_user: User):
    login_resp = await async_client.post(
        "/api/v1/auth/login",
        data={"username": admin_user.email, "password": "adminpass"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    token = login_resp.json()["access_token"]

    create_resp = await async_client.post(
        "/api/v1/auth/register",
        json={
            "email": "user@example.com",
            "full_name": "Example User",
            "password": "userpass",
            "role": "user",
            "is_active": True,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create_resp.status_code == 201
    data = create_resp.json()
    assert data["email"] == "user@example.com"

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.email == "user@example.com"))
        created_user = result.scalar_one_or_none()
        assert created_user is not None
        assert created_user.role == UserRoleEnum.USER
