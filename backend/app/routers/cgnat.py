from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models import CgnatDevice, CgnatInterface, CgnatNatPool
from app.schemas import (
    CgnatConnectivityResult,
    CgnatDeviceCreate,
    CgnatDevicePage,
    CgnatDeviceRead,
    CgnatDeviceUpdate,
    CgnatInterfaceRead,
    CgnatNatPoolRead,
    CgnatSummary,
    CgnatSyncResult,
)
from app.services.crypto import encrypt_secret
from app.services.cgnat_collector import run_collection_for_device, test_connection_for_device

router = APIRouter(prefix="/cgnat", tags=["cgnat"])


async def _get_device(db: AsyncSession, device_id: str) -> CgnatDevice:
    device = await db.get(CgnatDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="CGNAT device not found")
    return device


@router.get("/devices", response_model=CgnatDevicePage)
async def list_devices(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    search: Optional[str] = Query(default=None, description="Search name/hostname/IP/model/serial/role/site/vendor/status"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> CgnatDevicePage:
    conditions = []
    if search:
        pattern = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(CgnatDevice.name).like(pattern),
                func.lower(func.coalesce(CgnatDevice.hostname, "")).like(pattern),
                func.lower(CgnatDevice.mgmt_ip).like(pattern),
                func.lower(func.coalesce(CgnatDevice.model, "")).like(pattern),
                func.lower(func.coalesce(CgnatDevice.serial, "")).like(pattern),
                func.lower(func.coalesce(CgnatDevice.role, "")).like(pattern),
                func.lower(func.coalesce(CgnatDevice.site_name, "")).like(pattern),
                func.lower(func.cast(CgnatDevice.vendor, String)).like(pattern),
                func.lower(func.cast(CgnatDevice.status, String)).like(pattern),
                func.lower(func.coalesce(CgnatDevice.os_version, "")).like(pattern),
            )
        )

    stmt = select(CgnatDevice).order_by(CgnatDevice.name)
    count_stmt = select(func.count()).select_from(CgnatDevice)
    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = (await db.execute(count_stmt)).scalar_one()
    if total == 0:
        page = 1
    else:
        page = min(page, max(1, (total + page_size - 1) // page_size))

    offset = (page - 1) * page_size
    result = await db.execute(stmt.offset(offset).limit(page_size))
    items = [CgnatDeviceRead.model_validate(d, from_attributes=True) for d in result.scalars()]
    return CgnatDevicePage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=offset + len(items) < total,
        has_prev=page > 1,
    )


@router.post("/devices", response_model=CgnatDeviceRead, status_code=status.HTTP_201_CREATED)
async def create_device(
    payload: CgnatDeviceCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> CgnatDeviceRead:
    existing = (
        await db.execute(select(CgnatDevice).where(CgnatDevice.mgmt_ip == payload.mgmt_ip))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A device with this management IP already exists")

    device = CgnatDevice(
        name=payload.name,
        mgmt_ip=payload.mgmt_ip,
        port=payload.port,
        vendor=payload.vendor,
        verify_ssl=payload.verify_ssl,
        role=payload.role,
        description=payload.description,
        poll_interval_seconds=payload.poll_interval_seconds,
        connection_params=payload.connection_params or {},
        username=payload.username,
        password_secret=encrypt_secret(payload.password),
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return CgnatDeviceRead.model_validate(device, from_attributes=True)


@router.get("/devices/{device_id}", response_model=CgnatDeviceRead)
async def get_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> CgnatDeviceRead:
    device = await _get_device(db, device_id)
    return CgnatDeviceRead.model_validate(device, from_attributes=True)


@router.patch("/devices/{device_id}", response_model=CgnatDeviceRead)
async def update_device(
    device_id: str,
    payload: CgnatDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> CgnatDeviceRead:
    device = await _get_device(db, device_id)
    data = payload.model_dump(exclude_unset=True)
    new_ip = data.get("mgmt_ip")
    if new_ip and new_ip != device.mgmt_ip:
        clash = (
            await db.execute(select(CgnatDevice).where(CgnatDevice.mgmt_ip == new_ip, CgnatDevice.id != device.id))
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="A device with this management IP already exists")
    if "password" in data:
        password = data.pop("password")
        if password:
            device.password_secret = encrypt_secret(password)
    for key, value in data.items():
        setattr(device, key, value)
    await db.commit()
    await db.refresh(device)
    return CgnatDeviceRead.model_validate(device, from_attributes=True)


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> None:
    device = await _get_device(db, device_id)
    await db.delete(device)
    await db.commit()


@router.post("/devices/{device_id}/sync", response_model=CgnatSyncResult)
async def sync_device_now(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> CgnatSyncResult:
    device = await _get_device(db, device_id)
    result = await run_collection_for_device(db, device)
    await db.commit()
    await db.refresh(device)
    snap = result.snapshot or {}
    return CgnatSyncResult(
        success=result.success,
        message=result.message,
        interfaces=snap.get("interfaces", 0),
        pools=snap.get("pools", 0),
        device=CgnatDeviceRead.model_validate(device, from_attributes=True),
    )


@router.post("/devices/{device_id}/test", response_model=CgnatConnectivityResult)
async def test_device(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> CgnatConnectivityResult:
    device = await _get_device(db, device_id)
    res = await test_connection_for_device(device)
    return CgnatConnectivityResult(
        reachable=res.reachable, message=res.message, hostname=res.hostname, checked_at=res.checked_at
    )


@router.get("/devices/{device_id}/interfaces", response_model=List[CgnatInterfaceRead])
async def list_device_interfaces(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[CgnatInterfaceRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(CgnatInterface).where(CgnatInterface.device_id == device.id).order_by(CgnatInterface.name)
    )
    return [CgnatInterfaceRead.model_validate(i, from_attributes=True) for i in result.scalars()]


@router.get("/devices/{device_id}/pools", response_model=List[CgnatNatPoolRead])
async def list_device_pools(
    device_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[CgnatNatPoolRead]:
    device = await _get_device(db, device_id)
    result = await db.execute(
        select(CgnatNatPool).where(CgnatNatPool.device_id == device.id).order_by(CgnatNatPool.pool_name)
    )
    return [CgnatNatPoolRead.model_validate(p, from_attributes=True) for p in result.scalars()]


@router.get("/summary", response_model=CgnatSummary)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> CgnatSummary:
    devices = (await db.execute(select(CgnatDevice))).scalars().all()
    total_pools = (await db.execute(select(func.count()).select_from(CgnatNatPool))).scalar_one()

    def value(item) -> str:
        return item.value if hasattr(item, "value") else str(item)

    def location_code(device: CgnatDevice) -> str:
        source = (device.hostname or device.name or "").strip()
        return source[:4].upper() if len(source) >= 4 else (source.upper() or "unknown")

    now = datetime.now(timezone.utc)

    def is_stale(device: CgnatDevice) -> bool:
        if device.last_polled_at is None:
            return True
        last = device.last_polled_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        return (now - last).total_seconds() > (device.poll_interval_seconds or 900) * 2

    # public IPs: count NAT pool address ranges roughly (start != none)
    pools = (await db.execute(select(CgnatNatPool))).scalars().all()
    total_public_ips = sum(1 for p in pools if p.start_address)

    return CgnatSummary(
        total=len(devices),
        total_pools=total_pools,
        total_public_ips=total_public_ips,
        active_sessions=sum(d.active_sessions or 0 for d in devices),
        total_translations=sum(d.total_translations or 0 for d in devices),
        exhaustion_events=sum(d.exhaustion_events or 0 for d in devices),
        error_devices=sum(1 for d in devices if value(d.status) == "error"),
        stale_devices=sum(1 for d in devices if is_stale(d)),
        by_vendor=dict(Counter(value(d.vendor) for d in devices)),
        by_status=dict(Counter(value(d.status) for d in devices)),
        by_role=dict(Counter((d.role or "unknown") for d in devices)),
        by_location=dict(Counter(location_code(d) for d in devices)),
    )
