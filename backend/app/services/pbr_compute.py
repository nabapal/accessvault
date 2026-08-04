"""Pure computation layer for PBR Flow Monitoring.

No I/O — deterministic functions over plain dataclasses so the edge cases from
SDD §9/§5.3 can be unit-tested without a DB or APIC. The collector and read API call in.

Ports the prototype's reference logic (NetverseAI_PBR_Flow_Console_19.html):
  computeServiceHealth (443), nodeHealthPct (880), nodeLiveStatus (894),
  nodeBypassState (858), computeBlastRadius (621), specificHits (743).

Encodes the three real bugs found + fixed (SDD §9):
  1. Threshold/bypass is THREE-way (bypass != permit != deny). NOTE: the v19 prototype's
     nodeBypassState still collapses `permit` into `bypass`; this layer follows the SDD's
     corrected three-way rule instead (SDD §9.3).
  2. L1 nodes have no trustworthy real-time health (operSt unreliable) — config-completeness only.
  3. (fetch-count verification lives in the collector, not here.)
"""
from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from typing import List, Optional, Sequence

from app.models.pbr import PbrLayer, PbrNodeStatus, PbrServiceState, PbrThresholdAction

# --------------------------------------------------------------------------- #
# Node health / threshold-bypass evaluation
# --------------------------------------------------------------------------- #


@dataclass
class NodeInput:
    """Everything needed to score one service-graph node."""

    layer: PbrLayer
    configured_dest_count: int = 0
    learned_dest_count: int = 0
    # Threshold config — REAL per-policy values from vnsSvcRedirectPol, never defaulted.
    threshold_enable: bool = False
    min_threshold_pct: Optional[float] = None
    threshold_down_action: PbrThresholdAction = PbrThresholdAction.UNKNOWN
    # L1 only: does the redirect interface reference (vnsRsToCIf) resolve?
    l1_interface_resolved: bool = False


@dataclass
class NodeHealth:
    health_pct: Optional[float]  # None => excluded from the service average (0 configured dests)
    live_status: PbrNodeStatus
    bypassed: bool
    breached: bool
    active_pct: Optional[float]  # the raw live active-destination % (before bypass override)


def active_destination_pct(node: NodeInput) -> Optional[float]:
    """Live active-destination percentage for an L3 node.

    None when there are zero configured destinations (can't divide; such a node is
    later excluded from the service average rather than counted as 0 — SDD §9.4 /
    prototype computeServiceHealth's `if(!dests.length){ return; }`).
    """
    if node.configured_dest_count <= 0:
        return None
    return node.learned_dest_count / node.configured_dest_count * 100.0


def evaluate_node(node: NodeInput) -> NodeHealth:
    """Compute a node's health%, live status, and bypass flag (SDD §9.3, §9.1, §9.4)."""

    # --- L1 (transparent): config-completeness ONLY. operSt is untrustworthy here,
    #     so it is never consulted; threshold config is informational, never breached.
    if node.layer == PbrLayer.L1:
        resolved = bool(node.l1_interface_resolved)
        return NodeHealth(
            health_pct=100.0 if resolved else 0.0,
            live_status=PbrNodeStatus.LIVE if resolved else PbrNodeStatus.FAULTY,
            bypassed=False,
            breached=False,  # L1 never computes a threshold breach (SDD §9.1)
            active_pct=None,
        )

    # --- L3: learned/configured live check.
    active_pct = active_destination_pct(node)
    if active_pct is None:
        # Zero configured destinations -> unknown, excluded from the service average.
        return NodeHealth(
            health_pct=None,
            live_status=PbrNodeStatus.UNKNOWN,
            bypassed=False,
            breached=False,
            active_pct=None,
        )

    breached = bool(
        node.threshold_enable
        and node.min_threshold_pct is not None
        and active_pct < node.min_threshold_pct
    )

    if not breached:
        # Carrying (some) traffic. Zero live destinations with threshold disabled is a
        # genuine outage, not a "healthy" node.
        status = PbrNodeStatus.LIVE if active_pct > 0 else PbrNodeStatus.FAULTY
        return NodeHealth(active_pct, status, bypassed=False, breached=False, active_pct=active_pct)

    # Breached -> branch on thresholdDownAction. THREE distinct outcomes (Bug #1, SDD §9.3).
    action = node.threshold_down_action
    if action == PbrThresholdAction.BYPASS:
        # Graceful: traffic routed around the node, functioning as designed.
        # Score 100 and do NOT penalize service health.
        return NodeHealth(100.0, PbrNodeStatus.BYPASSED, bypassed=True, breached=True, active_pct=active_pct)
    if action == PbrThresholdAction.PERMIT:
        # Informational, less severe. NOT the graceful skip: do not ghost, do not force
        # 100. Score from the REAL active percentage (regression pin: a 0%-active permit
        # node must score 0, not 100 — the v19 prototype gets this wrong).
        return NodeHealth(active_pct, PbrNodeStatus.PERMIT, bypassed=False, breached=True, active_pct=active_pct)
    # deny (or unknown action while breached): genuine fault, real (low) score.
    return NodeHealth(active_pct, PbrNodeStatus.FAULTY, bypassed=False, breached=True, active_pct=active_pct)


