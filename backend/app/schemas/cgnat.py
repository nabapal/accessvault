from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.cgnat import CgnatDeviceStatus, CgnatVendor


class CgnatDeviceBase(BaseModel):
    name: str
    mgmt_ip: str
    port: int = 443
    vendor: CgnatVendor = CgnatVendor.UNKNOWN
    verify_ssl: bool = False
    role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: int = 900
    connection_params: Dict[str, Any] = Field(default_factory=dict)


class CgnatDeviceCreate(CgnatDeviceBase):
    username: str
    password: str


class CgnatDeviceUpdate(BaseModel):
    name: Optional[str] = None
    mgmt_ip: Optional[str] = None
    port: Optional[int] = None
    vendor: Optional[CgnatVendor] = None
    verify_ssl: Optional[bool] = None
    role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    connection_params: Optional[Dict[str, Any]] = None
    username: Optional[str] = None
    password: Optional[str] = None


class CgnatDeviceRead(BaseModel):
    id: UUID
    name: str
    hostname: Optional[str] = None
    mgmt_ip: str
    port: int
    vendor: CgnatVendor
    verify_ssl: bool
    role: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    os_version: Optional[str] = None
    uptime_seconds: Optional[int] = None
    uptime_text: Optional[str] = None
    description: Optional[str] = None
    site_name: Optional[str] = None
    rack_location: Optional[str] = None
    poll_interval_seconds: int
    status: CgnatDeviceStatus
    last_polled_at: Optional[datetime] = None
    last_error: Optional[str] = None
    username: Optional[str] = None
    active_sessions: Optional[int] = None
    active_subscribers: Optional[int] = None
    total_translations: Optional[int] = None
    port_util_pct: Optional[float] = None
    exhaustion_events: Optional[int] = None
    virtual_server_count: Optional[int] = None
    license_product: Optional[str] = None
    license_expiry: Optional[str] = None
    license_bandwidth_mbps: Optional[int] = None
    license_notes: Optional[str] = None
    license_modules: Optional[List[Dict[str, Any]]] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CgnatInterfaceRead(BaseModel):
    id: UUID
    device_id: UUID
    name: str
    description: Optional[str] = None
    admin_state: Optional[str] = None
    oper_state: Optional[str] = None
    ip_address: Optional[str] = None
    addresses: List[str] = []
    nat_role: Optional[str] = None
    partition: Optional[str] = None
    route_domain: Optional[str] = None
    vlan: Optional[str] = None
    mtu: Optional[int] = None
    mac: Optional[str] = None

    class Config:
        from_attributes = True


class CgnatNatPoolRead(BaseModel):
    id: UUID
    device_id: UUID
    pool_name: str
    kind: Optional[str] = None
    mode: Optional[str] = None
    partition: Optional[str] = None
    route_domain: Optional[str] = None
    start_address: Optional[str] = None
    end_address: Optional[str] = None
    prefix: Optional[str] = None
    port_block_size: Optional[int] = None
    log_profile: Optional[str] = None
    pool_group: Optional[str] = None
    active_translations: Optional[int] = None
    translation_requests: Optional[int] = None
    translation_failures: Optional[int] = None
    port_util_pct: Optional[float] = None

    class Config:
        from_attributes = True


class CgnatStaticRouteRead(BaseModel):
    id: UUID
    device_id: UUID
    name: Optional[str] = None
    destination: Optional[str] = None
    next_hop: Optional[str] = None
    distance: Optional[int] = None
    route_domain: Optional[str] = None
    partition: Optional[str] = None
    egress_interface: Optional[str] = None
    egress_vlan: Optional[str] = None
    family: Optional[str] = None
    description: Optional[str] = None

    class Config:
        from_attributes = True


class CgnatDevicePage(BaseModel):
    items: List[CgnatDeviceRead]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class CgnatSyncResult(BaseModel):
    success: bool
    message: Optional[str] = None
    interfaces: int = 0
    pools: int = 0
    routes: int = 0
    device: CgnatDeviceRead


class CgnatConnectivityResult(BaseModel):
    reachable: bool
    message: Optional[str] = None
    hostname: Optional[str] = None
    checked_at: datetime


class CgnatSummary(BaseModel):
    total: int
    total_pools: int
    total_public_ips: int
    active_sessions: int
    total_translations: int
    exhaustion_events: int
    error_devices: int
    stale_devices: int
    by_vendor: Dict[str, int]
    by_status: Dict[str, int]
    by_role: Dict[str, int]
    by_location: Dict[str, int]
