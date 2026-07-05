from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models import (
    AciFabricEndpoint,
    AciFabricNode,
    AciFabricNodeDetail,
    AciFabricNodeInterface,
    AciFabricVlan,
    AciNodeRole,
    TelcoFabricOnboardingJob,
)
from app.schemas import (
    AciFabricEndpointPage,
    AciFabricEndpointRead,
    AciFabricVlanPage,
    AciFabricVlanRead,
    AciFreePortFabric,
    AciFreePortNode,
    AciFreePortReport,
    AciFabricNodeDetailRead,
    AciFabricNodeInterfaceRead,
    AciFabricNodePage,
    AciFabricNodeRead,
    AciFabricNodeSummary,
    AciFabricSummaryDetails,
    AciFabricSummaryFabric,
)

router = APIRouter(prefix="/aci", tags=["aci"])


def _serialize_node(node: AciFabricNode) -> AciFabricNodeRead:
    return AciFabricNodeRead.model_validate(node, from_attributes=True)


def _serialize_node_detail(
    node: AciFabricNode,
    detail: AciFabricNodeDetail | None,
) -> AciFabricNodeDetailRead:
    firmware_payload = detail.firmware if detail and detail.firmware else None
    return AciFabricNodeDetailRead(
        node=_serialize_node(node),
        collected_at=detail.collected_at if detail else None,
        general=detail.general if detail and detail.general else {},
        health=detail.health if detail and detail.health else {},
        resources=detail.resources if detail and detail.resources else {},
        environment=detail.environment if detail and detail.environment else {},
        firmware=firmware_payload,
        port_channels=detail.port_channels if detail and detail.port_channels else [],
    )


