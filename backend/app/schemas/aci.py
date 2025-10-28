from __future__ import annotations

from datetime import datetime
from typing import Any, Dict
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