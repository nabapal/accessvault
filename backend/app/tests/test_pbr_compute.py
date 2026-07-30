"""Unit tests for the PBR computation layer.

These pin the edge cases from SDD §9/§5.3 — especially the three real bugs found +
fixed during prototyping. They deliberately go beyond the happy path.
"""
import pytest


@pytest.fixture(autouse=True)
def setup_database():
    """Override the conftest's autouse async DB fixture — these are pure unit tests
    with no DB dependency, so we skip table setup/teardown entirely."""
    yield


from app.models.pbr import PbrLayer, PbrNodeStatus, PbrServiceState, PbrThresholdAction  # noqa: E402
from app.services.pbr_compute import (  # noqa: E402
    FlowLookupError,
    NodeInput,
    ServiceDeviceGroups,
    SubnetInput,
    blast_radius,
    evaluate_node,
    match_flow,
    service_health,
    validate_host_ip,
)


# --------------------------------------------------------------------------- #
# Bug #1 — three-way threshold/bypass (bypass != permit != deny)
# --------------------------------------------------------------------------- #


def test_breached_bypass_scores_100_and_is_bypassed():
    node = NodeInput(
        layer=PbrLayer.L3, configured_dest_count=2, learned_dest_count=0,  # 0% active
        threshold_enable=True, min_threshold_pct=50.0,
        threshold_down_action=PbrThresholdAction.BYPASS,
    )
    h = evaluate_node(node)
    assert h.bypassed is True
    assert h.live_status == PbrNodeStatus.BYPASSED
    assert h.health_pct == 100.0  # functioning as designed


def test_breached_permit_is_NOT_bypass_and_scores_real_pct():
    """REGRESSION PIN (Bug #1 / SDD §9.3): a breached `permit` node at 0% active must
    score 0, not 100, and be PERMIT, not BYPASSED. The v19 prototype's nodeBypassState
    collapses permit into bypass — this must NOT happen here."""
    node = NodeInput(
        layer=PbrLayer.L3, configured_dest_count=2, learned_dest_count=0,  # 0% active
        threshold_enable=True, min_threshold_pct=50.0,
        threshold_down_action=PbrThresholdAction.PERMIT,
    )
    h = evaluate_node(node)
    assert h.bypassed is False
    assert h.live_status == PbrNodeStatus.PERMIT
    assert h.health_pct == 0.0  # the REAL active percentage, not 100


def test_breached_deny_is_a_real_fault():
    node = NodeInput(
        layer=PbrLayer.L3, configured_dest_count=4, learned_dest_count=1,  # 25%
        threshold_enable=True, min_threshold_pct=50.0,
        threshold_down_action=PbrThresholdAction.DENY,
    )
    h = evaluate_node(node)
    assert h.bypassed is False
    assert h.live_status == PbrNodeStatus.FAULTY
    assert h.health_pct == 25.0


def test_permit_and_bypass_diverge_on_identical_inputs():
    base = dict(layer=PbrLayer.L3, configured_dest_count=3, learned_dest_count=0,
                threshold_enable=True, min_threshold_pct=50.0)
    bypass = evaluate_node(NodeInput(**base, threshold_down_action=PbrThresholdAction.BYPASS))
    permit = evaluate_node(NodeInput(**base, threshold_down_action=PbrThresholdAction.PERMIT))
    assert (bypass.health_pct, bypass.live_status) == (100.0, PbrNodeStatus.BYPASSED)
    assert (permit.health_pct, permit.live_status) == (0.0, PbrNodeStatus.PERMIT)
    assert bypass.health_pct != permit.health_pct


def test_not_breached_when_threshold_disabled_scores_real_pct():
    node = NodeInput(layer=PbrLayer.L3, configured_dest_count=4, learned_dest_count=2,
                     threshold_enable=False, threshold_down_action=PbrThresholdAction.BYPASS)
    h = evaluate_node(node)
    assert h.breached is False and h.bypassed is False
    assert h.health_pct == 50.0
    assert h.live_status == PbrNodeStatus.LIVE