def service_health(node_healths: Sequence[NodeHealth]) -> tuple[Optional[float], PbrServiceState]:
    """Average of node scores (nodes with zero configured dests excluded, SDD §9.4)
    plus a state that is NOT a static % band.

    The state reflects real service impact, not just the average:
      • DOWN only when **all** scored nodes are down (0%), OR a configured threshold is
        breached with a traffic-dropping action (deny) — a genuine outage.
      • HEALTHY only when every scored node is fully healthy (100%; a gracefully
        bypassed node counts as 100 by design).
      • otherwise WARNING (partial learn %, permit-breach, mixed) — a degraded but
        still-forwarding service is a warning, not down.

    A breach with `bypass` (functioning as designed) or `permit` (informational) does
    NOT make the service down — only `deny` does. This preserves the three-way
    threshold distinction (SDD §9.3).
    """
    scored = [h for h in node_healths if h.health_pct is not None]
    if not scored:
        return None, PbrServiceState.UNKNOWN
    avg = sum(h.health_pct for h in scored) / len(scored)

    # "Down" is a status judgement, not a % threshold: every scored node genuinely
    # faulty, or a deny-breach anywhere in the chain (traffic dropped). A `permit`
    # (PERMIT) or `bypass` (BYPASSED) node — even at 0% active — is NOT down.
    all_faulty = all(h.live_status == PbrNodeStatus.FAULTY for h in scored)
    deny_breach = any(h.breached and h.live_status == PbrNodeStatus.FAULTY for h in scored)

    if all_faulty or deny_breach:
        state = PbrServiceState.DOWN
    elif all(h.health_pct >= 100 for h in scored):
        state = PbrServiceState.HEALTHY
    else:
        state = PbrServiceState.DEGRADED
    return avg, state


# --------------------------------------------------------------------------- #
# Blast radius (SDD §5.5 / prototype computeBlastRadius)
# --------------------------------------------------------------------------- #


@dataclass
class ServiceDeviceGroups:
    service_id: str
    device_group_dns: set[str] = field(default_factory=set)


def blast_radius(
    target: ServiceDeviceGroups, others: Sequence[ServiceDeviceGroups]
) -> List[str]:
    """Service ids (same fabric) that share at least one device group with `target`.

    Device-group-only by design (not L3Out-based) — SDD §9.4 / Appendix B Q4.
    """
    if not target.device_group_dns:
        return []
    hits: List[str] = []
    for svc in others:
        if svc.service_id == target.service_id:
            continue
        if target.device_group_dns & svc.device_group_dns:
            hits.append(svc.service_id)
    return hits


# --------------------------------------------------------------------------- #
# IP-flow lookup (SDD §5.3 / prototype specificHits + defaultRouteForContractSide)
# --------------------------------------------------------------------------- #


class FlowLookupError(ValueError):
    """Raised for invalid flow-lookup input, with an actionable message."""


def validate_host_ip(value: str, *, field_name: str) -> ipaddress._BaseAddress:
    """Strict single-host IPv4/IPv6 validation.

    Rejects CIDR notation in a single-host field with an actionable message (SDD §5.3).
    """
    if value is None or not str(value).strip():
        raise FlowLookupError(f"{field_name} is required.")
    text = str(value).strip()
    if "/" in text:
        raise FlowLookupError(
            f"{field_name} must be a single host address, not a prefix/CIDR "
            f"(remove the '/NN'). Got '{text}'."
        )
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        raise FlowLookupError(f"{field_name} is not a valid IPv4 or IPv6 address: '{text}'.")


@dataclass
class SubnetInput:
    """A scope-classified l3extSubnet, as fed to the matcher."""

    prefix: str  # CIDR
    scope_valid: bool
    is_default_route: bool
    service_id: str
    contract_dn: str
    side: str  # "consumer" | "provider"
    epg_dn: Optional[str] = None

    def network(self) -> Optional[ipaddress._BaseNetwork]:
        try:
            return ipaddress.ip_network(self.prefix, strict=False)
        except ValueError:
            return None


@dataclass
class SideMatch:
    subnet: SubnetInput
    prefixlen: int
    is_default: bool


