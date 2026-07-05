from __future__ import annotations

from collections import Counter
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models import (
    IpMplsDevice,
    IpMplsInterface,
    IpMplsModule,
    IpMplsNeighbor,
    IpMplsPlatform,
    IpMplsVrf,
)
from app.schemas import (
    IpMplsDeviceCreate,
    IpMplsDevicePage,
    IpMplsDeviceRead,
    IpMplsDeviceUpdate,
    IpMplsInterfaceRead,
    IpMplsModuleRead,
    IpMplsNeighborRead,
    IpMplsSummary,
    IpMplsSyncResult,
    IpMplsTopology,
    IpMplsTopologyLink,
    IpMplsTopologyNode,
    IpMplsVrfRead,
)
from app.services.crypto import encrypt_secret
from app.services.ipmpls_collector import run_collection_for_device

router = APIRouter(prefix="/ipmpls", tags=["ipmpls"])


async def _get_device(db: AsyncSession, device_id: str) -> IpMplsDevice:
    device = await db.get(IpMplsDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="IP-MPLS device not found")
    return device


@router.get("/devices", response_model=IpMplsDevicePage)
async def list_devices(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    platform: Optional[IpMplsPlatform] = Query(default=None),
    search: Optional[str] = Query(default=None, description="Search name/hostname/mgmt IP/model/serial"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> IpMplsDevicePage:
    conditions = []
    if platform is not None:
        conditions.append(IpMplsDevice.platform == platform)
    if search:
        pattern = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(IpMplsDevice.name).like(pattern),
                func.lower(func.coalesce(IpMplsDevice.hostname, "")).like(pattern),
                func.lower(IpMplsDevice.mgmt_ip).like(pattern),
                func.lower(func.coalesce(IpMplsDevice.model, "")).like(pattern),
                func.lower(func.coalesce(IpMplsDevice.serial, "")).like(pattern),
                func.lower(func.coalesce(IpMplsDevice.role, "")).like(pattern),
                func.lower(func.coalesce(IpMplsDevice.site_name, "")).like(pattern),
                func.lower(func.coalesce(IpMplsDevice.rack_location, "")).like(pattern),
            )
        )

    stmt = select(IpMplsDevice).order_by(IpMplsDevice.name)
    count_stmt = select(func.count()).select_from(IpMplsDevice)
    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = (await db.execute(count_stmt)).scalar_one()
    if total == 0:
        page = 1
    else:
        last_page = max(1, (total + page_size - 1) // page_size)
        page = min(page, last_page)

    offset = (page - 1) * page_size
    result = await db.execute(stmt.offset(offset).limit(page_size))
    items = [IpMplsDeviceRead.model_validate(d, from_attributes=True) for d in result.scalars()]

    return IpMplsDevicePage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=offset + len(items) < total,
        has_prev=page > 1,
    )


