import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import delete

from app.core import database
from app.core.security import get_password_hash
from app.models import (
    AciFabricNode,
    AciFabricNodeDetail,
    AciFabricNodeInterface,
    AciNodeRole,
    User,
    UserRoleEnum,
)


@pytest.fixture
async def admin_user() -> User:
    async with database.AsyncSessionLocal() as session:
        user = User(
            id=uuid.uuid4(),
            email="admin-aci@example.com",
            full_name="ACI Admin",
            hashed_password=get_password_hash("adminpass"),
            role=UserRoleEnum.ADMIN,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


@pytest.fixture
async def populate_fabric_nodes() -> None:
    async with database.AsyncSessionLocal() as session:
        await session.execute(delete(AciFabricNodeInterface))
        await session.execute(delete(AciFabricNodeDetail))
        await session.execute(delete(AciFabricNode))
        await session.commit()

        nodes: list[AciFabricNode] = []
        for idx in range(20):
            nodes.append(
                AciFabricNode(
                    id=uuid.uuid4(),
                    distinguished_name=f"topology/pod-1/node-{100 + idx}",
                    name=f"leaf-{idx:02d}",
                    role=AciNodeRole.LEAF,
                    node_id=str(100 + idx),
                    address=f"10.0.0.{idx}",
                    serial=f"SN-LEAF-{idx:04d}",
                    model="N9K-C93180YC-FX",
                    version="5.2(3)",
                )
            )
        for idx in range(5):
            nodes.append(
                AciFabricNode(
                    id=uuid.uuid4(),
                    distinguished_name=f"topology/pod-2/node-{200 + idx}",
                    name=f"spine-{idx:02d}",
                    role=AciNodeRole.SPINE,
                    node_id=str(200 + idx),
                    address=f"10.0.1.{idx}",
                    serial=f"SN-SPINE-{idx:04d}",
                    model="N9K-C9508",
                    version="5.2(3a)",
                )
            )
        for idx in range(5):
            nodes.append(
                AciFabricNode(
                    id=uuid.uuid4(),
                    distinguished_name=f"topology/pod-3/node-{300 + idx}",
                    name=f"controller-{idx:02d}",
                    role=AciNodeRole.CONTROLLER,
                    node_id=str(300 + idx),
                    address=f"10.0.2.{idx}",
                    serial=f"SN-CTRL-{idx:04d}",
                    model="APIC-SERVER",
                    version="5.2(2)",
                )
            )
        session.add_all(nodes)
        await session.commit()


@pytest.fixture
async def node_with_detail() -> AciFabricNode:
    async with database.AsyncSessionLocal() as session:
        node = AciFabricNode(
            id=uuid.uuid4(),
            distinguished_name="topology/pod-1/node-999",
            name="leaf-999",
            role=AciNodeRole.LEAF,
            node_id="999",
            address="10.10.10.10",
            serial="SN-LEAF-9999",
            model="N9K-C93180YC-FX",
            version="5.2(3)",
        )
        session.add(node)
        await session.flush()

        detail = AciFabricNodeDetail(
            node_id=node.id,
            general={"system_name": "leaf-999", "fabric_domain": "test-fabric"},
            health={"samples": [{"window": "15min", "health_last": 90.0}]},
            resources={
                "cpu": {"usage_pct": 15.0, "idle_pct": 85.0},
                "memory": {"usage_pct": 40.0, "total_kb": 1024},
            },
            environment={"temperatures": [], "fans": [], "power_supplies": []},
            firmware={"version": "n9000-15.3(2a)"},
            port_channels=[],
            connected_endpoints=[],
            collected_at=datetime.now(timezone.utc),
        )
        interface = AciFabricNodeInterface(
            node_id=node.id,
            name="eth1/1",
            distinguished_name="topology/pod-1/node-999/sys/phys-[eth1/1]",
            description="uplink",
            admin_state="up",
            oper_state="up",
            oper_speed="10G",
            usage="epg",
            attributes={},
            transceiver={},
            stats={},
        )
        session.add_all([detail, interface])
        await session.commit()
        await session.refresh(node)
        return node


async def _login(client: AsyncClient, email: str, password: str) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        data={"username": email, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.mark.anyio("asyncio")
async def test_list_fabric_nodes_pagination(async_client: AsyncClient, admin_user: User, populate_fabric_nodes: None) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    response = await async_client.get(
        "/api/v1/aci/fabric/nodes",
        params={"page": 1, "page_size": 10},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 30
    assert data["page"] == 1
    assert data["page_size"] == 10
    assert data["has_next"] is True
    assert data["has_prev"] is False
    assert len(data["items"]) == 10
    assert data["items"][0]["name"] == "controller-00"
    assert "site_name" in data["items"][0]
    assert "rack_location" in data["items"][0]

    third_page = await async_client.get(
        "/api/v1/aci/fabric/nodes",
        params={"page": 3, "page_size": 10},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert third_page.status_code == 200
    third_data = third_page.json()
    assert third_data["page"] == 3
    assert third_data["has_next"] is False
    assert third_data["has_prev"] is True
    assert len(third_data["items"]) == 10

    oversized_page = await async_client.get(
        "/api/v1/aci/fabric/nodes",
        params={"page": 99, "page_size": 10},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert oversized_page.status_code == 200
    oversized_data = oversized_page.json()
    assert oversized_data["page"] == 3
    assert len(oversized_data["items"]) == 10
    assert oversized_data["has_next"] is False


@pytest.mark.anyio("asyncio")
async def test_list_fabric_nodes_filters(async_client: AsyncClient, admin_user: User, populate_fabric_nodes: None) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    spine_response = await async_client.get(
        "/api/v1/aci/fabric/nodes",
        params={"role": "spine", "page_size": 50},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert spine_response.status_code == 200
    spine_data = spine_response.json()
    assert spine_data["total"] == 5
    assert all(item["role"] == "spine" for item in spine_data["items"])

    search_response = await async_client.get(
        "/api/v1/aci/fabric/nodes",
        params={"search": "controller-01"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert search_response.status_code == 200
    search_data = search_response.json()
    assert search_data["total"] >= 1
    assert any("controller-01" in item["name"] for item in search_data["items"])


@pytest.mark.anyio("asyncio")
async def test_fabric_summary_details(async_client: AsyncClient, admin_user: User, populate_fabric_nodes: None) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    response = await async_client.get(
        "/api/v1/aci/fabric/summary/details",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["total_nodes"] == 30
    assert data["total_fabrics"] == 1
    assert "leaf" in data["available_roles"]
    assert "N9K-C93180YC-FX" in data["available_models"]
    first_fabric = data["fabrics"][0]
    assert first_fabric["by_role"].get("leaf") == 20
    assert first_fabric["by_role"].get("spine") == 5
    assert first_fabric["by_role"].get("controller") == 5

    leaves_only = await async_client.get(
        "/api/v1/aci/fabric/summary/details",
        params={"roles": ["leaf"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert leaves_only.status_code == 200
    leaves_data = leaves_only.json()
    assert leaves_data["total_nodes"] == 20
    assert leaves_data["fabrics"][0]["by_role"].get("leaf") == 20


@pytest.mark.anyio("asyncio")
async def test_get_fabric_node_detail(async_client: AsyncClient, admin_user: User, node_with_detail: AciFabricNode) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    response = await async_client.get(
        f"/api/v1/aci/fabric/nodes/{node_with_detail.id}/detail",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["node"]["id"] == str(node_with_detail.id)
    assert data["general"]["system_name"] == "leaf-999"
    assert data["firmware"]["version"] == "n9000-15.3(2a)"
    assert data["resources"]["cpu"]["usage_pct"] == 15.0


@pytest.mark.anyio("asyncio")
async def test_list_fabric_node_interfaces(async_client: AsyncClient, admin_user: User, node_with_detail: AciFabricNode) -> None:
    token = await _login(async_client, admin_user.email, "adminpass")

    response = await async_client.get(
        f"/api/v1/aci/fabric/nodes/{node_with_detail.id}/interfaces",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "eth1/1"
    assert data[0]["epg_bindings"] == []
    assert data[0]["l3out_bindings"] == []