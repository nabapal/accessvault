from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import String, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db, require_admin
from app.models import CPNR_OBJECT_TYPES, CpnrChangeEvent, CpnrObject, CpnrRole, CpnrVm
from app.schemas import (
    CpnrChangeEventRead,
    CpnrConnectivityResult,
    CpnrObjectRead,
    CpnrPairComparison,
    CpnrPairSummary,
    CpnrSummary,
    CpnrSyncResult,
    CpnrVmCreate,
    CpnrVmPage,
    CpnrVmRead,
    CpnrVmUpdate,
)
from app.services.cpnr_collector import (
    _compare_maps,
    _load_objects,
    run_collection_for_vm,
    test_connection_for_vm,
)
from app.services.crypto import encrypt_secret

router = APIRouter(prefix="/cpnr", tags=["cpnr"])


async def _get_vm(db: AsyncSession, vm_id: str) -> CpnrVm:
    vm = await db.get(CpnrVm, vm_id)
    if vm is None:
        raise HTTPException(status_code=404, detail="CPNR VM not found")
    return vm


@router.get("/vms", response_model=CpnrVmPage)
async def list_vms(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> CpnrVmPage:
    conditions = []
    if search:
        p = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(CpnrVm.name).like(p),
                func.lower(CpnrVm.mgmt_ip).like(p),
                func.lower(func.coalesce(CpnrVm.site, "")).like(p),
                func.lower(func.coalesce(CpnrVm.service, "")).like(p),
                func.lower(func.cast(CpnrVm.role, String)).like(p),
                func.lower(func.cast(CpnrVm.status, String)).like(p),
                func.lower(func.cast(CpnrVm.pair_status, String)).like(p),
            )
        )
    stmt = select(CpnrVm).order_by(CpnrVm.site, CpnrVm.service, CpnrVm.role)
    count_stmt = select(func.count()).select_from(CpnrVm)
    for c in conditions:
        stmt = stmt.where(c)
        count_stmt = count_stmt.where(c)
    total = (await db.execute(count_stmt)).scalar_one()
    page = 1 if total == 0 else min(page, max(1, (total + page_size - 1) // page_size))
    offset = (page - 1) * page_size
    rows = (await db.execute(stmt.offset(offset).limit(page_size))).scalars().all()
    items = [CpnrVmRead.model_validate(v, from_attributes=True) for v in rows]
    return CpnrVmPage(
        items=items, total=total, page=page, page_size=page_size,
        has_next=offset + len(items) < total, has_prev=page > 1,
    )


@router.post("/vms", response_model=CpnrVmRead, status_code=status.HTTP_201_CREATED)
async def create_vm(
    payload: CpnrVmCreate,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(require_admin),
) -> CpnrVmRead:
    existing = (await db.execute(select(CpnrVm).where(CpnrVm.mgmt_ip == payload.mgmt_ip))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A CPNR VM with this management IP already exists")
    vm = CpnrVm(
        name=payload.name, site=payload.site, service=payload.service, role=payload.role,
        pair_id=payload.pair_id, mgmt_ip=payload.mgmt_ip, port=payload.port,
        verify_ssl=1 if payload.verify_ssl else 0, description=payload.description,
        poll_interval_seconds=payload.poll_interval_seconds, username=payload.username,
        password_secret=encrypt_secret(payload.password),
    )
    db.add(vm)
    await db.commit()
    await db.refresh(vm)
    return CpnrVmRead.model_validate(vm, from_attributes=True)


@router.get("/vms/{vm_id}", response_model=CpnrVmRead)
async def get_vm(vm_id: str, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)) -> CpnrVmRead:
    return CpnrVmRead.model_validate(await _get_vm(db, vm_id), from_attributes=True)


@router.patch("/vms/{vm_id}", response_model=CpnrVmRead)
async def update_vm(
    vm_id: str, payload: CpnrVmUpdate,
    db: AsyncSession = Depends(get_db), _: object = Depends(require_admin),
) -> CpnrVmRead:
    vm = await _get_vm(db, vm_id)
    data = payload.model_dump(exclude_unset=True)
    new_ip = data.get("mgmt_ip")
    if new_ip and new_ip != vm.mgmt_ip:
        clash = (await db.execute(select(CpnrVm).where(CpnrVm.mgmt_ip == new_ip, CpnrVm.id != vm.id))).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="A CPNR VM with this management IP already exists")
    if "password" in data:
        pw = data.pop("password")
        if pw:
            vm.password_secret = encrypt_secret(pw)
    if "verify_ssl" in data:
        vm.verify_ssl = 1 if data.pop("verify_ssl") else 0
    for k, v in data.items():
        setattr(vm, k, v)
    await db.commit()
    await db.refresh(vm)
    return CpnrVmRead.model_validate(vm, from_attributes=True)


@router.delete("/vms/{vm_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vm(vm_id: str, db: AsyncSession = Depends(get_db), _: object = Depends(require_admin)) -> None:
    vm = await _get_vm(db, vm_id)
    await db.delete(vm)
    await db.commit()


@router.post("/vms/{vm_id}/sync", response_model=CpnrSyncResult)
async def sync_vm(vm_id: str, db: AsyncSession = Depends(get_db), _: object = Depends(require_admin)) -> CpnrSyncResult:
    vm = await _get_vm(db, vm_id)
    result = await run_collection_for_vm(db, vm)
    await db.commit()
    await db.refresh(vm)
    return CpnrSyncResult(
        success=result.success, message=result.message, counts=result.counts,
        vm=CpnrVmRead.model_validate(vm, from_attributes=True),
    )


@router.post("/vms/{vm_id}/test", response_model=CpnrConnectivityResult)
async def test_vm(vm_id: str, db: AsyncSession = Depends(get_db), _: object = Depends(require_admin)) -> CpnrConnectivityResult:
    vm = await _get_vm(db, vm_id)
    res = await test_connection_for_vm(vm)
    return CpnrConnectivityResult(reachable=res.reachable, checked_at=res.checked_at, version=res.version, message=res.message)


@router.get("/vms/{vm_id}/objects/{object_type}", response_model=List[CpnrObjectRead])
async def list_objects(
    vm_id: str, object_type: str,
    db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user),
) -> list[CpnrObjectRead]:
    if object_type not in CPNR_OBJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown object type: {object_type}")
    vm = await _get_vm(db, vm_id)
    rows = (await db.execute(
        select(CpnrObject).where(CpnrObject.vm_id == vm.id, CpnrObject.object_type == object_type)
        .order_by(CpnrObject.object_key)
    )).scalars().all()
    return [CpnrObjectRead.model_validate(o, from_attributes=True) for o in rows]


@router.get("/vms/{vm_id}/changes", response_model=List[CpnrChangeEventRead])
async def list_changes(
    vm_id: str, limit: int = Query(default=200, ge=1, le=2000),
    db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user),
) -> list[CpnrChangeEventRead]:
    vm = await _get_vm(db, vm_id)
    rows = (await db.execute(
        select(CpnrChangeEvent).where(CpnrChangeEvent.vm_id == vm.id)
        .order_by(CpnrChangeEvent.ts.desc()).limit(limit)
    )).scalars().all()
    return [CpnrChangeEventRead.model_validate(c, from_attributes=True) for c in rows]


