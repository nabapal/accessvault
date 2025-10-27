import uuid
from enum import Enum as PyEnum

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, JSON, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.types import GUID


class InventoryEndpointType(str, PyEnum):
    ESXI = "esxi"
    VCENTER = "vcenter"


class InventoryEndpointStatus(str, PyEnum):
    NEVER = "never"
    OK = "ok"
    ERROR = "error"


class InventoryEndpoint(Base):
    __tablename__ = "inventory_endpoints"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    address = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=443)
    source_type = Column(Enum(InventoryEndpointType), nullable=False, default=InventoryEndpointType.ESXI)
    username = Column(String, nullable=False)
    password_secret = Column(LargeBinary, nullable=False)
    verify_ssl = Column(Boolean, nullable=False, default=False)
    poll_interval_seconds = Column(Integer, nullable=False, default=300)
    tags = Column(JSON, nullable=False, default=list)

    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_poll_status = Column(Enum(InventoryEndpointStatus), nullable=False, default=InventoryEndpointStatus.NEVER)
    last_error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    hosts = relationship("InventoryHost", back_populates="endpoint", cascade="all, delete-orphan")
    virtual_machines = relationship(
        "InventoryVirtualMachine", back_populates="endpoint", cascade="all, delete-orphan"
    )
    datastores = relationship(
        "InventoryDatastore", back_populates="endpoint", cascade="all, delete-orphan"
    )
    networks = relationship(
        "InventoryNetwork", back_populates="endpoint", cascade="all, delete-orphan"
    )


class InventoryHostConnectionState(str, PyEnum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    MAINTENANCE = "maintenance"


class InventoryPowerState(str, PyEnum):
    POWERED_ON = "powered_on"
    POWERED_OFF = "powered_off"
    SUSPENDED = "suspended"
    UNKNOWN = "unknown"


class InventoryHost(Base):
    __tablename__ = "inventory_hosts"
    __table_args__ = (UniqueConstraint("endpoint_id", "name", name="uq_inventory_host_endpoint_name"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    endpoint_id = Column(GUID(), ForeignKey("inventory_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    cluster = Column(String, nullable=True)
    hardware_model = Column(String, nullable=True)
    connection_state = Column(Enum(InventoryHostConnectionState), nullable=False, default=InventoryHostConnectionState.CONNECTED)
    power_state = Column(Enum(InventoryPowerState), nullable=False, default=InventoryPowerState.POWERED_ON)
    cpu_cores = Column(Integer, nullable=True)
    cpu_usage_mhz = Column(Integer, nullable=True)
    memory_total_mb = Column(Integer, nullable=True)
    memory_usage_mb = Column(Integer, nullable=True)
    uptime_seconds = Column(Integer, nullable=True)
    datastore_total_gb = Column(Float, nullable=True)
    datastore_free_gb = Column(Float, nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    endpoint = relationship("InventoryEndpoint", back_populates="hosts")
    virtual_machines = relationship(
        "InventoryVirtualMachine", back_populates="host", cascade="all, delete-orphan"
    )


class InventoryVirtualMachine(Base):
    __tablename__ = "inventory_virtual_machines"
    __table_args__ = (UniqueConstraint("endpoint_id", "name", name="uq_inventory_vm_endpoint_name"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    endpoint_id = Column(GUID(), ForeignKey("inventory_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    host_id = Column(GUID(), ForeignKey("inventory_hosts.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(String, nullable=False)
    guest_os = Column(String, nullable=True)
    power_state = Column(Enum(InventoryPowerState), nullable=False, default=InventoryPowerState.POWERED_OFF)
    cpu_count = Column(Integer, nullable=True)
    memory_mb = Column(Integer, nullable=True)
    cpu_usage_mhz = Column(Integer, nullable=True)
    memory_usage_mb = Column(Integer, nullable=True)
    provisioned_storage_gb = Column(Float, nullable=True)
    used_storage_gb = Column(Float, nullable=True)
    ip_address = Column(String, nullable=True)
    datastores = Column(JSON, nullable=False, default=list)
    networks = Column(JSON, nullable=False, default=list)
    tools_status = Column(String, nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    endpoint = relationship("InventoryEndpoint", back_populates="virtual_machines")
    host = relationship("InventoryHost", back_populates="virtual_machines")


class InventoryDatastore(Base):
    __tablename__ = "inventory_datastores"
    __table_args__ = (UniqueConstraint("endpoint_id", "name", name="uq_inventory_datastore_endpoint_name"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    endpoint_id = Column(GUID(), ForeignKey("inventory_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=True)
    capacity_gb = Column(Float, nullable=True)
    free_gb = Column(Float, nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    endpoint = relationship("InventoryEndpoint", back_populates="datastores")


class InventoryNetwork(Base):
    __tablename__ = "inventory_networks"
    __table_args__ = (UniqueConstraint("endpoint_id", "name", name="uq_inventory_network_endpoint_name"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    endpoint_id = Column(GUID(), ForeignKey("inventory_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    endpoint = relationship("InventoryEndpoint", back_populates="networks")
