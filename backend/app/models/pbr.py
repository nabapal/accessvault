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
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.types import GUID


class PbrLayer(str, PyEnum):
    """Service-graph node insertion layer."""

    L1 = "L1"  # transparent (L1/L2) — no trustworthy real-time health in this env
    L3 = "L3"  # routed redirect (has redirect destinations + live endpoint check)
    UNKNOWN = "unknown"

    @classmethod
    def from_raw(cls, raw: str | None) -> "PbrLayer":
        if not raw:
            return cls.UNKNOWN
        value = raw.strip().lower()
        if value in {"l1", "l2", "l1l2", "l1-l2", "go-to", "gothrough", "transparent"}:
            return cls.L1
        if value in {"l3", "routed", "go-to-l3"}:
            return cls.L3
        return cls.UNKNOWN


class PbrThresholdAction(str, PyEnum):
    """`thresholdDownAction` on vnsSvcRedirectPol. THREE distinct outcomes — see SDD §9.3.

    bypass and permit are NOT the same; conflating them (as the v19 prototype's
    nodeBypassState still does) inflated a real 0%-active node to a fake 100% score.
    """

    BYPASS = "bypass"  # graceful: traffic routed around the node (functioning as designed)
    PERMIT = "permit"  # informational: traffic still permitted, but NOT the graceful skip
    DENY = "deny"      # genuine outage: traffic dropped
    UNKNOWN = "unknown"

    @classmethod
    def from_raw(cls, raw: str | None) -> "PbrThresholdAction":
        if not raw:
            return cls.UNKNOWN
        value = raw.strip().lower()
        if value == "bypass":
            return cls.BYPASS
        if value == "permit":
            return cls.PERMIT
        if value in {"deny", "drop"}:
            return cls.DENY
        return cls.UNKNOWN


class PbrNodeStatus(str, PyEnum):
    """Computed live status of a service-graph node."""

    LIVE = "live"          # healthy, carrying traffic
    FAULTY = "faulty"      # real fault / outage (incl. threshold-breach + deny)
    BYPASSED = "bypassed"  # threshold-breach + bypass (by design)
    PERMIT = "permit"      # threshold-breach + permit (informational, distinct from bypass)
    UNKNOWN = "unknown"


