from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.pbr import PbrLayer, PbrNodeStatus, PbrServiceState, PbrThresholdAction


class PbrRedirectDestRead(BaseModel):
    id: UUID
    ip: Optional[str]
    mac: Optional[str]
    layer: PbrLayer
    l1_interface_ref: Optional[str]
    resolved: bool
    learned: bool

    class Config:
        from_attributes = True


class PbrNodeRead(BaseModel):
    id: UUID
    distinguished_name: str
    name: Optional[str]
    function_type: Optional[str]
    layer: PbrLayer
    device_group_dn: Optional[str]
    device_group_name: Optional[str]
    leaf: Optional[str]
    path: Optional[str]
    consumer_bd: Optional[str]
    consumer_vrf: Optional[str]
    consumer_vlan: Optional[str]
    provider_bd: Optional[str]
    provider_vrf: Optional[str]
    provider_vlan: Optional[str]
    redirect_policy_names: List[str] = Field(default_factory=list)
    threshold_enable: bool
    min_threshold_pct: Optional[float]
    max_threshold_pct: Optional[float]
    threshold_down_action: PbrThresholdAction
    configured_dest_count: int
    learned_dest_count: int
    health_pct: Optional[float]
    live_status: PbrNodeStatus
    bypassed: bool
    active_pct: Optional[float] = None
    detail: Dict[str, Any] = Field(default_factory=dict)
    redirect_dests: List[PbrRedirectDestRead] = Field(default_factory=list)

    class Config:
        from_attributes = True


class PbrServiceRead(BaseModel):
    id: UUID
    fabric_job_id: UUID
    contract_dn: str
    graph_dn: str
    contract_name: Optional[str]
    graph_name: Optional[str]
    consumer_epg_dn: Optional[str]
    provider_epg_dn: Optional[str]
    consumer_epg_name: Optional[str]
    provider_epg_name: Optional[str]
    health_pct: Optional[float]
    state: PbrServiceState
    stale_as_of: Optional[datetime]
    updated_at: datetime

    class Config:
        from_attributes = True


class PbrServiceDetail(PbrServiceRead):
    consumer_epgs: List[Dict[str, Any]] = Field(default_factory=list)
    provider_epgs: List[Dict[str, Any]] = Field(default_factory=list)
    nodes: List[PbrNodeRead] = Field(default_factory=list)


class PbrServicePage(BaseModel):
    items: List[PbrServiceRead]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class PbrFabricRead(BaseModel):
    fabric_job_id: UUID
    name: str
    target_host: str
    service_count: int
    healthy_count: int
    degraded_count: int
    down_count: int
    unknown_count: int
    avg_health_pct: Optional[float]
    stale_as_of: Optional[datetime] = None
    is_stale: bool = False


class PbrBlastRadiusItem(BaseModel):
    service_id: UUID
    contract_name: Optional[str]
    graph_name: Optional[str]
    state: PbrServiceState
    health_pct: Optional[float]
    shared_device_groups: List[str] = Field(default_factory=list)


class PbrBlastRadius(BaseModel):
    service_id: UUID
    items: List[PbrBlastRadiusItem] = Field(default_factory=list)


class PbrHealthSampleRead(BaseModel):
    sampled_at: datetime
    health_pct: Optional[float]
    state: PbrServiceState

    class Config:
        from_attributes = True


class PbrHealthHistory(BaseModel):
    service_id: UUID
    samples: List[PbrHealthSampleRead] = Field(default_factory=list)


class PbrFlowLookupRequest(BaseModel):
    source: str = Field(..., description="Single source host IP (IPv4 or IPv6, no CIDR).")
    destination: str = Field(..., description="Single destination host IP (IPv4 or IPv6, no CIDR).")


class PbrFlowCandidate(BaseModel):
    service_id: Optional[UUID] = None
    contract_dn: str
    src_prefix: str
    dst_prefix: str
    src_side: Optional[str] = None  # "consumer" | "provider"
    dst_side: Optional[str] = None
    used_default_route: bool


class PbrFlowLookupResult(BaseModel):
    matched: bool
    ambiguous: bool
    message: Optional[str] = None
    candidates: List[PbrFlowCandidate] = Field(default_factory=list)
