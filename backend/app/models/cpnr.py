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


class CpnrRole(str, PyEnum):
    PRIMARY = "primary"
    SECONDARY = "secondary"
    LOCAL = "local"


class CpnrStatus(str, PyEnum):
    PENDING = "pending"
    OK = "ok"
    ERROR = "error"


class CpnrPairStatus(str, PyEnum):
    SINGLE = "single"      # no pair (local / standalone)
    UNKNOWN = "unknown"    # pair not yet compared
    IN_SYNC = "in_sync"
    DRIFT = "drift"


# The six DHCP object types collected per VM (requirement 2).
CPNR_OBJECT_TYPES = (
    "scope",
    "prefix",
    "reservation4",
    "reservation6",
    "client_entry",
    "client_class",
)


class CpnrVm(Base):
    __tablename__ = "cpnr_vms"
    __table_args__ = (UniqueConstraint("mgmt_ip", name="uq_cpnr_vm_mgmt_ip"),)

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    site = Column(String, nullable=True)          # Bangalore / Mumbai / ...
    service = Column(String, nullable=True)        # Utility / FTTx / WIFI / A6 / ...
    role = Column(Enum(CpnrRole), nullable=False, default=CpnrRole.LOCAL)
    pair_id = Column(String, nullable=True, index=True)  # links primary+secondary
    mgmt_ip = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=8443)
    verify_ssl = Column(Integer, nullable=False, default=0)  # bool as int for sqlite parity
    username = Column(String, nullable=True)
    password_secret = Column(LargeBinary, nullable=True)
    version = Column(String, nullable=True)
    cluster_role = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    poll_interval_seconds = Column(Integer, nullable=False, default=900)
    status = Column(Enum(CpnrStatus), nullable=False, default=CpnrStatus.PENDING)
    last_polled_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    # per-object counts (rollup)
    scope_count = Column(Integer, nullable=True)
    prefix_count = Column(Integer, nullable=True)
    reservation4_count = Column(Integer, nullable=True)
    reservation6_count = Column(Integer, nullable=True)
    client_count = Column(Integer, nullable=True)
    client_class_count = Column(Integer, nullable=True)
    # pair-consistency rollup (requirement 3/4)
    pair_status = Column(Enum(CpnrPairStatus), nullable=False, default=CpnrPairStatus.SINGLE)
    inconsistency_count = Column(Integer, nullable=True)
    last_compared_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    objects = relationship("CpnrObject", back_populates="vm", cascade="all, delete-orphan")
    change_events = relationship("CpnrChangeEvent", back_populates="vm", cascade="all, delete-orphan")


class CpnrObject(Base):
    """A single DHCP config object of any of the six types, per VM.

    Uniform storage: object_type discriminator + business key + normalized data
    (objectOid stripped) + content_hash for value-diff / change detection.
    """

    __tablename__ = "cpnr_objects"
    __table_args__ = (
        UniqueConstraint("vm_id", "object_type", "object_key", name="uq_cpnr_object"),
    )

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    vm_id = Column(GUID(), ForeignKey("cpnr_vms.id", ondelete="CASCADE"), nullable=False, index=True)
    object_type = Column(String, nullable=False, index=True)  # one of CPNR_OBJECT_TYPES
    object_key = Column(String, nullable=False)               # business key (name/ipaddr/ip6Address)
    content_hash = Column(String, nullable=False)             # hash of normalized data (OID-excluded)
    data = Column(JSON, nullable=False, default=dict)         # normalized object fields
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    vm = relationship("CpnrVm", back_populates="objects")


class CpnrChangeEvent(Base):
    """Timestamped config change per VM (requirement 6)."""

    __tablename__ = "cpnr_change_events"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    vm_id = Column(GUID(), ForeignKey("cpnr_vms.id", ondelete="CASCADE"), nullable=False, index=True)
    ts = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    object_type = Column(String, nullable=False)
    object_key = Column(String, nullable=False)
    action = Column(String, nullable=False)  # added | modified | removed
    changes = Column(JSON, nullable=True)     # [{field, old, new}, ...] for modified
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    vm = relationship("CpnrVm", back_populates="change_events")