class PbrServiceState(str, PyEnum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"  # "warning" band in the prototype
    DOWN = "down"          # "failed" band
    UNKNOWN = "unknown"


class PbrService(Base):
    """A real PBR service = a (contract, graph) pair present in BOTH vnsGraphInst AND
    vnsLDevCtx (intersection rule, SDD §7.3.1). Never the union."""

    __tablename__ = "pbr_services"
    __table_args__ = (
        UniqueConstraint("fabric_job_id", "contract_dn", "graph_dn", name="uq_pbr_service_job_contract_graph"),
    )

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    fabric_job_id = Column(
        GUID(), ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )

    contract_dn = Column(String, nullable=False)
    graph_dn = Column(String, nullable=False)
    contract_name = Column(String, nullable=True)
    graph_name = Column(String, nullable=True)

    consumer_epg_dn = Column(String, nullable=True)
    provider_epg_dn = Column(String, nullable=True)
    consumer_epg_name = Column(String, nullable=True)
    provider_epg_name = Column(String, nullable=True)

    health_pct = Column(Float, nullable=True)
    state = Column(Enum(PbrServiceState), nullable=False, default=PbrServiceState.UNKNOWN)

    # Per-side external EPG groups with their subnet chips (matches the prototype's
    # consumer_l3out_epg / provider_l3out_epg): list of
    #   {l3out, epg, subnets[], excluded_subnets[], default_v4, default_v6}
    consumer_epgs = Column(JSON, nullable=False, default=list)
    provider_epgs = Column(JSON, nullable=False, default=list)

    # Last APIC poll this service was refreshed from (stale-safety, SDD §10.4).
    stale_as_of = Column(DateTime(timezone=True), nullable=True)
    raw_attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    nodes = relationship("PbrNode", back_populates="service", cascade="all, delete-orphan")
    subnets = relationship("PbrSubnet", back_populates="service", cascade="all, delete-orphan")
    health_samples = relationship("PbrHealthSample", back_populates="service", cascade="all, delete-orphan")


class PbrNode(Base):
    """One service-graph function node in a service path."""

    __tablename__ = "pbr_nodes"
    __table_args__ = (
        UniqueConstraint("service_id", "distinguished_name", name="uq_pbr_node_service_dn"),
    )

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    fabric_job_id = Column(
        GUID(), ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_id = Column(GUID(), ForeignKey("pbr_services.id", ondelete="CASCADE"), nullable=False, index=True)

    distinguished_name = Column(String, nullable=False)
    name = Column(String, nullable=True)
    function_type = Column(String, nullable=True)
    layer = Column(Enum(PbrLayer), nullable=False, default=PbrLayer.UNKNOWN)

    device_group_dn = Column(String, nullable=True, index=True)  # blast-radius join key
    device_group_name = Column(String, nullable=True)
    leaf = Column(String, nullable=True)
    path = Column(String, nullable=True)

    # Per-side BD/VRF/VLAN — consumer and provider can LEGITIMATELY differ
    # (e.g. an L1 transparent hop feeding an L3 hop). SDD §7.3.2.
    consumer_bd = Column(String, nullable=True)
    consumer_vrf = Column(String, nullable=True)
    consumer_vlan = Column(String, nullable=True)
    provider_bd = Column(String, nullable=True)
    provider_vrf = Column(String, nullable=True)
    provider_vlan = Column(String, nullable=True)

    redirect_policy_names = Column(JSON, nullable=False, default=list)

    # Threshold config pulled from vnsSvcRedirectPol — REAL per-policy values, never defaulted.
    threshold_enable = Column(Boolean, nullable=False, default=False)
    min_threshold_pct = Column(Float, nullable=True)
    max_threshold_pct = Column(Float, nullable=True)
    threshold_down_action = Column(Enum(PbrThresholdAction), nullable=False, default=PbrThresholdAction.UNKNOWN)

    # Computed (compute layer).
    configured_dest_count = Column(Integer, nullable=False, default=0)
    learned_dest_count = Column(Integer, nullable=False, default=0)
    health_pct = Column(Float, nullable=True)
    live_status = Column(Enum(PbrNodeStatus), nullable=False, default=PbrNodeStatus.UNKNOWN)
    bypassed = Column(Boolean, nullable=False, default=False)
    active_pct = Column(Float, nullable=True)

    # Full per-node detail for the topology + node cards (matches the prototype node
    # schema): leafs[], per-side bd/vrf/l3out/lif_encap/redirect_policy, redirect_dests[]
    # (ip/configured_mac/learned_mac/active), redirect_interfaces{}, threshold{}.
    detail = Column(JSON, nullable=False, default=dict)

    raw_attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    service = relationship("PbrService", back_populates="nodes")
    redirect_dests = relationship("PbrRedirectDest", back_populates="node", cascade="all, delete-orphan")


class PbrRedirectDest(Base):
    """A redirect destination (vnsRedirectDest L3, or vnsL1L2RedirectDest L1)."""

    __tablename__ = "pbr_redirect_dests"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    node_id = Column(GUID(), ForeignKey("pbr_nodes.id", ondelete="CASCADE"), nullable=False, index=True)

    ip = Column(String, nullable=True)
    mac = Column(String, nullable=True)
    layer = Column(Enum(PbrLayer), nullable=False, default=PbrLayer.UNKNOWN)
    l1_interface_ref = Column(String, nullable=True)  # vnsRsToCIf target DN, for L1 nodes

    resolved = Column(Boolean, nullable=False, default=False)  # L1: interface ref resolves
    learned = Column(Boolean, nullable=False, default=False)   # L3: present in fvIp (live)

    raw_attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    node = relationship("PbrNode", back_populates="redirect_dests")


class PbrSubnet(Base):
    """An l3extSubnet used for IP-flow classification. Only scope_valid subnets
    (scope contains import-security) may resolve a flow (SDD §7.3.3, §5.3)."""

    __tablename__ = "pbr_subnets"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    fabric_job_id = Column(
        GUID(), ForeignKey("telco_fabric_onboarding_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_id = Column(GUID(), ForeignKey("pbr_services.id", ondelete="CASCADE"), nullable=True, index=True)

    epg_dn = Column(String, nullable=True)
    # Which side of the contract this subnet belongs to (consumer/provider) — needed
    # for the default-route "same contract opposite side" rule (SDD §5.3).
    side = Column(String, nullable=True)
    prefix = Column(String, nullable=False)  # CIDR, e.g. 10.0.0.0/22
    scope = Column(String, nullable=True)    # raw scope attribute
    scope_valid = Column(Boolean, nullable=False, default=False)  # contains import-security
    is_default_route = Column(Boolean, nullable=False, default=False)

    raw_attributes = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    service = relationship("PbrService", back_populates="subnets")


class PbrHealthSample(Base):
    """Durable trend history (Phase 4) — replaces the prototype's localStorage."""

    __tablename__ = "pbr_health_samples"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    service_id = Column(GUID(), ForeignKey("pbr_services.id", ondelete="CASCADE"), nullable=False, index=True)
    sampled_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    health_pct = Column(Float, nullable=True)
    state = Column(Enum(PbrServiceState), nullable=False, default=PbrServiceState.UNKNOWN)
    node_snapshot = Column(JSON, nullable=True)  # per-node health at sample time

    service = relationship("PbrService", back_populates="health_samples")
