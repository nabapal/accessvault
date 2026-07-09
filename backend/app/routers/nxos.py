from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models import (
    NxosBgpNeighbor,
    NxosDevice,
    NxosInterface,
    NxosModule,
    NxosNeighbor,
    NxosPlatform,
    NxosVrf,
)
from app.schemas import (
    NxosBgpNeighborRead,
    NxosDeviceCreate,
    NxosDevicePage,
    NxosDeviceRead,
    NxosDeviceUpdate,
    NxosInterfaceRead,
    NxosModuleRead,
    NxosNeighborRead,
    NxosSummary,
    NxosSyncResult,
    NxosTopology,
    NxosTopologyLink,
    NxosTopologyNode,
    NxosVrfRead,
)
from app.services.crypto import encrypt_secret
from app.services.nxos_collector import run_collection_for_device

router = APIRouter(prefix="/nxos", tags=["nxos"])


async def _get_device(db: AsyncSession, device_id: str) -> NxosDevice:
    device = await db.get(NxosDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="NX-OS device not found")
    return device


@router.get("/devices", response_model=NxosDevicePage)
async def list_devices(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    search: Optional[str] = Query(
        default=None,
        description="Search name/hostname/mgmt IP/model/serial/role/site/rack/platform/status/OS",
    ),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> NxosDevicePage:
    conditions = []
    if search:
        pattern = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(NxosDevice.name).like(pattern),
                func.lower(func.coalesce(NxosDevice.hostname, "")).like(pattern),
                func.lower(NxosDevice.mgmt_ip).like(pattern),
                func.lower(func.coalesce(NxosDevice.model, "")).like(pattern),
                func.lower(func.coalesce(NxosDevice.serial, "")).like(pattern),
                func.lower(func.coalesce(NxosDevice.role, "")).like(pattern),
                func.lower(func.coalesce(NxosDevice.site_name, "")).like(pattern),
                func.lower(func.coalesce(NxosDevice.rack_location, "")).like(pattern),
                func.lower(func.cast(NxosDevice.platform, String)).like(pattern),
                func.lower(func.cast(NxosDevice.status, String)).like(pattern),
                func.lower(func.coalesce(NxosDevice.os_version, "")).like(pattern),
            )
        )

    stmt = select(NxosDevice).order_by(NxosDevice.name)
    count_stmt = select(func.count()).select_from(NxosDevice)
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
    items = [NxosDeviceRead.model_validate(d, from_attributes=True) for d in result.scalars()]

    return NxosDevicePage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=offset + len(items) < total,
        has_prev=page > 1,
    )


