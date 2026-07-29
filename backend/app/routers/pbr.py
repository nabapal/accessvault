"""PBR Flow Monitoring read API (SDD §8). Read-only, auth-guarded.

Serves the poller-populated domain model from the DB — never calls APIC per request.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.pbr import PbrHealthSample, PbrNode, PbrService, PbrServiceState, PbrSubnet
from app.models.telco import TelcoFabricOnboardingJob, TelcoFabricType
from app.schemas.pbr import (
    PbrBlastRadius,
    PbrBlastRadiusItem,
    PbrFabricRead,
    PbrFlowCandidate,
    PbrFlowLookupRequest,
    PbrFlowLookupResult,
    PbrHealthHistory,
    PbrHealthSampleRead,
    PbrServiceDetail,
    PbrServicePage,
    PbrServiceRead,
)
from app.services import pbr_compute as compute

router = APIRouter(prefix="/pbr", tags=["pbr"])

# A fabric's PBR view is "stale" if the newest service refresh is older than this.
_STALE_AFTER = timedelta(minutes=30)


def _ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@router.get("/fabrics", response_model=List[PbrFabricRead])
async def list_fabrics(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> List[PbrFabricRead]:
    jobs = (
        await db.execute(
            select(TelcoFabricOnboardingJob).where(
                TelcoFabricOnboardingJob.fabric_type == TelcoFabricType.ACI
            )
        )
    ).scalars().all()

    out: List[PbrFabricRead] = []
    now = datetime.now(timezone.utc)
    for job in jobs:
        services = (
            await db.execute(select(PbrService).where(PbrService.fabric_job_id == job.id))
        ).scalars().all()
        healthy = sum(1 for s in services if s.state == PbrServiceState.HEALTHY)
        degraded = sum(1 for s in services if s.state == PbrServiceState.DEGRADED)
        down = sum(1 for s in services if s.state == PbrServiceState.DOWN)
        unknown = sum(1 for s in services if s.state == PbrServiceState.UNKNOWN)
        scored = [s.health_pct for s in services if s.health_pct is not None]
        avg = sum(scored) / len(scored) if scored else None
        stale_as_of = max((s.stale_as_of for s in services if s.stale_as_of), default=None)
        is_stale = (not services) or stale_as_of is None or (
            _ensure_aware(stale_as_of) < now - _STALE_AFTER
        )
        out.append(
            PbrFabricRead(
                fabric_job_id=job.id,
                name=job.name,
                target_host=job.target_host,
                service_count=len(services),
                healthy_count=healthy,
                degraded_count=degraded,
                down_count=down,
                unknown_count=unknown,
                avg_health_pct=avg,
                stale_as_of=stale_as_of,
                is_stale=bool(is_stale),
            )
        )
    return out


@router.get("/fabrics/{fabric_id}/services", response_model=PbrServicePage)
async def list_services(
    fabric_id: UUID,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    search: Optional[str] = Query(default=None),
    state: Optional[PbrServiceState] = Query(default=None),
    sort: str = Query(default="health", pattern="^(health|name|state)$"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> PbrServicePage:
    filters = [PbrService.fabric_job_id == fabric_id]
    if state is not None:
        filters.append(PbrService.state == state)
    if search:
        term = f"%{search.lower()}%"
        filters.append(
            func.lower(PbrService.contract_name).like(term)
            | func.lower(PbrService.graph_name).like(term)
        )

    total = (
        await db.execute(select(func.count()).select_from(PbrService).where(*filters))
    ).scalar_one()

    order = {
        "health": PbrService.health_pct.asc(),
        "name": PbrService.contract_name.asc(),
        "state": PbrService.state.asc(),
    }[sort]

    offset = (page - 1) * page_size
    rows = (
        await db.execute(
            select(PbrService).where(*filters).order_by(order).offset(offset).limit(page_size)
        )
    ).scalars().all()

    return PbrServicePage(
        items=[PbrServiceRead.model_validate(r, from_attributes=True) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=offset + page_size < total,
        has_prev=page > 1,
    )


@router.get("/services/{service_id}", response_model=PbrServiceDetail)
async def get_service(
    service_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> PbrServiceDetail:
    service = (
        await db.execute(
            select(PbrService)
            .where(PbrService.id == service_id)
            .options(selectinload(PbrService.nodes).selectinload(PbrNode.redirect_dests))
        )
    ).scalar_one_or_none()
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    return PbrServiceDetail.model_validate(service, from_attributes=True)


@router.get("/services/{service_id}/blast-radius", response_model=PbrBlastRadius)
async def get_blast_radius(
    service_id: UUID,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> PbrBlastRadius:
    target = (
        await db.execute(
            select(PbrService).where(PbrService.id == service_id).options(selectinload(PbrService.nodes))
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    others = (
        await db.execute(
            select(PbrService)
            .where(PbrService.fabric_job_id == target.fabric_job_id, PbrService.id != service_id)
            .options(selectinload(PbrService.nodes))
        )
    ).scalars().all()

    def dgs(svc: PbrService) -> set[str]:
        return {n.device_group_dn for n in svc.nodes if n.device_group_dn}

    target_dgs = dgs(target)
    items: List[PbrBlastRadiusItem] = []
    for svc in others:
        shared = target_dgs & dgs(svc)
        if shared:
            items.append(
                PbrBlastRadiusItem(
                    service_id=svc.id,
                    contract_name=svc.contract_name,
                    graph_name=svc.graph_name,
                    state=svc.state,
                    health_pct=svc.health_pct,
                    shared_device_groups=sorted(shared),
                )
            )
    return PbrBlastRadius(service_id=service_id, items=items)


@router.get("/services/{service_id}/health-history", response_model=PbrHealthHistory)
async def get_health_history(
    service_id: UUID,
    window_hours: int = Query(default=24, ge=1, le=24 * 30),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> PbrHealthHistory:
    since = datetime.now(timezone.utc) - timedelta(hours=window_hours)
    rows = (
        await db.execute(
            select(PbrHealthSample)
            .where(PbrHealthSample.service_id == service_id, PbrHealthSample.sampled_at >= since)
            .order_by(PbrHealthSample.sampled_at.asc())
        )
    ).scalars().all()
    return PbrHealthHistory(
        service_id=service_id,
        samples=[PbrHealthSampleRead.model_validate(r, from_attributes=True) for r in rows],
    )


@router.post("/fabrics/{fabric_id}/flow-lookup", response_model=PbrFlowLookupResult)
async def flow_lookup(
    fabric_id: UUID,
    payload: PbrFlowLookupRequest,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> PbrFlowLookupResult:
    """IP-flow lookup (SDD §5.3). Input is validated SERVER-SIDE here (as well as in the UI)."""
    subnets = (
        await db.execute(select(PbrSubnet).where(PbrSubnet.fabric_job_id == fabric_id))
    ).scalars().all()

    svc_lookup = {}
    subnet_inputs: List[compute.SubnetInput] = []
    for sn in subnets:
        contract_dn = ""
        if sn.service_id is not None:
            if sn.service_id not in svc_lookup:
                svc_lookup[sn.service_id] = (
                    await db.execute(select(PbrService).where(PbrService.id == sn.service_id))
                ).scalar_one_or_none()
            svc = svc_lookup[sn.service_id]
            contract_dn = svc.contract_dn if svc else ""
        subnet_inputs.append(
            compute.SubnetInput(
                prefix=sn.prefix,
                scope_valid=sn.scope_valid,
                is_default_route=sn.is_default_route,
                service_id=str(sn.service_id) if sn.service_id else "",
                contract_dn=contract_dn,
                side=sn.side or "",
                epg_dn=sn.epg_dn,
            )
        )

    try:
        result = compute.match_flow(payload.source, payload.destination, subnet_inputs)
    except compute.FlowLookupError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    candidates = [
        PbrFlowCandidate(
            service_id=UUID(c.service_id) if c.service_id else None,
            contract_dn=c.contract_dn,
            src_prefix=c.src_subnet.prefix,
            dst_prefix=c.dst_subnet.prefix,
            used_default_route=c.used_default_route,
        )
        for c in result.candidates
    ]
    return PbrFlowLookupResult(
        matched=bool(candidates),
        ambiguous=result.ambiguous,
        message=result.message,
        candidates=candidates,
    )