@router.get("/vms/{vm_id}/changes/export", response_class=PlainTextResponse)
async def export_changes(vm_id: str, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)) -> PlainTextResponse:
    vm = await _get_vm(db, vm_id)
    rows = (await db.execute(
        select(CpnrChangeEvent).where(CpnrChangeEvent.vm_id == vm.id).order_by(CpnrChangeEvent.ts)
    )).scalars().all()
    lines = [f"# CPNR change log for {vm.name} ({vm.mgmt_ip})"]
    for c in rows:
        ts = c.ts.isoformat() if c.ts else ""
        detail = ""
        if c.action == "modified" and c.changes:
            detail = " " + "; ".join(f"{ch.get('field')}: {ch.get('old')} -> {ch.get('new')}" for ch in c.changes)
        lines.append(f"{ts}\t{c.action.upper()}\t{c.object_type}\t{c.object_key}{detail}")
    safe = (vm.name or vm.mgmt_ip).replace(" ", "_").replace("/", "_")
    return PlainTextResponse(
        "\n".join(lines) + "\n",
        headers={"Content-Disposition": f'attachment; filename="cpnr_{safe}_changes.log"'},
    )


@router.get("/pairs", response_model=List[CpnrPairSummary])
async def list_pairs(db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)) -> list[CpnrPairSummary]:
    vms = (await db.execute(select(CpnrVm).where(CpnrVm.pair_id.isnot(None)))).scalars().all()
    groups: Dict[str, list[CpnrVm]] = defaultdict(list)
    for v in vms:
        groups[v.pair_id].append(v)
    out: list[CpnrPairSummary] = []
    for pair_id, members in sorted(groups.items()):
        primary = next((m for m in members if m.role == CpnrRole.PRIMARY), None)
        secondary = next((m for m in members if m.role == CpnrRole.SECONDARY), None)
        ref = primary or members[0]
        out.append(CpnrPairSummary(
            pair_id=pair_id, service=ref.service, site=ref.site,
            primary=CpnrVmRead.model_validate(primary, from_attributes=True) if primary else None,
            secondary=CpnrVmRead.model_validate(secondary, from_attributes=True) if secondary else None,
            pair_status=ref.pair_status, inconsistency_count=ref.inconsistency_count,
            last_compared_at=ref.last_compared_at,
        ))
    return out


