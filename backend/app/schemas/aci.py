from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.aci import AciNodeRole


class AciFabricNodeRead(BaseModel):
    id: UUID
    distinguished_name: str
    name: str
    role: AciNodeRole
    node_id: str
    address: str | None
    serial: str | None
    model: str | None
    version: str | None
    vendor: str | None
    node_type: str | None
    apic_type: str | None
    fabric_state: str | None
    admin_state: str | None
    delayed_heartbeat: bool
    pod: str | None
    site_name: str | None = None
    rack_location: str | None = None
    fabric_job_id: UUID | None = None
    fabric_name: str | None = None
    fabric_ip: str | None = None
    last_state_change_at: datetime | None
    last_modified_at: datetime | None
    raw_attributes: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AciFabricNodeSummary(BaseModel):
    total: int
    leaf_count: int
    spine_count: int
    controller_count: int
    unspecified_count: int
    delayed_heartbeat: int
    by_fabric_state: Dict[str, int]
    by_version: Dict[str, int]


class AciFabricNodePage(BaseModel):
    items: list[AciFabricNodeRead]
    total: int
    page: int
    page_size: int
    has_next: bool
    has_prev: bool


class AciFabricSummaryFabric(BaseModel):
    fabric_job_id: UUID | None = None
    fabric_name: str
    fabric_ip: str | None = None
    total_nodes: int
    delayed_heartbeat: int
    by_role: Dict[str, int]
    by_model: Dict[str, int]
    by_version: Dict[str, int]
    by_fabric_state: Dict[str, int]
    last_polled_at: datetime | None = None


class AciFabricSummaryDetails(BaseModel):
    total_nodes: int
    total_fabrics: int
    fabrics: list[AciFabricSummaryFabric]
    available_roles: list[str]
    available_models: list[str]
    available_versions: list[str]
    available_fabric_states: list[str]


class AciFabricNodeHealthSample(BaseModel):
    window: str
    health_last: float | None = None
    health_avg: float | None = None
    health_max: float | None = None
    health_min: float | None = None
    sample_start: datetime | None = None
    sample_end: datetime | None = None


class AciFabricNodeHealth(BaseModel):
    samples: List[AciFabricNodeHealthSample] = Field(default_factory=list)


class AciFabricNodeCpuStats(BaseModel):
    usage_pct: float | None = None
    idle_pct: float | None = None
    user_pct: float | None = None
    kernel_pct: float | None = None
    sample_start: datetime | None = None
    sample_end: datetime | None = None


class AciFabricNodeMemoryStats(BaseModel):
    total_kb: int | None = None
    used_kb: int | None = None
    free_kb: int | None = None
    usage_pct: float | None = None
    sample_start: datetime | None = None
    sample_end: datetime | None = None


class AciFabricNodeResources(BaseModel):
    cpu: AciFabricNodeCpuStats | None = None
    memory: AciFabricNodeMemoryStats | None = None


class AciFabricNodeTempSensor(BaseModel):
    name: str
    value_celsius: float | None = None
    normalized_value: float | None = None
    distinguished_name: str | None = None


class AciFabricNodeFan(BaseModel):
    name: str
    direction: str | None = None
    model: str | None = None
    vendor: str | None = None
    status: str | None = None
    distinguished_name: str | None = None


class AciFabricNodeEnvironment(BaseModel):
    temperatures: List[AciFabricNodeTempSensor] = Field(default_factory=list)
    fans: List[AciFabricNodeFan] = Field(default_factory=list)
    power_supplies: List[Dict[str, Any]] = Field(default_factory=list)


class AciFabricNodeFirmware(BaseModel):
    version: str | None = None
    description: str | None = None
    pe_version: str | None = None
    bios_version: str | None = None
    bios_timestamp: datetime | None = None
    kickstart_image: str | None = None
    system_image: str | None = None
    last_boot: datetime | None = None


class AciFabricNodePortChannelMember(BaseModel):
    name: str
    distinguished_name: str | None = None


class AciFabricNodePortChannel(BaseModel):
    port_channel_id: str
    name: str | None = None
    admin_state: str | None = None
    oper_state: str | None = None
    usage: str | None = None
    speed: str | None = None
    active_ports: int | None = None
    members: List[AciFabricNodePortChannelMember] = Field(default_factory=list)


class AciFabricNodeGeneral(BaseModel):
    fabric_domain: str | None = None
    fabric_id: str | None = None
    pod_id: str | None = None
    address: str | None = None
    inband_address: str | None = None
    inband_gateway: str | None = None
    oob_address: str | None = None
    oob_gateway: str | None = None
    serial: str | None = None
    system_name: str | None = None
    uptime: str | None = None
    last_reboot_at: datetime | None = None
    last_reset_reason: str | None = None
    current_time: datetime | None = None
    mode: str | None = None


class AciFabricNodeDetailRead(BaseModel):
    node: AciFabricNodeRead
    collected_at: datetime | None = None
    general: AciFabricNodeGeneral = Field(default_factory=AciFabricNodeGeneral)
    health: AciFabricNodeHealth = Field(default_factory=AciFabricNodeHealth)
    resources: AciFabricNodeResources = Field(default_factory=AciFabricNodeResources)
    environment: AciFabricNodeEnvironment = Field(default_factory=AciFabricNodeEnvironment)
    firmware: AciFabricNodeFirmware | None = None
    port_channels: List[AciFabricNodePortChannel] = Field(default_factory=list)


class AciFabricNodeInterfaceRead(BaseModel):
    id: UUID
    node_id: UUID
    name: str
    distinguished_name: str
    description: str | None = None
    admin_state: str | None = None
    oper_state: str | None = None
    oper_speed: str | None = None
    usage: str | None = None
    last_link_change_at: datetime | None = None
    mtu: int | None = None
    fec_mode: str | None = None
    duplex: str | None = None
    mac: str | None = None
    port_type: str | None = None
    bundle_id: str | None = None
    port_channel_id: str | None = None
    port_channel_name: str | None = None
    vlan_list: str | None = None
    epg_bindings: List[Dict[str, Any]] = Field(default_factory=list)
    l3out_bindings: List[Dict[str, Any]] = Field(default_factory=list)
    attributes: Dict[str, Any] = Field(default_factory=dict)
    transceiver: Dict[str, Any] = Field(default_factory=dict)
    stats: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True