def test_above_threshold_is_live():
    node = NodeInput(layer=PbrLayer.L3, configured_dest_count=4, learned_dest_count=3,
                     threshold_enable=True, min_threshold_pct=50.0,
                     threshold_down_action=PbrThresholdAction.BYPASS)
    h = evaluate_node(node)
    assert h.breached is False
    assert h.live_status == PbrNodeStatus.LIVE
    assert h.health_pct == 75.0


# --------------------------------------------------------------------------- #
# Bug #2 — L1 nodes: config-completeness only, operSt ignored
# --------------------------------------------------------------------------- #


def test_l1_resolved_is_100_regardless_of_threshold():
    node = NodeInput(layer=PbrLayer.L1, l1_interface_resolved=True,
                     threshold_enable=True, min_threshold_pct=99.0,
                     threshold_down_action=PbrThresholdAction.DENY)
    h = evaluate_node(node)
    assert h.health_pct == 100.0
    assert h.live_status == PbrNodeStatus.LIVE
    assert h.breached is False  # L1 never computes a breach


def test_l1_unresolved_is_0():
    h = evaluate_node(NodeInput(layer=PbrLayer.L1, l1_interface_resolved=False))
    assert h.health_pct == 0.0
    assert h.live_status == PbrNodeStatus.FAULTY


# --------------------------------------------------------------------------- #
# Health scoring & zero-configured exclusion (SDD §9.4)
# --------------------------------------------------------------------------- #


def test_zero_configured_dests_excluded_from_average():
    healthy = evaluate_node(NodeInput(layer=PbrLayer.L3, configured_dest_count=2, learned_dest_count=2))
    empty = evaluate_node(NodeInput(layer=PbrLayer.L3, configured_dest_count=0, learned_dest_count=0))
    assert empty.health_pct is None  # excluded, NOT counted as 0
    avg, state = service_health([healthy, empty])
    assert avg == 100.0
    assert state == PbrServiceState.HEALTHY


def test_service_all_unknown_is_unknown():
    empty = evaluate_node(NodeInput(layer=PbrLayer.L3, configured_dest_count=0))
    avg, state = service_health([empty])
    assert avg is None
    assert state == PbrServiceState.UNKNOWN


def test_service_average_mixes_bypass_and_real():
    bypassed = evaluate_node(NodeInput(layer=PbrLayer.L3, configured_dest_count=2, learned_dest_count=0,
                                       threshold_enable=True, min_threshold_pct=50.0,
                                       threshold_down_action=PbrThresholdAction.BYPASS))  # 100
    degraded = evaluate_node(NodeInput(layer=PbrLayer.L3, configured_dest_count=2, learned_dest_count=1))  # 50
    avg, state = service_health([bypassed, degraded])
    assert avg == 75.0
    assert state == PbrServiceState.DEGRADED


# --------------------------------------------------------------------------- #
# Blast radius (SDD §5.5)
# --------------------------------------------------------------------------- #


def test_blast_radius_device_group_sharing():
    target = ServiceDeviceGroups("svc-A", {"dg1", "dg2"})
    others = [
        ServiceDeviceGroups("svc-B", {"dg2"}),
        ServiceDeviceGroups("svc-C", {"dg9"}),
        ServiceDeviceGroups("svc-A", {"dg1"}),  # self
        ServiceDeviceGroups("svc-D", {"dg1", "dg7"}),
    ]
    assert set(blast_radius(target, others)) == {"svc-B", "svc-D"}


def test_blast_radius_empty_when_no_device_groups():
    target = ServiceDeviceGroups("svc-A", set())
    assert blast_radius(target, [ServiceDeviceGroups("svc-B", {"dg1"})]) == []


# --------------------------------------------------------------------------- #
# IP-flow lookup validation (SDD §5.3)
# --------------------------------------------------------------------------- #