@router.get("/pairs/{pair_id}/comparison", response_model=CpnrPairComparison)
async def pair_comparison(pair_id: str, db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)) -> CpnrPairComparison:
    members = (await db.execute(select(CpnrVm).where(CpnrVm.pair_id == pair_id))).scalars().all()
    primary = next((m for m in members if m.role == CpnrRole.PRIMARY), None)
    secondary = next((m for m in members if m.role == CpnrRole.SECONDARY), None)
    if primary is None or secondary is None:
        raise HTTPException(status_code=404, detail="Pair requires both a primary and a secondary VM")
    report = _compare_maps(await _load_objects(db, primary.id), await _load_objects(db, secondary.id))
    return CpnrPairComparison(
        pair_id=pair_id, in_sync=report["in_sync"], inconsistency_count=report["inconsistency_count"],
        primary={"id": str(primary.id), "name": primary.name, "mgmt_ip": primary.mgmt_ip},
        secondary={"id": str(secondary.id), "name": secondary.name, "mgmt_ip": secondary.mgmt_ip},
        by_type=report["by_type"],
    )


@router.get("/summary", response_model=CpnrSummary)
async def get_summary(db: AsyncSession = Depends(get_db), _: object = Depends(get_current_user)) -> CpnrSummary:
    vms = (await db.execute(select(CpnrVm))).scalars().all()

    def val(x) -> str:
        return x.value if hasattr(x, "value") else str(x)

    pairs: Dict[str, list[CpnrVm]] = defaultdict(list)
    for v in vms:
        if v.pair_id:
            pairs[v.pair_id].append(v)
    pairs_in_sync = sum(1 for m in pairs.values() if val(m[0].pair_status) == "in_sync")
    pairs_drift = sum(1 for m in pairs.values() if val(m[0].pair_status) == "drift")

    return CpnrSummary(
        total_vms=len(vms),
        total_pairs=len(pairs),
        pairs_in_sync=pairs_in_sync,
        pairs_drift=pairs_drift,
        error_vms=sum(1 for v in vms if val(v.status) == "error"),
        total_scopes=sum(v.scope_count or 0 for v in vms),
        total_prefixes=sum(v.prefix_count or 0 for v in vms),
        total_reservations=sum((v.reservation4_count or 0) + (v.reservation6_count or 0) for v in vms),
        by_site=dict(Counter((v.site or "unknown") for v in vms)),
        by_service=dict(Counter((v.service or "unknown") for v in vms)),
        by_status=dict(Counter(val(v.status) for v in vms)),
    )
