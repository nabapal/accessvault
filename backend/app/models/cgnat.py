from __future__ import annotations

import uuid
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
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


class CgnatVendor(str, PyEnum):
    A10 = "a10"
    F5 = "f5"
    UNKNOWN = "unknown"

    @classmethod
    def from_raw(cls, raw: str | None) -> "CgnatVendor":
        value = (raw or "").strip().lower()
        if value in {"a10", "a10networks", "thunder", "acos"}:
            return cls.A10
        if value in {"f5", "bigip", "big-ip", "f5networks"}:
            return cls.F5
        return cls.UNKNOWN


class CgnatDeviceStatus(str, PyEnum):
    PENDING = "pending"
    OK = "ok"
    ERROR = "error"


class CgnatDevice(Base):
    __tablename__ = "cgnat_devices"
    __table_args__ = (UniqueConstraint("mgmt_ip", name="uq_cgnat_device_mgmt_ip"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    hostname = Column(String, nullable=True)
    mgmt_ip = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=443)
    vendor = Column(Enum(CgnatVendor), nullable=False, default=CgnatVendor.UNKNOWN)
    verify_ssl = Column(Boolean, nullable=False, default=False)
    role = Column(String, nullable=True)
    model = Column(String, nullable=True)
    serial = Column(String, nullable=True)
    os_version = Column(String, nullable=True)
    uptime_seconds = Column(Integer, nullable=True)
    uptime_text = Column(String, nullable=True)
    username = Column(String, nullable=True)
    password_secret = Column(LargeBinary, nullable=True)
    connection_params = Column(JSON, nullable=False, default=dict)
    description = Column(Text, nullable=True)
    site_name = Column(String, nullable=True)
    rack_location = Column(String, nullable=True)
    poll_interval_seconds = Column(Integer, nullable=False, default=900)
    status = Column(Enum(CgnatDeviceStatus), nullable=False, default=CgnatDeviceStatus.PENDING)
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    # First-class CGNAT health metrics (device-level rollup).
    active_sessions = Column(Integer, nullable=True)
    active_subscribers = Column(Integer, nullable=True)
    total_translations = Column(Integer, nullable=True)
    port_util_pct = Column(Float, nullable=True)
    exhaustion_events = Column(Integer, nullable=True)
    virtual_server_count = Column(Integer, nullable=True)  # F5 context only
    raw_facts = Column(JSON, nullable=False, default=dict)  # incl. raw stat blob
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    interfaces = relationship("CgnatInterface", back_populates="device", cascade="all, delete-orphan")
    pools = relationship("CgnatNatPool", back_populates="device", cascade="all, delete-orphan")
    routes = relationship("CgnatStaticRoute", back_populates="device", cascade="all, delete-orphan")


class CgnatInterface(Base):
    __tablename__ = "cgnat_interfaces"
    __table_args__ = (UniqueConstraint("device_id", "name", name="uq_cgnat_interface"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("cgnat_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    admin_state = Column(String, nullable=True)
    oper_state = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    vlan = Column(String, nullable=True)
    mtu = Column(Integer, nullable=True)
    mac = Column(String, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("CgnatDevice", back_populates="interfaces")


class CgnatNatPool(Base):
    """Unified NAT / LSN pool across A10 (cgnv6 nat pool) and F5 (ltm lsn-pool)."""

    __tablename__ = "cgnat_nat_pools"
    __table_args__ = (UniqueConstraint("device_id", "pool_name", name="uq_cgnat_pool"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("cgnat_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    pool_name = Column(String, nullable=False)
    kind = Column(String, nullable=True)  # nat | lsn
    mode = Column(String, nullable=True)  # napt | deterministic | pba | ...
    partition = Column(String, nullable=True)
    route_domain = Column(String, nullable=True)
    start_address = Column(String, nullable=True)
    end_address = Column(String, nullable=True)
    prefix = Column(String, nullable=True)
    port_block_size = Column(Integer, nullable=True)
    log_profile = Column(String, nullable=True)
    pool_group = Column(String, nullable=True)
    # Per-pool metrics (F5 exposes per-pool; A10 is device-global -> null here).
    active_translations = Column(Integer, nullable=True)
    translation_requests = Column(Integer, nullable=True)
    translation_failures = Column(Integer, nullable=True)
    port_util_pct = Column(Float, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("CgnatDevice", back_populates="pools")


class CgnatStaticRoute(Base):
    """Static route from A10 (ip/ipv6 route rib) or F5 (net/route)."""

    __tablename__ = "cgnat_static_routes"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("cgnat_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=True)
    destination = Column(String, nullable=True)  # dest + prefix (may carry %route-domain on F5)
    next_hop = Column(String, nullable=True)
    distance = Column(Integer, nullable=True)
    route_domain = Column(String, nullable=True)
    family = Column(String, nullable=True)  # ipv4 | ipv6
    description = Column(String, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("CgnatDevice", back_populates="routes")
