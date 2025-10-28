from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum as PyEnum
from typing import Any, Dict

from sqlalchemy import Boolean, Column, DateTime, Enum, JSON, String, Text, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.types import GUID


class AciNodeRole(str, PyEnum):
    LEAF = "leaf"
    SPINE = "spine"
    CONTROLLER = "controller"
    UNSPECIFIED = "unspecified"

    @classmethod
    def from_raw(cls, raw: str | None) -> "AciNodeRole":
        if not raw:
            return cls.UNSPECIFIED
        value = raw.strip().lower()
        if value in {"leaf", "tier-2-leaf"}:
            return cls.LEAF
        if value == "spine":
            return cls.SPINE
        if value in {"controller", "apic"}:
            return cls.CONTROLLER
        return cls.UNSPECIFIED


class AciFabricNode(Base):
    __tablename__ = "aci_fabric_nodes"
    __table_args__ = (UniqueConstraint("fabric_job_id", "distinguished_name", name="uq_aci_fabric_node_job_dn"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    distinguished_name = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(Enum(AciNodeRole), nullable=False, default=AciNodeRole.UNSPECIFIED)
    node_id = Column(String, nullable=False)
    address = Column(String, nullable=True)
    serial = Column(String, nullable=True)
    model = Column(String, nullable=True)
    version = Column(String, nullable=True)
    vendor = Column(String, nullable=True)
    node_type = Column(String, nullable=True)
    apic_type = Column(String, nullable=True)
    fabric_state = Column(String, nullable=True)
    admin_state = Column(String, nullable=True)
    delayed_heartbeat = Column(Boolean, nullable=False, default=False)
    pod = Column(String, nullable=True)
    fabric_job_id = Column(GUID(), ForeignKey("telco_fabric_onboarding_jobs.id"), nullable=True)
    raw_attributes = Column(JSON, nullable=False, default=dict)
    last_state_change_at = Column(DateTime(timezone=True), nullable=True)
    last_modified_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    fabric_job = relationship("TelcoFabricOnboardingJob", lazy="selectin")

    def update_from_attributes(self, attributes: Dict[str, Any]) -> None:
        self.name = attributes.get("name", self.name)
        self.node_id = attributes.get("id", self.node_id)
        self.address = attributes.get("address")
        self.serial = attributes.get("serial")
        self.model = attributes.get("model")
        self.version = attributes.get("version")
        self.vendor = attributes.get("vendor")
        self.node_type = attributes.get("nodeType")
        self.apic_type = attributes.get("apicType")
        self.fabric_state = attributes.get("fabricSt")
        self.admin_state = attributes.get("adSt")
        delayed = attributes.get("delayedHeartbeat")
        if delayed is not None:
            self.delayed_heartbeat = str(delayed).strip().lower() in {"yes", "true", "1"}
        role_value = attributes.get("role")
        if role_value:
            self.role = AciNodeRole.from_raw(role_value)
        dn_value = attributes.get("dn")
        if dn_value:
            self.distinguished_name = dn_value
            if "pod-" in dn_value:
                # Example DN: topology/pod-1/node-120
                parts = dn_value.split("/")
                for part in parts:
                    if part.startswith("pod-"):
                        self.pod = part
                        break
        last_state_ts = attributes.get("lastStateModTs")
        if isinstance(last_state_ts, str) and last_state_ts:
            self.last_state_change_at = _parse_timestamp(last_state_ts)
        mod_ts = attributes.get("modTs")
        if isinstance(mod_ts, str) and mod_ts:
            self.last_modified_at = _parse_timestamp(mod_ts)
        self.raw_attributes = attributes

    @property
    def fabric_name(self) -> str | None:
        if self.fabric_job is None:
            return None
        return self.fabric_job.name

    @property
    def fabric_ip(self) -> str | None:
        if self.fabric_job is None:
            return None
        return self.fabric_job.target_host


def _parse_timestamp(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
