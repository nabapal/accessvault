from __future__ import annotations

import uuid
from enum import Enum as PyEnum

from sqlalchemy import (
    Boolean,
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


class IpMplsPlatform(str, PyEnum):
    IOSXE = "iosxe"
    IOSXR = "iosxr"
    UNKNOWN = "unknown"

    @classmethod
    def from_raw(cls, raw: str | None) -> "IpMplsPlatform":
        value = (raw or "").strip().lower()
        if value in {"iosxr", "xr", "cisco_xr"}:
            return cls.IOSXR
        if value in {"iosxe", "xe", "ios", "cisco_xe", "cisco_ios"}:
            return cls.IOSXE
        return cls.UNKNOWN

    @property
    def netmiko_device_type(self) -> str:
        return {"iosxr": "cisco_xr", "iosxe": "cisco_xe"}.get(self.value, "cisco_ios")


class IpMplsDeviceStatus(str, PyEnum):
    PENDING = "pending"
    OK = "ok"
    ERROR = "error"


class IpMplsDeviceRole(str, PyEnum):
    PE = "pe"
    P = "p"
    RR = "rr"
    CE = "ce"
    UNKNOWN = "unknown"


class IpMplsDevice(Base):
    __tablename__ = "ip_mpls_devices"
    __table_args__ = (UniqueConstraint("mgmt_ip", name="uq_ipmpls_device_mgmt_ip"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    hostname = Column(String, nullable=True)
    mgmt_ip = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=22)
    platform = Column(Enum(IpMplsPlatform), nullable=False, default=IpMplsPlatform.UNKNOWN)
    role = Column(Enum(IpMplsDeviceRole), nullable=False, default=IpMplsDeviceRole.UNKNOWN)
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
    status = Column(Enum(IpMplsDeviceStatus), nullable=False, default=IpMplsDeviceStatus.PENDING)
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    raw_facts = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    interfaces = relationship("IpMplsInterface", back_populates="device", cascade="all, delete-orphan")
    modules = relationship("IpMplsModule", back_populates="device", cascade="all, delete-orphan")


class IpMplsInterface(Base):
    __tablename__ = "ip_mpls_interfaces"
    __table_args__ = (UniqueConstraint("device_id", "name", name="uq_ipmpls_interface"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("ip_mpls_devices.id", ondelete="CASCADE"), nullable=False, index=True)
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
    mpls_enabled = Column(Boolean, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("IpMplsDevice", back_populates="interfaces")


class IpMplsModule(Base):
    __tablename__ = "ip_mpls_modules"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    device_id = Column(GUID(), ForeignKey("ip_mpls_devices.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=True)
    description = Column(String, nullable=True)
    pid = Column(String, nullable=True)
    vid = Column(String, nullable=True)
    serial = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    device = relationship("IpMplsDevice", back_populates="modules")
