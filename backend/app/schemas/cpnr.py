from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.cpnr import CpnrPairStatus, CpnrRole, CpnrStatus


class CpnrVmBase(BaseModel):
    name: str
    site: Optional[str] = None
    service: Optional[str] = None
    role: CpnrRole = CpnrRole.LOCAL
    pair_id: Optional[str] = None
    mgmt_ip: str
    port: int = 8443
    verify_ssl: bool = False
    description: Optional[str] = None
    poll_interval_seconds: int = 900


class CpnrVmCreate(CpnrVmBase):
    username: str
    password: str


class CpnrVmUpdate(BaseModel):
    name: Optional[str] = None
    site: Optional[str] = None
    service: Optional[str] = None
    role: Optional[CpnrRole] = None
    pair_id: Optional[str] = None
    mgmt_ip: Optional[str] = None
    port: Optional[int] = None
    verify_ssl: Optional[bool] = None
    description: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None


class CpnrVmRead(BaseModel):
    id: UUID
    name: str
    site: Optional[str] = None
    service: Optional[str] = None
    role: CpnrRole
    pair_id: Optional[str] = None
    mgmt_ip: str
    port: int
    verify_ssl: bool
    username: Optional[str] = None
    version: Optional[str] = None
    cluster_role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: int
    status: CpnrStatus
    last_polled_at: Optional[datetime] = None
    last_error: Optional[str] = None
    scope_count: Optional[int] = None
    prefix_count: Optional[int] = None
    reservation4_count: Optional[int] = None
    reservation6_count: Optional[int] = None
    client_count: Optional[int] = None
    client_class_count: Optional[int] = None
    pair_status: CpnrPairStatus
    inconsistency_count: Optional[int] = None
    last_compared_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CpnrVmPage(BaseModel):
    items: List[CpnrVmRead]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class CpnrObjectRead(BaseModel):
    id: UUID
    object_type: str
    object_key: str
    content_hash: str
    data: Dict[str, Any]
    updated_at: datetime

    class Config:
        from_attributes = True


class CpnrChangeEventRead(BaseModel):
    id: UUID
    ts: datetime
    object_type: str
    object_key: str
    action: str
    changes: Optional[List[Dict[str, Any]]] = None

    class Config:
        from_attributes = True


class CpnrConnectivityResult(BaseModel):
    reachable: bool
    checked_at: datetime
    version: Optional[str] = None
    message: Optional[str] = None


class CpnrSyncResult(BaseModel):
    success: bool
    message: Optional[str] = None
    counts: Dict[str, int] = Field(default_factory=dict)
    vm: CpnrVmRead


# --- pair comparison (req 3/4) ---
class CpnrPairTypeReport(BaseModel):
    primary_count: int
    secondary_count: int
    only_primary: List[str]
    only_secondary: List[str]
    mismatched: List[Dict[str, Any]]
    inconsistency_count: int


class CpnrPairComparison(BaseModel):
    pair_id: str
    in_sync: bool
    inconsistency_count: int
    primary: Dict[str, Any]
    secondary: Dict[str, Any]
    by_type: Dict[str, CpnrPairTypeReport]


class CpnrPairSummary(BaseModel):
    pair_id: str
    service: Optional[str] = None
    site: Optional[str] = None
    primary: Optional[CpnrVmRead] = None
    secondary: Optional[CpnrVmRead] = None
    pair_status: CpnrPairStatus
    inconsistency_count: Optional[int] = None
    last_compared_at: Optional[datetime] = None


class CpnrSummary(BaseModel):
    total_vms: int
    total_pairs: int
    pairs_in_sync: int
    pairs_drift: int
    error_vms: int
    total_scopes: int
    total_prefixes: int
    total_reservations: int
    by_site: Dict[str, int]
    by_service: Dict[str, int]
    by_status: Dict[str, int]
