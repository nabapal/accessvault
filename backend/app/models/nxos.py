from __future__ import annotations

import uuid
from enum import Enum as PyEnum

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.types import GUID


class NxosPlatform(str, PyEnum):
    NXOS = "nxos"
    UNKNOWN = "unknown"

    @classmethod
    def from_raw(cls, raw: str | None) -> "NxosPlatform":
        value = (raw or "").strip().lower()
        if value in {"nxos", "cisco_nxos", "nx-os", "nexus"}:
            return cls.NXOS
        return cls.UNKNOWN

    @property
    def netmiko_device_type(self) -> str:
        return "cisco_nxos"


class NxosDeviceStatus(str, PyEnum):
    PENDING = "pending"
    OK = "ok"
    ERROR = "error"


class NxosDevice(Base):
    __tablename__ = "nxos_devices"
    __table_args__ = (UniqueConstraint("mgmt_ip", name="uq_nxos_device_mgmt_ip"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    hostname = Column(String, nullable=True)
    mgmt_ip = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=22)
    platform = Column(Enum(NxosPlatform), nullable=False, default=NxosPlatform.UNKNOWN)
    # Free-text role sourced from Nautobot's device role (e.g. Nexus).
    role = Column(String, nullable=True)
    model = Column(String, nullable=True)
    serial = Column(String, nullable=True)
    os_version = Column(String, nullable=True)
    uptime_seconds = Column(Integer, nullable=True)
    uptime_text = Column(String, nullable=True)
    username = Column(String, nullable=True)
    password_secret = Column(LargeBinary, nullable=True)
    enable_secret = Column(LargeBinary, nullable=True)
    connection_params = Column(JSON, nullable=False, default=dict)
    description = Column(Text, nullable=True)
    site_name = Column(String, nullable=True)
    rack_location = Column(String, nullable=True)
    poll_interval_seconds = Column(Integer, nullable=False, default=900)
    status = Column(Enum(NxosDeviceStatus), nullable=False, default=NxosDeviceStatus.PENDING)
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    raw_facts = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    interfaces = relationship("NxosInterface", back_populates="device", cascade="all, delete-orphan")
    modules = relationship("NxosModule", back_populates="device", cascade="all, delete-orphan")
    vrfs = relationship("NxosVrf", back_populates="device", cascade="all, delete-orphan")
    neighbors = relationship("NxosNeighbor", back_populates="device", cascade="all, delete-orphan")
    bgp_neighbors = relationship("NxosBgpNeighbor", back_populates="device", cascade="all, delete-orphan")


class NxosInterface(Base):
    __tablename__ = "nxos_interfaces"
    __table_args__ = (UniqueConstraint("device_id", "name", name="uq_nxos_interface"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    admin_state = Column(String, nullable=True)
    oper_state = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    prefix_len = Column(Integer, nullable=True)
    vrf = Column(String, nullable=True)
    speed = Column(String, nullable=True)
    mtu = Column(Integer, nullable=True)
    mac = Column(String, nullable=True)
    mode = Column(String, nullable=True)  # access | trunk | routed
    access_vlan = Column(String, nullable=True)
    trunk_vlans = Column(String, nullable=True)
    port_channel = Column(String, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("NxosDevice", back_populates="interfaces")


class NxosModule(Base):
    __tablename__ = "nxos_modules"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=True)
    description = Column(String, nullable=True)
    pid = Column(String, nullable=True)
    vid = Column(String, nullable=True)
    serial = Column(String, nullable=True)
    slot = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("NxosDevice", back_populates="modules")


class NxosVrf(Base):
    __tablename__ = "nxos_vrfs"
    __table_args__ = (UniqueConstraint("device_id", "name", name="uq_nxos_vrf"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    rd = Column(String, nullable=True)
    state = Column(String, nullable=True)
    interfaces = Column(JSON, nullable=False, default=list)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("NxosDevice", back_populates="vrfs")


class NxosNeighbor(Base):
    """Layer-2 discovery adjacency (CDP / LLDP) used to build topology."""

    __tablename__ = "nxos_neighbors"
    __table_args__ = (
        UniqueConstraint(
            "device_id", "protocol", "local_interface", "remote_device", "remote_interface",
            name="uq_nxos_neighbor",
        ),
    )

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    protocol = Column(String, nullable=False)  # cdp | lldp
    local_interface = Column(String, nullable=True)
    remote_device = Column(String, nullable=True)
    remote_interface = Column(String, nullable=True)
    remote_platform = Column(String, nullable=True)
    remote_mgmt_ip = Column(String, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("NxosDevice", back_populates="neighbors")


class NxosBgpNeighbor(Base):
    """BGP neighbor detail (per VRF / address-family)."""

    __tablename__ = "nxos_bgp_neighbors"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("nxos_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    vrf = Column(String, nullable=True)
    address_family = Column(String, nullable=True)
    neighbor_ip = Column(String, nullable=False)
    remote_as = Column(String, nullable=True)
    local_as = Column(String, nullable=True)
    state = Column(String, nullable=True)
    prefixes_received = Column(Integer, nullable=True)
    prefixes_sent = Column(Integer, nullable=True)
    uptime = Column(String, nullable=True)
    description = Column(String, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("NxosDevice", back_populates="bgp_neighbors")
