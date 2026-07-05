from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.ipmpls import IpMplsDeviceStatus, IpMplsPlatform


class IpMplsDeviceBase(BaseModel):
    name: str
    mgmt_ip: str
    port: int = 22
    platform: IpMplsPlatform = IpMplsPlatform.UNKNOWN
    role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: int = 900
    connection_params: Dict[str, Any] = Field(default_factory=dict)


class IpMplsDeviceCreate(IpMplsDeviceBase):
    username: str
    password: str
    enable: Optional[str] = None


class IpMplsDeviceUpdate(BaseModel):
    name: Optional[str] = None
    mgmt_ip: Optional[str] = None
    port: Optional[int] = None
    platform: Optional[IpMplsPlatform] = None
    role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    connection_params: Optional[Dict[str, Any]] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enable: Optional[str] = None


class IpMplsDeviceRead(BaseModel):
    id: UUID
    name: str
    hostname: Optional[str] = None
    mgmt_ip: str
    port: int
    platform: IpMplsPlatform
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
    status: IpMplsDeviceStatus
    last_polled_at: Optional[datetime] = None
    last_error: Optional[str] = None
    username: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IpMplsInterfaceRead(BaseModel):
    id: UUID
    device_id: UUID
    name: str
    description: Optional[str] = None
    admin_state: Optional[str] = None
    oper_state: Optional[str] = None
    ip_address: Optional[str] = None
    prefix_len: Optional[int] = None
    vrf: Optional[str] = None
    speed: Optional[str] = None
    mtu: Optional[int] = None
    mac: Optional[str] = None
    mpls_enabled: Optional[bool] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class IpMplsModuleRead(BaseModel):
    id: UUID
    device_id: UUID
    name: Optional[str] = None
    description: Optional[str] = None
    pid: Optional[str] = None
    vid: Optional[str] = None
    serial: Optional[str] = None

    class Config:
        from_attributes = True


class IpMplsVrfRead(BaseModel):
    id: UUID
    device_id: UUID
    name: str
    rd: Optional[str] = None
    rt_import: List[str] = Field(default_factory=list)
    rt_export: List[str] = Field(default_factory=list)
    interfaces: List[str] = Field(default_factory=list)
    protocols: Optional[str] = None
    description: Optional[str] = None

    class Config:
        from_attributes = True


class IpMplsNeighborRead(BaseModel):
    id: UUID
    device_id: UUID
    protocol: str
    neighbor_id: Optional[str] = None
    address: Optional[str] = None
    interface: Optional[str] = None
    state: Optional[str] = None
    uptime: Optional[str] = None
    vrf: Optional[str] = None
    attributes: dict = Field(default_factory=dict)

    class Config:
        from_attributes = True


class IpMplsDevicePage(BaseModel):
    items: List[IpMplsDeviceRead]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class IpMplsSyncResult(BaseModel):
    success: bool
    message: Optional[str] = None
    interfaces: int = 0
    modules: int = 0
    vrfs: int = 0
    neighbors: int = 0
    device: IpMplsDeviceRead


class IpMplsTopologyNode(BaseModel):
    id: str
    name: str
    kind: str  # "device" | "external"
    role: Optional[str] = None
    platform: Optional[str] = None
    site: Optional[str] = None
    device_id: Optional[UUID] = None


class IpMplsTopologyLink(BaseModel):
    source: str
    target: str
    protocol: str
    interfaces: List[str] = Field(default_factory=list)
    count: int = 0
    # node_id -> local interface(s) that node uses for this adjacency.
    endpoint_interfaces: Dict[str, List[str]] = Field(default_factory=dict)


class IpMplsTopology(BaseModel):
    nodes: List[IpMplsTopologyNode] = Field(default_factory=list)
    links: List[IpMplsTopologyLink] = Field(default_factory=list)
    total_nodes: int
    total_links: int
    protocol: str


class IpMplsSummary(BaseModel):
    total: int
    total_interfaces: int
    total_vrfs: int
    unique_vrfs: int
    total_neighbors: int
    mpls_interfaces: int
    interfaces_up: int
    error_devices: int
    stale_devices: int
    by_platform: Dict[str, int]
    by_status: Dict[str, int]
    by_role: Dict[str, int]
    by_location: Dict[str, int]
    by_model: Dict[str, int]
    by_os: Dict[str, int]
    by_neighbor_protocol: Dict[str, int]