@dataclass
class FlowCandidate:
    service_id: str
    contract_dn: str
    src_subnet: SubnetInput
    dst_subnet: SubnetInput
    used_default_route: bool


@dataclass
class FlowLookupResult:
    candidates: List[FlowCandidate]
    ambiguous: bool  # more than one candidate tied -> surfaced, never silently picked
    message: Optional[str] = None


def _specific_matches(
    ip: ipaddress._BaseAddress, subnets: Sequence[SubnetInput]
) -> List[SideMatch]:
    """Longest-prefix matches among SCOPE-VALID, NON-default subnets containing `ip`.

    Returns all subnets tied at the longest prefix length (SDD §5.3).
    """
    matches: List[SideMatch] = []
    for sn in subnets:
        if not sn.scope_valid or sn.is_default_route:
            continue
        net = sn.network()
        if net is None or ip.version != net.version:
            continue
        if ip in net:
            matches.append(SideMatch(sn, net.prefixlen, is_default=False))
    if not matches:
        return []
    best = max(m.prefixlen for m in matches)
    return [m for m in matches if m.prefixlen == best]


def match_flow(src: str, dst: str, subnets: Sequence[SubnetInput]) -> FlowLookupResult:
    """Resolve a source/destination host pair to service/contract candidates.

    Rules (SDD §5.3):
      - strict host validation; reject address-family mismatch
      - longest-prefix match against scope-valid subnets only
      - default-route fallback allowed ONLY when the SAME contract's opposite side
        holds the default route (not just any default route in the fabric)
      - ties are surfaced explicitly, never silently resolved
    """
    src_ip = validate_host_ip(src, field_name="Source address")
    dst_ip = validate_host_ip(dst, field_name="Destination address")
    if src_ip.version != dst_ip.version:
        raise FlowLookupError(
            "Source and destination address families do not match "
            f"(source is IPv{src_ip.version}, destination is IPv{dst_ip.version})."
        )

    src_specific = _specific_matches(src_ip, subnets)
    dst_specific = _specific_matches(dst_ip, subnets)

    def _defaults_for(service_id: str, side: str) -> List[SubnetInput]:
        return [
            sn
            for sn in subnets
            if sn.scope_valid
            and sn.is_default_route
            and sn.service_id == service_id
            and sn.side == side
        ]

    candidates: List[FlowCandidate] = []

    # A real hit = a service where src matches one side and dst matches the OPPOSITE side.
    for s in src_specific:
        for d in dst_specific:
            if s.subnet.service_id != d.subnet.service_id:
                continue
            if s.subnet.side == d.subnet.side:
                continue  # must be opposite sides of the same contract
            candidates.append(
                FlowCandidate(
                    service_id=s.subnet.service_id,
                    contract_dn=s.subnet.contract_dn,
                    src_subnet=s.subnet,
                    dst_subnet=d.subnet,
                    used_default_route=False,
                )
            )

    # Default-route fallback: one side specific, the other only via the SAME
    # contract's opposite-side default route.
    if not candidates:
        for s in src_specific:
            opp = "provider" if s.subnet.side == "consumer" else "consumer"
            for dsn in _defaults_for(s.subnet.service_id, opp):
                net = dsn.network()
                if net is not None and dst_ip.version == net.version and dst_ip in net:
                    candidates.append(
                        FlowCandidate(
                            service_id=s.subnet.service_id,
                            contract_dn=s.subnet.contract_dn,
                            src_subnet=s.subnet,
                            dst_subnet=dsn,
                            used_default_route=True,
                        )
                    )
        for d in dst_specific:
            opp = "provider" if d.subnet.side == "consumer" else "consumer"
            for ssn in _defaults_for(d.subnet.service_id, opp):
                net = ssn.network()
                if net is not None and src_ip.version == net.version and src_ip in net:
                    candidates.append(
                        FlowCandidate(
                            service_id=d.subnet.service_id,
                            contract_dn=d.subnet.contract_dn,
                            src_subnet=ssn,
                            dst_subnet=d.subnet,
                            used_default_route=True,
                        )
                    )

    if not candidates:
        return FlowLookupResult(candidates=[], ambiguous=False, message="No scope-valid subnet match.")

    # De-duplicate identical candidates (same service + same subnets).
    unique: List[FlowCandidate] = []
    seen = set()
    for c in candidates:
        key = (c.service_id, c.src_subnet.prefix, c.dst_subnet.prefix, c.used_default_route)
        if key not in seen:
            seen.add(key)
            unique.append(c)

    ambiguous = len(unique) > 1
    msg = "Multiple candidate services matched; all are shown." if ambiguous else None
    return FlowLookupResult(candidates=unique, ambiguous=ambiguous, message=msg)