@router.get("/fabric/nodes", response_model=AciFabricNodePage)
async def list_fabric_nodes(
    page: int = Query(default=1, ge=1, description="1-indexed page number"),
    page_size: int = Query(default=25, ge=1, le=200, description="Number of records per page"),
    role: Optional[AciNodeRole] = Query(default=None, description="Filter by fabric role"),
    search: Optional[str] = Query(
        default=None,
        description="Case-insensitive search across name, address, serial, model, fabric name, or fabric IP",
    ),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricNodePage:
    telco_alias = aliased(TelcoFabricOnboardingJob)

    conditions = []
    stmt = (
        select(AciFabricNode)
        .options(selectinload(AciFabricNode.fabric_job))
        .outerjoin(telco_alias, AciFabricNode.fabric_job_id == telco_alias.id)
        .order_by(AciFabricNode.name)
    )
    count_stmt = select(func.count()).select_from(AciFabricNode).outerjoin(
        telco_alias, AciFabricNode.fabric_job_id == telco_alias.id
    )

    if role is not None:
        condition = AciFabricNode.role == role
        conditions.append(condition)

    if search:
        pattern = f"%{search.strip().lower()}%"
        search_condition = or_(
            func.lower(AciFabricNode.name).like(pattern),
            func.lower(AciFabricNode.address).like(pattern),
            func.lower(AciFabricNode.serial).like(pattern),
            func.lower(AciFabricNode.model).like(pattern),
            func.lower(func.coalesce(AciFabricNode.site_name, "")).like(pattern),
            func.lower(func.coalesce(AciFabricNode.rack_location, "")).like(pattern),
            func.lower(func.coalesce(AciFabricNode.version, "")).like(pattern),
            func.lower(func.coalesce(AciFabricNode.fabric_state, "")).like(pattern),
            func.lower(func.coalesce(AciFabricNode.role, "")).like(pattern),
            func.lower(func.coalesce(AciFabricNode.pod, "")).like(pattern),
            func.lower(func.coalesce(AciFabricNode.distinguished_name, "")).like(pattern),
            func.lower(func.coalesce(telco_alias.name, "")).like(pattern),
            func.lower(func.coalesce(telco_alias.target_host, "")).like(pattern),
        )
        conditions.append(search_condition)

    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = (await db.execute(count_stmt)).scalar_one()

    if total == 0:
        page = 1
    else:
        last_page = max(1, (total + page_size - 1) // page_size)
        if page > last_page:
            page = last_page

    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    result = await db.execute(stmt)
    nodes = result.scalars().all()

    items = [_serialize_node(node) for node in nodes]
    has_next = offset + len(items) < total
    has_prev = page > 1

    return AciFabricNodePage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
        has_prev=has_prev,
    )


@router.get("/fabric/nodes/{node_id}", response_model=AciFabricNodeRead)
async def get_fabric_node(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricNodeRead:
    node = await db.get(AciFabricNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Fabric node not found")
    return _serialize_node(node)


@router.get("/fabric/nodes/{node_id}/detail", response_model=AciFabricNodeDetailRead)
async def get_fabric_node_detail(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricNodeDetailRead:
    node = await db.get(AciFabricNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Fabric node not found")

    result = await db.execute(
        select(AciFabricNodeDetail).where(AciFabricNodeDetail.node_id == node.id)
    )
    detail = result.scalar_one_or_none()

    return _serialize_node_detail(node, detail)


@router.get("/fabric/nodes/{node_id}/interfaces", response_model=List[AciFabricNodeInterfaceRead])
async def list_fabric_node_interfaces(
    node_id: str,
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> list[AciFabricNodeInterfaceRead]:
    node = await db.get(AciFabricNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="Fabric node not found")

    result = await db.execute(
        select(AciFabricNodeInterface)
        .where(AciFabricNodeInterface.node_id == node.id)
        .order_by(AciFabricNodeInterface.name)
    )
    interfaces = result.scalars().all()
    return [AciFabricNodeInterfaceRead.model_validate(item, from_attributes=True) for item in interfaces]


@router.get("/fabric/endpoints", response_model=AciFabricEndpointPage)
async def list_fabric_endpoints(
    page: int = Query(default=1, ge=1, description="1-indexed page number"),
    page_size: int = Query(default=25, ge=1, le=200, description="Number of records per page"),
    fabric: Optional[str] = Query(default=None, description="Case-insensitive match on fabric name or IP"),
    search: Optional[str] = Query(
        default=None,
        description="Case-insensitive search across MAC, tenant, EPG, encap, bridge domain, VRF, interface, or fabric",
    ),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricEndpointPage:
    telco_alias = aliased(TelcoFabricOnboardingJob)

    conditions = []
    stmt = (
        select(AciFabricEndpoint)
        .options(selectinload(AciFabricEndpoint.fabric_job))
        .outerjoin(telco_alias, AciFabricEndpoint.fabric_job_id == telco_alias.id)
        .order_by(AciFabricEndpoint.mac, AciFabricEndpoint.distinguished_name)
    )
    count_stmt = select(func.count()).select_from(AciFabricEndpoint).outerjoin(
        telco_alias, AciFabricEndpoint.fabric_job_id == telco_alias.id
    )

    if fabric:
        fabric_pattern = f"%{fabric.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(func.coalesce(telco_alias.name, "")).like(fabric_pattern),
                func.lower(func.coalesce(telco_alias.target_host, "")).like(fabric_pattern),
            )
        )

    if search:
        pattern = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(func.coalesce(AciFabricEndpoint.mac, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.tenant, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.app_profile, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.epg, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.encap, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.bridge_domain, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.vrf, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.interface, "")).like(pattern),
                func.lower(func.coalesce(AciFabricEndpoint.learning_source, "")).like(pattern),
                func.lower(func.coalesce(telco_alias.name, "")).like(pattern),
                func.lower(func.coalesce(telco_alias.target_host, "")).like(pattern),
            )
        )

    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = (await db.execute(count_stmt)).scalar_one()

    if total == 0:
        page = 1
    else:
        last_page = max(1, (total + page_size - 1) // page_size)
        if page > last_page:
            page = last_page

    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    result = await db.execute(stmt)
    endpoints = result.scalars().all()

    items = [AciFabricEndpointRead.model_validate(item, from_attributes=True) for item in endpoints]
    has_next = offset + len(items) < total
    has_prev = page > 1

    return AciFabricEndpointPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
        has_prev=has_prev,
    )


@router.get("/fabric/vlans", response_model=AciFabricVlanPage)
async def list_fabric_vlans(
    page: int = Query(default=1, ge=1, description="1-indexed page number"),
    page_size: int = Query(default=25, ge=1, le=200, description="Number of records per page"),
    fabric: Optional[str] = Query(default=None, description="Case-insensitive match on fabric name or IP"),
    search: Optional[str] = Query(
        default=None,
        description="Case-insensitive search across VLAN id, encap, EPG, tenant, app, BD, VRF, or fabric",
    ),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricVlanPage:
    telco_alias = aliased(TelcoFabricOnboardingJob)

    conditions = []
    stmt = (
        select(AciFabricVlan)
        .options(selectinload(AciFabricVlan.fabric_job))
        .outerjoin(telco_alias, AciFabricVlan.fabric_job_id == telco_alias.id)
        .order_by(AciFabricVlan.vlan_id, AciFabricVlan.encap)
    )
    count_stmt = select(func.count()).select_from(AciFabricVlan).outerjoin(
        telco_alias, AciFabricVlan.fabric_job_id == telco_alias.id
    )

    if fabric:
        fabric_pattern = f"%{fabric.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(func.coalesce(telco_alias.name, "")).like(fabric_pattern),
                func.lower(func.coalesce(telco_alias.target_host, "")).like(fabric_pattern),
            )
        )

    if search:
        pattern = f"%{search.strip().lower()}%"
        conditions.append(
            or_(
                func.lower(func.coalesce(AciFabricVlan.encap, "")).like(pattern),
                func.lower(func.coalesce(AciFabricVlan.epg, "")).like(pattern),
                func.lower(func.coalesce(AciFabricVlan.tenant, "")).like(pattern),
                func.lower(func.coalesce(AciFabricVlan.app_profile, "")).like(pattern),
                func.lower(func.coalesce(AciFabricVlan.bridge_domain, "")).like(pattern),
                func.lower(func.coalesce(AciFabricVlan.vrf, "")).like(pattern),
                func.lower(func.coalesce(telco_alias.name, "")).like(pattern),
                func.lower(func.coalesce(telco_alias.target_host, "")).like(pattern),
            )
        )

    for condition in conditions:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = (await db.execute(count_stmt)).scalar_one()

    if total == 0:
        page = 1
    else:
        last_page = max(1, (total + page_size - 1) // page_size)
        if page > last_page:
            page = last_page

    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    result = await db.execute(stmt)
    vlans = result.scalars().all()

    items = [AciFabricVlanRead.model_validate(item, from_attributes=True) for item in vlans]
    has_next = offset + len(items) < total
    has_prev = page > 1

    return AciFabricVlanPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=has_next,
        has_prev=has_prev,
    )


def _natural_port_key(name: str) -> list:
    """Sort key so eth1/2 precedes eth1/10 (numeric segments compared as ints)."""
    return [int(token) if token.isdigit() else token for token in re.split(r"(\d+)", name or "")]


@router.get("/fabric/free-ports", response_model=AciFreePortReport)
async def get_fabric_free_ports(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFreePortReport:
    """Cross-fabric free access-port report.

    A port is free when operSt=down AND operStQual=sfp-missing AND its usage is not a
    fabric uplink (``fabric`` not present in the usage string). Down + sfp-missing ports
    that ARE fabric uplinks are reported as excluded rather than free.
    """
    switch_roles = [AciNodeRole.LEAF, AciNodeRole.SPINE]

    node_result = await db.execute(
        select(AciFabricNode)
        .options(selectinload(AciFabricNode.fabric_job))
        .where(AciFabricNode.role.in_(switch_roles))
        .order_by(AciFabricNode.name)
    )
    nodes = node_result.scalars().all()
    node_ids = [node.id for node in nodes]

    # Only the down + sfp-missing interfaces are relevant to the report.
    interfaces_by_node: dict[object, list[AciFabricNodeInterface]] = defaultdict(list)
    if node_ids:
        iface_result = await db.execute(
            select(AciFabricNodeInterface).where(
                AciFabricNodeInterface.node_id.in_(node_ids),
                func.lower(AciFabricNodeInterface.oper_state) == "down",
                func.lower(func.coalesce(AciFabricNodeInterface.oper_st_qual, "")) == "sfp-missing",
            )
        )
        for iface in iface_result.scalars():
            interfaces_by_node[iface.node_id].append(iface)

    node_rows: list[AciFreePortNode] = []
    fabric_groups: dict[str, dict[str, object]] = {}

    for node in nodes:
        matches = interfaces_by_node.get(node.id, [])
        free_ports: list[str] = []
        excluded = 0
        for iface in matches:
            if "fabric" in (iface.usage or "").lower():
                excluded += 1
            else:
                free_ports.append(iface.name)
        free_ports.sort(key=_natural_port_key)
        free = len(free_ports)
        sfp_missing = free + excluded

        node_rows.append(
            AciFreePortNode(
                node_uuid=node.id,
                fabric_job_id=node.fabric_job_id,
                fabric_name=node.fabric_name,
                fabric_ip=node.fabric_ip,
                node_id=node.node_id,
                name=node.name,
                model=node.model,
                role=node.role.value if isinstance(node.role, AciNodeRole) else str(node.role),
                pod=node.pod,
                free=free,
                excluded=excluded,
                sfp_missing=sfp_missing,
                free_ports=free_ports,
            )
        )

        group_key = str(node.fabric_job_id) if node.fabric_job_id else "__unassigned__"
        summary = fabric_groups.get(group_key)
        if summary is None:
            summary = {
                "fabric_job_id": node.fabric_job_id,
                "fabric_name": node.fabric_name or "Unassigned Fabric",
                "fabric_ip": node.fabric_ip,
                "free": 0,
                "excluded": 0,
                "sfp_missing": 0,
                "nodes_with_free": 0,
                "total_nodes": 0,
            }
            fabric_groups[group_key] = summary
        summary["free"] = int(summary["free"]) + free
        summary["excluded"] = int(summary["excluded"]) + excluded
        summary["sfp_missing"] = int(summary["sfp_missing"]) + sfp_missing
        summary["total_nodes"] = int(summary["total_nodes"]) + 1
        if free > 0:
            summary["nodes_with_free"] = int(summary["nodes_with_free"]) + 1

    fabrics = [
        AciFreePortFabric(
            fabric_job_id=value["fabric_job_id"],
            fabric_name=value["fabric_name"],
            fabric_ip=value["fabric_ip"],
            free=value["free"],
            excluded=value["excluded"],
            sfp_missing=value["sfp_missing"],
            nodes_with_free=value["nodes_with_free"],
            total_nodes=value["total_nodes"],
        )
        for value in fabric_groups.values()
    ]
    fabrics.sort(key=lambda item: (-item.free, item.fabric_name.lower()))

    return AciFreePortReport(
        fabrics=fabrics,
        nodes=node_rows,
        total_free=sum(item.free for item in node_rows),
        total_excluded=sum(item.excluded for item in node_rows),
        total_sfp_missing=sum(item.sfp_missing for item in node_rows),
        total_fabrics=len(fabrics),
        total_nodes=len(node_rows),
    )


@router.get("/fabric/summary", response_model=AciFabricNodeSummary)
async def get_fabric_summary(
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricNodeSummary:
    result = await db.execute(select(AciFabricNode))
    nodes = result.scalars().all()
    total = len(nodes)
    role_counts = Counter(node.role for node in nodes)
    delayed = sum(1 for node in nodes if node.delayed_heartbeat)
    fabric_states = Counter((node.fabric_state or "unknown") for node in nodes)
    version_counts = Counter((node.version or "unknown") for node in nodes)

    return AciFabricNodeSummary(
        total=total,
        leaf_count=role_counts.get(AciNodeRole.LEAF, 0),
        spine_count=role_counts.get(AciNodeRole.SPINE, 0),
        controller_count=role_counts.get(AciNodeRole.CONTROLLER, 0),
        unspecified_count=role_counts.get(AciNodeRole.UNSPECIFIED, 0),
        delayed_heartbeat=delayed,
        by_fabric_state=dict(sorted(fabric_states.items())),
        by_version=dict(sorted(version_counts.items())),
    )


@router.get("/fabric/summary/details", response_model=AciFabricSummaryDetails)
async def get_fabric_summary_details(
    fabric: Optional[str] = Query(default=None, description="Case-insensitive match on fabric name or IP"),
    roles: Optional[list[AciNodeRole]] = Query(default=None, description="Filter by node roles"),
    models: Optional[list[str]] = Query(default=None, description="Filter by hardware models"),
    versions: Optional[list[str]] = Query(default=None, description="Filter by software versions"),
    fabric_states: Optional[list[str]] = Query(default=None, description="Filter by fabric states"),
    db: AsyncSession = Depends(get_db),
    _: object = Depends(get_current_user),
) -> AciFabricSummaryDetails:
    stmt = select(AciFabricNode).options(selectinload(AciFabricNode.fabric_job)).order_by(AciFabricNode.name)

    if roles:
        stmt = stmt.where(AciFabricNode.role.in_(roles))
    if fabric_states:
        normalized_states = [state for state in fabric_states if state.lower() != "unknown"]
        include_unknown = any(state.lower() == "unknown" for state in fabric_states)
        state_conditions = []
        if normalized_states:
            state_conditions.append(AciFabricNode.fabric_state.in_(normalized_states))
        if include_unknown:
            state_conditions.append(AciFabricNode.fabric_state.is_(None))
        if state_conditions:
            stmt = stmt.where(or_(*state_conditions))

    result = await db.execute(stmt)
    nodes = result.scalars().all()

    available_roles = sorted({node.role.value for node in nodes})
    available_models_set = {node.model for node in nodes if node.model}
    available_versions_set = {node.version for node in nodes if node.version}
    available_states_set = {node.fabric_state for node in nodes if node.fabric_state}

    has_unknown_model = any(node.model is None for node in nodes)
    has_unknown_version = any(node.version is None for node in nodes)
    has_unknown_state = any(node.fabric_state is None for node in nodes)

    if has_unknown_model:
        available_models_set.add("unknown")
    if has_unknown_version:
        available_versions_set.add("unknown")
    if has_unknown_state:
        available_states_set.add("unknown")

    available_models = sorted(available_models_set)
    available_versions = sorted(available_versions_set)
    available_fabric_states = sorted(available_states_set)

    fabric_term = fabric.lower() if fabric else None
    model_filter = {value.lower() for value in models} if models else None
    version_filter = {value.lower() for value in versions} if versions else None

    filtered_nodes: list[AciFabricNode] = []
    for node in nodes:
        if fabric_term:
            name_candidate = (node.fabric_name or "Unassigned Fabric").lower()
            ip_candidate = (node.fabric_ip or "").lower()
            if fabric_term not in name_candidate and fabric_term not in ip_candidate:
                continue
        if model_filter:
            model_value = (node.model or "unknown").lower()
            if model_value not in model_filter:
                continue
        if version_filter:
            version_value = (node.version or "unknown").lower()
            if version_value not in version_filter:
                continue
        filtered_nodes.append(node)

    fabric_groups: dict[str, dict[str, object]] = {}

    for node in filtered_nodes:
        fabric_job = node.fabric_job
        group_key = str(fabric_job.id) if fabric_job else "__unassigned__"
        summary = fabric_groups.get(group_key)
        if summary is None:
            summary = {
                "fabric_job_id": fabric_job.id if fabric_job else None,
                "fabric_name": node.fabric_name or "Unassigned Fabric",
                "fabric_ip": node.fabric_ip,
                "total_nodes": 0,
                "delayed_heartbeat": 0,
                "by_role": defaultdict(int),
                "by_model": defaultdict(int),
                "by_version": defaultdict(int),
                "by_fabric_state": defaultdict(int),
                "last_polled_at": fabric_job.last_polled_at if fabric_job else None,
            }
            fabric_groups[group_key] = summary

        summary["total_nodes"] = int(summary["total_nodes"]) + 1
        if node.delayed_heartbeat:
            summary["delayed_heartbeat"] = int(summary["delayed_heartbeat"]) + 1

        role_key = node.role.value if isinstance(node.role, AciNodeRole) else str(node.role)
        summary["by_role"][role_key] += 1
        summary["by_model"][node.model or "unknown"] += 1
        summary["by_version"][node.version or "unknown"] += 1
        summary["by_fabric_state"][node.fabric_state or "unknown"] += 1

        if fabric_job and summary.get("last_polled_at") is None:
            summary["last_polled_at"] = fabric_job.last_polled_at

    fabrics: list[AciFabricSummaryFabric] = []
    for value in fabric_groups.values():
        fabrics.append(
            AciFabricSummaryFabric(
                fabric_job_id=value["fabric_job_id"],
                fabric_name=value["fabric_name"],
                fabric_ip=value["fabric_ip"],
                total_nodes=value["total_nodes"],
                delayed_heartbeat=value["delayed_heartbeat"],
                by_role=dict(sorted(value["by_role"].items(), key=lambda item: (-item[1], item[0]))),
                by_model=dict(sorted(value["by_model"].items(), key=lambda item: (-item[1], item[0]))),
                by_version=dict(sorted(value["by_version"].items(), key=lambda item: (-item[1], item[0]))),
                by_fabric_state=dict(sorted(value["by_fabric_state"].items(), key=lambda item: (-item[1], item[0]))),
                last_polled_at=value["last_polled_at"],
            )
        )

    fabrics.sort(key=lambda item: (-item.total_nodes, item.fabric_name.lower()))

    return AciFabricSummaryDetails(
        total_nodes=len(filtered_nodes),
        total_fabrics=len(fabrics),
        fabrics=fabrics,
        available_roles=available_roles,
        available_models=available_models,
        available_versions=available_versions,
        available_fabric_states=available_fabric_states,
    )