@router.post("/devices", response_model=IpMplsDeviceRead, status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: IpMplsDeviceCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> IpMplsDeviceRead:
    existing = (
        await db.execute(select(IpMplsDevice).where(IpMplsDevice.mgmt_ip == payload.mgmt_ip))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A device with this management IP already exists")

    device = IpMplsDevice(
        name=payload.name,
        mgmt_ip=payload.mgmt_ip,
        port=payload.port,
        platform=payload.platform,
        role=payload.role,
        description=payload.description,
        poll_interval_seconds=payload.poll_interval_seconds,
        connection_params=payload.connection_params or {},
        username=payload.username,
        password_secret=encrypt_secret(payload.password),
        enable_secret=encrypt_secret(payload.enable) if payload.enable else None,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return IpMplsDeviceRead.model_validate(device, from_attributes=True)


@router.get("/devices/{device_id}", response_model=IpMplsDeviceRead)
async def get_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> IpMplsDeviceRead:
    device = await _get_device(db, device_id)
    return IpMplsDeviceRead.model_validate(device, from_attributes=True)


@router.patch("/devices/{device_id}", response_model=IpMplsDeviceRead)
async def update_device(
    device_id: str,
    payload: IpMplsDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> IpMplsDeviceRead:
    device = await _get_device(db, device_id)
    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        password = data.pop("password")
        if password:
            device.password_secret = encrypt_secret(password)
    if "enable" in data:
        enable = data.pop("enable")
        device.enable_secret = encrypt_secret(enable) if enable else None
    for key, value in data.items():
        setattr(device, key, value)
    await db.commit()
    await db.refresh(device)
    return IpMplsDeviceRead.model_validate(device, from_attributes=True)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> None:
    device = await _get_device(db, device_id)
    await db.delete(device)
    await db.commit()


@router.post("/devices/{device_id}/sync", response_model=IpMplsSyncResult)
async def sync_device_now(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> IpMplsSyncResult:
    device = await _get_device(db, device_id)
    result = await run_collection_for_device(db, device)
    await db.commit()
    await db.refresh(device)
    snap = result.snapshot or {}
    return IpMplsSyncResult(
        success=result.success,
        message=result.message,
        interfaces=snap.get("interfaces", 0),
        modules=snap.get("modules", 0),
        vrfs=snap.get("vrfs", 0),
        neighbors=snap.get("neighbors", 0),
        device=IpMplsDeviceRead.model_validate(device, from_attributes=True),
    )


@router.get("/devices/{device_id}/interfaces", response_model=List[IpMplsInterfaceRead])
async def list_device_interfaces(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[IpMplsInterfaceRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(IpMplsInterface).where(IpMplsInterface.device_id == device.id).order_by(IpMplsInterface.name)
    )
    return [IpMplsInterfaceRead.model_validate(i, from_attributes=True) for i in result.scalars()]


@router.get("/devices/{device_id}/modules", response_model=List[IpMplsModuleRead])
async def list_device_modules(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[IpMplsModuleRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(IpMplsModule).where(IpMplsModule.device_id == device.id).order_by(IpMplsModule.name)
    )
    return [IpMplsModuleRead.model_validate(m, from_attributes=True) for m in result.scalars()]


@router.get("/devices/{device_id}/vrfs", response_model=List[IpMplsVrfRead])
async def list_device_vrfs(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[IpMplsVrfRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(IpMplsVrf).where(IpMplsVrf.device_id == device.id).order_by(IpMplsVrf.name)
    )
    return [IpMplsVrfRead.model_validate(v, from_attributes=True) for v in result.scalars()]


@router.get("/devices/{device_id}/neighbors", response_model=List[IpMplsNeighborRead])
async def list_device_neighbors(
    device_id: str,
    protocol: Optional[str] = Query(default=None, description="Filter by protocol (isis/ldp/bgp/ospf)"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[IpMplsNeighborRead]:
    device = await _get_device(db, device_id)
    stmt = select(IpMplsNeighbor).where(IpMplsNeighbor.device_id == device.id)
    if protocol:
        stmt = stmt.where(IpMplsNeighbor.protocol == protocol.lower())
    stmt = stmt.order_by(IpMplsNeighbor.protocol, IpMplsNeighbor.neighbor_id)
    result = await db.execute(stmt)
    return [IpMplsNeighborRead.model_validate(n, from_attributes=True) for n in result.scalars()]


@router.get("/topology", response_model=IpMplsTopology)
async def get_topology(
    protocol: str = Query(default="isis", description="Adjacency protocol to build the graph from (isis/ldp)"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> IpMplsTopology:
    """Cross-device link-state topology built from collected adjacencies.

    Every neighbor of the chosen protocol becomes a link; the neighbor is matched
    to a registered device by hostname (else shown as an external node).
    """
    protocol = protocol.lower()
    devices = (await db.execute(select(IpMplsDevice))).scalars().all()

    by_id = {device.id: device for device in devices}
    by_name: dict[str, IpMplsDevice] = {}
    for device in devices:
        for key in (device.hostname, device.name):
            if key:
                by_name[key.lower()] = device

    nodes: dict[str, IpMplsTopologyNode] = {}

    def platform_value(device: IpMplsDevice) -> str:
        return device.platform.value if hasattr(device.platform, "value") else str(device.platform)

    def device_node(device: IpMplsDevice) -> str:
        node_id = str(device.id)
        if node_id not in nodes:
            nodes[node_id] = IpMplsTopologyNode(
                id=node_id,
                name=device.hostname or device.name,
                kind="device",
                role=device.role,
                platform=platform_value(device),
                site=device.site_name,
                device_id=device.id,
            )
        return node_id

    def external_node(system_id: str) -> str:
        node_id = f"ext:{system_id}"
        if node_id not in nodes:
            nodes[node_id] = IpMplsTopologyNode(id=node_id, name=system_id, kind="external")
        return node_id

    # Include every registered device so isolated nodes still appear.
    for device in devices:
        device_node(device)

    neighbors = (
        await db.execute(select(IpMplsNeighbor).where(IpMplsNeighbor.protocol == protocol))
    ).scalars().all()

    links: dict[tuple, IpMplsTopologyLink] = {}
    for nb in neighbors:
        owner = by_id.get(nb.device_id)
        if owner is None:
            continue
        source = device_node(owner)
        target_device = by_name.get((nb.neighbor_id or "").lower())
        target = device_node(target_device) if target_device else external_node(nb.neighbor_id or "unknown")
        if source == target:
            continue
        a, b = sorted((source, target))
        key = (a, b, protocol)
        link = links.get(key)
        if link is None:
            link = IpMplsTopologyLink(source=a, target=b, protocol=protocol, interfaces=[], count=0)
            links[key] = link
        if nb.interface and nb.interface not in link.interfaces:
            link.interfaces.append(nb.interface)
        link.count += 1

    return IpMplsTopology(
        nodes=list(nodes.values()),
        links=list(links.values()),
        total_nodes=len(nodes),
        total_links=len(links),
        protocol=protocol,
    )


@router.get("/summary", response_model=IpMplsSummary)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> IpMplsSummary:
    devices = (await db.execute(select(IpMplsDevice))).scalars().all()
    total_interfaces = (await db.execute(select(func.count()).select_from(IpMplsInterface))).scalar_one()

    def value(item) -> str:
        return item.value if hasattr(item, "value") else str(item)

    return IpMplsSummary(
        total=len(devices),
        total_interfaces=total_interfaces,
        by_platform=dict(Counter(value(d.platform) for d in devices)),
        by_status=dict(Counter(value(d.status) for d in devices)),
        by_role=dict(Counter((d.role or "unknown") for d in devices)),
    )