def test_reject_cidr_in_host_field():
    with pytest.raises(FlowLookupError) as e:
        validate_host_ip("10.0.0.0/24", field_name="Source address")
    assert "prefix" in str(e.value).lower() or "cidr" in str(e.value).lower()


def test_reject_garbage_ip():
    with pytest.raises(FlowLookupError):
        validate_host_ip("not-an-ip", field_name="Source address")


def test_reject_address_family_mismatch():
    subnets = [
        SubnetInput("10.0.0.0/24", True, False, "svc-A", "c-A", "consumer"),
        SubnetInput("192.168.0.0/24", True, False, "svc-A", "c-A", "provider"),
    ]
    with pytest.raises(FlowLookupError) as e:
        match_flow("10.0.0.5", "fe80::1", subnets)
    assert "famil" in str(e.value).lower()


# --------------------------------------------------------------------------- #
# IP-flow lookup matching (SDD §5.3)
# --------------------------------------------------------------------------- #


def test_longest_prefix_wins_overlapping_22_vs_23():
    subnets = [
        SubnetInput("10.10.0.0/22", True, False, "svc-broad", "c-broad", "consumer"),
        SubnetInput("10.10.0.0/23", True, False, "svc-narrow", "c-narrow", "consumer"),
        SubnetInput("172.16.0.0/24", True, False, "svc-broad", "c-broad", "provider"),
        SubnetInput("172.16.0.0/24", True, False, "svc-narrow", "c-narrow", "provider"),
    ]
    res = match_flow("10.10.0.5", "172.16.0.9", subnets)
    assert res.ambiguous is False
    assert len(res.candidates) == 1
    assert res.candidates[0].service_id == "svc-narrow"
    assert res.candidates[0].src_subnet.prefix == "10.10.0.0/23"


def test_non_scope_valid_subnet_never_resolves():
    subnets = [
        SubnetInput("10.0.0.0/24", False, False, "svc-A", "c-A", "consumer"),  # not scope-valid
        SubnetInput("192.168.0.0/24", True, False, "svc-A", "c-A", "provider"),
    ]
    res = match_flow("10.0.0.5", "192.168.0.5", subnets)
    assert res.candidates == []


def test_default_route_requires_same_contract_opposite_side():
    subnets = [
        SubnetInput("10.0.0.0/24", True, False, "svc-A", "c-A", "consumer"),
        SubnetInput("0.0.0.0/0", True, True, "svc-A", "c-A", "provider"),   # allowed fallback
        SubnetInput("0.0.0.0/0", True, True, "svc-Z", "c-Z", "provider"),   # unrelated -> must not be used
    ]
    res = match_flow("10.0.0.5", "8.8.8.8", subnets)
    assert len(res.candidates) == 1
    c = res.candidates[0]
    assert c.service_id == "svc-A"
    assert c.used_default_route is True
    assert c.dst_subnet.service_id == "svc-A"


def test_ties_are_surfaced_not_silently_picked():
    subnets = [
        SubnetInput("10.0.0.0/24", True, False, "svc-A", "c-A", "consumer"),
        SubnetInput("192.168.0.0/24", True, False, "svc-A", "c-A", "provider"),
        SubnetInput("10.0.0.0/24", True, False, "svc-B", "c-B", "consumer"),
        SubnetInput("192.168.0.0/24", True, False, "svc-B", "c-B", "provider"),
    ]
    res = match_flow("10.0.0.5", "192.168.0.5", subnets)
    assert res.ambiguous is True
    assert {c.service_id for c in res.candidates} == {"svc-A", "svc-B"}


def test_same_side_does_not_form_a_candidate():
    subnets = [
        SubnetInput("10.0.0.0/24", True, False, "svc-A", "c-A", "consumer"),
        SubnetInput("10.0.1.0/24", True, False, "svc-A", "c-A", "consumer"),
    ]
    res = match_flow("10.0.0.5", "10.0.1.5", subnets)
    assert res.candidates == []
