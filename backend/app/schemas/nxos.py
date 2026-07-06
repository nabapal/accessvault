from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.nxos import NxosDeviceStatus, NxosPlatform


class NxosDeviceBase(BaseModel):
    name: str
    mgmt_ip: str
    port: int = 22
    platform: NxosPlatform = NxosPlatform.NXOS
    role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: int = 900
    connection_params: Dict[str, Any] = Field(default_factory=dict)


class NxosDeviceCreate(NxosDeviceBase):
    username: str
    password: str
    enable: Optional[str] = None


class NxosDeviceUpdate(BaseModel):
    name: Optional[str] = None
    mgmt_ip: Optional[str] = None
    port: Optional[int] = None
    platform: Optional[NxosPlatform] = None
    role: Optional[str] = None
    description: Optional[str] = None
    poll_interval_seconds: Optional[int] = None
    connection_params: Optional[Dict[str, Any]] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enable: Optional[str] = None


class NxosDeviceRead(BaseModel):
    id: UUID
    name: str
    hostname: Optional[str] = None
    mgmt_ip: str
    port: int
    platform: NxosPlatform
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
    status: NxosDeviceStatus
    last_polled_at: Optional[datetime] = None
    last_error: Optional[str] = None
    username: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NxosInterfaceRead(BaseModel):
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
    mode: Optional[str] = None
    access_vlan: Optional[str] = None
    trunk_vlans: Optional[str] = None
    port_channel: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class NxosModuleRead(BaseModel):
    id: UUID
    device_id: UUID
    name: Optional[str] = None
    description: Optional[str] = None
    pid: Optional[str] = None
    vid: Optional[str] = None
    serial: Optional[str] = None
    slot: Optional[str] = None

    class Config:
        from_attributes = True


class NxosVrfRead(BaseModel):
    id: UUID
    device_id: UUID
    name: str
    rd: Optional[str] = None
    state: Optional[str] = None
    interfaces: List[str] = Field(default_factory=list)
    attributes: dict = Field(default_factory=dict)

    class Config:
        from_attributes = True


class NxosNeighborRead(BaseModel):
    id: UUID
    device_id: UUID
    protocol: str
    local_interface: Optional[str] = None
    remote_device: Optional[str] = None
    remote_interface: Optional[str] = None
    remote_platform: Optional[str] = None
    remote_mgmt_ip: Optional[str] = None
    attributes: dict = Field(default_factory=dict)

    class Config:
        from_attributes = True


class NxosBgpNeighborRead(BaseModel):
    id: UUID
    device_id: UUID
    vrf: Optional[str] = None
    address_family: Optional[str] = None
    neighbor_ip: str
    remote_as: Optional[str] = None
    local_as: Optional[str] = None
    state: Optional[str] = None
    prefixes_received: Optional[int] = None
    prefixes_sent: Optional[int] = None
    uptime: Optional[str] = None
    description: Optional[str] = None
    attributes: dict = Field(default_factory=dict)

    class Config:
        from_attributes = True


class NxosDevicePage(BaseModel):
    items: List[NxosDeviceRead]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class NxosSyncResult(BaseModel):
    success: bool
    message: Optional[str] = None
    interfaces: int = 0
    modules: int = 0
    vrfs: int = 0
    neighbors: int = 0
    bgp_neighbors: int = 0
    device: NxosDeviceRead


class NxosTopologyNode(BaseModel):
    id: str
    name: str
    kind: str  # "device" | "external"
    role: Optional[str] = None
    platform: Optional[str] = None
    site: Optional[str] = None
    device_id: Optional[UUID] = None


class NxosTopologyLink(BaseModel):
    source: str
    target: str
    interfaces: List[str] = Field(default_factory=list)
    count: int = 0
    # protocols that discovered this adjacency: e.g. ["cdp","lldp"]
    discovered_by: List[str] = Field(default_factory=list)
    # node_id -> local interface(s) that node uses for this adjacency.
    endpoint_interfaces: Dict[str, List[str]] = Field(default_factory=dict)


class NxosTopology(BaseModel):
    nodes: List[NxosTopologyNode] = Field(default_factory=list)
    links: List[NxosTopologyLink] = Field(default_factory=list)
    total_nodes: int
    total_links: int


class NxosSummary(BaseModel):
    total: int
    total_interfaces: int
    interfaces_up: int
    total_vrfs: int
    unique_vrfs: int
    total_neighbors: int
    total_bgp_neighbors: int
    error_devices: int
    stale_devices: int
    by_platform: Dict[str, int]
    by_status: Dict[str, int]
    by_role: Dict[str, int]
    by_location: Dict[str, int]
    by_model: Dict[str, int]
    by_os: Dict[str, int]
    by_neighbor_protocol: Dict[str, int]