@router.post("/devices", response_model=NxosDeviceRead, status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: NxosDeviceCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> NxosDeviceRead:
    existing = (
        await db.execute(select(NxosDevice).where(NxosDevice.mgmt_ip == payload.mgmt_ip))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A device with this management IP already exists")

    device = NxosDevice(
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
    return NxosDeviceRead.model_validate(device, from_attributes=True)


@router.get("/devices/{device_id}", response_model=NxosDeviceRead)
async def get_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> NxosDeviceRead:
    device = await _get_device(db, device_id)
    return NxosDeviceRead.model_validate(device, from_attributes=True)


@router.patch("/devices/{device_id}", response_model=NxosDeviceRead)
async def update_device(
    device_id: str,
    payload: NxosDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> NxosDeviceRead:
    device = await _get_device(db, device_id)
    data = payload.model_dump(exclude_unset=True)
    new_mgmt_ip = data.get("mgmt_ip")
    if new_mgmt_ip and new_mgmt_ip != device.mgmt_ip:
        clash = (
            await db.execute(
                select(NxosDevice).where(
                    NxosDevice.mgmt_ip == new_mgmt_ip,
                    NxosDevice.id != device.id,
                )
            )
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="A device with this management IP already exists")
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
    return NxosDeviceRead.model_validate(device, from_attributes=True)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> None:
    device = await _get_device(db, device_id)
    await db.delete(device)
    await db.commit()


@router.post("/devices/{device_id}/sync", response_model=NxosSyncResult)
async def sync_device_now(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> NxosSyncResult:
    device = await _get_device(db, device_id)
    result = await run_collection_for_device(db, device)
    await db.commit()
    await db.refresh(device)
    snap = result.snapshot or {}
    return NxosSyncResult(
        success=result.success,
        message=result.message,
        interfaces=snap.get("interfaces", 0),
        modules=snap.get("modules", 0),
        vrfs=snap.get("vrfs", 0),
        neighbors=snap.get("neighbors", 0),
        bgp_neighbors=snap.get("bgp", 0),
        device=NxosDeviceRead.model_validate(device, from_attributes=True),
    )


@router.get("/devices/{device_id}/interfaces", response_model=List[NxosInterfaceRead])
async def list_device_interfaces(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[NxosInterfaceRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(NxosInterface).where(NxosInterface.device_id == device.id).order_by(NxosInterface.name)
    )
    return [NxosInterfaceRead.model_validate(i, from_attributes=True) for i in result.scalars()]


@router.get("/devices/{device_id}/modules", response_model=List[NxosModuleRead])
async def list_device_modules(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[NxosModuleRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(select(NxosModule).where(NxosModule.device_id == device.id))
    return [NxosModuleRead.model_validate(m, from_attributes=True) for m in result.scalars()]


@router.get("/devices/{device_id}/vrfs", response_model=List[NxosVrfRead])
async def list_device_vrfs(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[NxosVrfRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(NxosVrf).where(NxosVrf.device_id == device.id).order_by(NxosVrf.name)
    )
    return [NxosVrfRead.model_validate(v, from_attributes=True) for v in result.scalars()]


@router.get("/devices/{device_id}/neighbors", response_model=List[NxosNeighborRead])
async def list_device_neighbors(
    device_id: str,
    protocol: Optional[str] = Query(default=None, description="Filter by protocol: cdp | lldp"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[NxosNeighborRead]:
    device = await _get_device(db, device_id)
    stmt = select(NxosNeighbor).where(NxosNeighbor.device_id == device.id)
    if protocol:
        stmt = stmt.where(NxosNeighbor.protocol == protocol.lower())
    stmt = stmt.order_by(NxosNeighbor.local_interface)
    result = await db.execute(stmt)
    return [NxosNeighborRead.model_validate(n, from_attributes=True) for n in result.scalars()]


@router.get("/devices/{device_id}/bgp", response_model=List[NxosBgpNeighborRead])
async def list_device_bgp(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[NxosBgpNeighborRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(NxosBgpNeighbor)
        .where(NxosBgpNeighbor.device_id == device.id)
        .order_by(NxosBgpNeighbor.vrf, NxosBgpNeighbor.neighbor_ip)
    )
    return [NxosBgpNeighborRead.model_validate(b, from_attributes=True) for b in result.scalars()]


@router.get("/topology", response_model=NxosTopology)
async def get_topology(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> NxosTopology:
    """L2 topology built from CDP + LLDP adjacencies (merged, de-duplicated per device pair)."""
    devices = (await db.execute(select(NxosDevice))).scalars().all()
    by_id = {device.id: device for device in devices}
    by_name: dict[str, NxosDevice] = {}
    by_mgmt: dict[str, NxosDevice] = {}
    for device in devices:
        for key in (device.hostname, device.name):
            if key:
                by_name[key.lower()] = device
        if device.mgmt_ip:
            by_mgmt[device.mgmt_ip] = device

    nodes: dict[str, NxosTopologyNode] = {}

    def platform_value(device: NxosDevice) -> str:
        return device.platform.value if hasattr(device.platform, "value") else str(device.platform)

    def device_node(device: NxosDevice) -> str:
        node_id = str(device.id)
        if node_id not in nodes:
            nodes[node_id] = NxosTopologyNode(
                id=node_id,
                name=device.hostname or device.name,
                kind="device",
                role=device.role,
                platform=platform_value(device),
                site=device.site_name,
                device_id=device.id,
            )
        return node_id

    def external_node(label: str) -> str:
        node_id = f"ext:{label}"
        if node_id not in nodes:
            nodes[node_id] = NxosTopologyNode(id=node_id, name=label, kind="external")
        return node_id

    for device in devices:
        device_node(device)

    neighbors = (
        await db.execute(
            select(NxosNeighbor).where(NxosNeighbor.protocol.in_(["cdp", "lldp"]))
        )
    ).scalars().all()

    links: dict[tuple, NxosTopologyLink] = {}
    for nb in neighbors:
        owner = by_id.get(nb.device_id)
        if owner is None:
            continue
        source = device_node(owner)
        target_device = None
        if nb.remote_device:
            target_device = by_name.get(nb.remote_device.lower())
        if target_device is None and nb.remote_mgmt_ip:
            target_device = by_mgmt.get(nb.remote_mgmt_ip)
        target = device_node(target_device) if target_device else external_node(nb.remote_device or nb.remote_mgmt_ip or "unknown")
        if source == target:
            continue
        a, b = sorted((source, target))
        key = (a, b)
        link = links.get(key)
        if link is None:
            link = NxosTopologyLink(source=a, target=b, interfaces=[], count=0, discovered_by=[], endpoint_interfaces={})
            links[key] = link
        if nb.protocol not in link.discovered_by:
            link.discovered_by.append(nb.protocol)
        if nb.local_interface:
            if nb.local_interface not in link.interfaces:
                link.interfaces.append(nb.local_interface)
            owner_ifaces = link.endpoint_interfaces.setdefault(source, [])
            if nb.local_interface not in owner_ifaces:
                owner_ifaces.append(nb.local_interface)
        link.count += 1

    # Prefer LLDP ordering in the discovered_by list for display.
    for link in links.values():
        link.discovered_by.sort(key=lambda p: 0 if p == "lldp" else 1)

    return NxosTopology(
        nodes=list(nodes.values()),
        links=list(links.values()),
        total_nodes=len(nodes),
        total_links=len(links),
    )


@router.get("/summary", response_model=NxosSummary)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> NxosSummary:
    devices = (await db.execute(select(NxosDevice))).scalars().all()

    total_interfaces = (await db.execute(select(func.count()).select_from(NxosInterface))).scalar_one()
    interfaces_up = (
        await db.execute(
            select(func.count()).select_from(NxosInterface).where(func.lower(NxosInterface.oper_state) == "up")
        )
    ).scalar_one()
    total_vrfs = (await db.execute(select(func.count()).select_from(NxosVrf))).scalar_one()
    unique_vrfs = (await db.execute(select(func.count(func.distinct(NxosVrf.name))))).scalar_one()
    total_neighbors = (await db.execute(select(func.count()).select_from(NxosNeighbor))).scalar_one()
    total_bgp = (await db.execute(select(func.count()).select_from(NxosBgpNeighbor))).scalar_one()
    protocol_rows = (
        await db.execute(select(NxosNeighbor.protocol, func.count()).group_by(NxosNeighbor.protocol))
    ).all()

    def value(item) -> str:
        return item.value if hasattr(item, "value") else str(item)

    def location_code(device: NxosDevice) -> str:
        source = (device.hostname or device.name or "").strip()
        return source[:4].upper() if len(source) >= 4 else (source.upper() or "unknown")

    now = datetime.now(timezone.utc)

    def is_stale(device: NxosDevice) -> bool:
        if device.last_polled_at is None:
            return True
        last = device.last_polled_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        interval = device.poll_interval_seconds or 900
        return (now - last).total_seconds() > interval * 2

    return NxosSummary(
        total=len(devices),
        total_interfaces=total_interfaces,
        interfaces_up=interfaces_up,
        total_vrfs=total_vrfs,
        unique_vrfs=unique_vrfs,
        total_neighbors=total_neighbors,
        total_bgp_neighbors=total_bgp,
        error_devices=sum(1 for d in devices if value(d.status) == "error"),
        stale_devices=sum(1 for d in devices if is_stale(d)),
        by_platform=dict(Counter(value(d.platform) for d in devices)),
        by_status=dict(Counter(value(d.status) for d in devices)),
        by_role=dict(Counter((d.role or "unknown") for d in devices)),
        by_location=dict(Counter(location_code(d) for d in devices)),
        by_model=dict(Counter((d.model or "unknown") for d in devices)),
        by_os=dict(Counter((d.os_version or "unknown") for d in devices)),
        by_neighbor_protocol={value(p): c for p, c in protocol_rows},
    )
