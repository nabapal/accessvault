"""Integration + unit tests for the PBR collector's ingestion rules.

Focus: the fetch-count verification that guards Bug #3 (a partial fvRsProv/fvRsCons
fetch once produced a wrong subnet↔contract mapping), plus the intersection and
scope-valid rules. APIC is mocked with httpx.MockTransport so no live fabric is needed.
"""
import json

import httpx
import pytest


@pytest.fixture(autouse=True)
def setup_database():
    """These tests don't touch the DB; override the conftest's autouse async fixture."""
    yield


from app.services.pbr_collector import (  # noqa: E402
    PbrPartialFetchError,
    build_services,
    classify_subnets,
    fetch_class,
    scope_is_valid,
    verify_fetch_count,
)


# --------------------------------------------------------------------------- #
# Bug #3 — fetch-count verification
# --------------------------------------------------------------------------- #


def test_verify_fetch_count_raises_on_partial():
    fetched = [{} for _ in range(62)]  # 62 of 77 — the exact shape of the real regression
    with pytest.raises(PbrPartialFetchError) as e:
        verify_fetch_count("fvRsProv", fetched, "77")
    assert "62 of 77" in str(e.value)


def test_verify_fetch_count_passes_on_match():
    verify_fetch_count("fvRsCons", [{} for _ in range(94)], "94")  # no raise


def test_verify_fetch_count_noop_when_total_missing_or_bad():
    verify_fetch_count("fvRsProv", [{}], None)
    verify_fetch_count("fvRsProv", [{}], "not-an-int")


def _mock_client(imdata, total_count):
    payload = {"totalCount": total_count, "imdata": imdata}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps(payload))

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://apic.example")


@pytest.mark.anyio("asyncio")
async def test_fetch_class_verify_raises_on_partial_apic_response():
    """End-to-end through fetch_class: APIC reports 77 but returns 62 -> refuse."""
    async with _mock_client([{"fvRsProv": {"attributes": {}}} for _ in range(62)], "77") as client:
        with pytest.raises(PbrPartialFetchError):
            await fetch_class(client, "fvRsProv", verify=True)


@pytest.mark.anyio("asyncio")
async def test_fetch_class_ok_when_counts_match():
    async with _mock_client([{"fvRsProv": {"attributes": {}}} for _ in range(5)], "5") as client:
        data = await fetch_class(client, "fvRsProv", verify=True)
    assert len(data) == 5


# --------------------------------------------------------------------------- #
# Service intersection rule (union must NOT be shown)
# --------------------------------------------------------------------------- #


def _ldevctx(cname, gname, node="N1"):
    # Mirror the live shape: vnsGraphInst exposes DNs; vnsLDevCtx exposes name-or-lbl.
    return {
        "vnsLDevCtx": {
            "attributes": {
                "ctrctNameOrLbl": cname,
                "graphNameOrLbl": gname,
                "nodeNameOrLbl": node,
                "dn": f"uni/tn-T/ldevCtx-c-{cname}-g-{gname}-n-{node}",
            },
            "children": [],
        }
    }


def _graphinst(cname, gname):
    return {
        "vnsGraphInst": {
            "attributes": {
                "ctrctDn": f"uni/tn-T/brc-{cname}",
                "graphDn": f"uni/tn-T/AbsGraph-{gname}",
            }
        }
    }


def test_service_intersection_only_keeps_pairs_in_both():
    datasets = {
        "vnsGraphInst": [_graphinst("C1", "G1"), _graphinst("C2", "G2")],  # C2/G2 only here
        "vnsLDevCtx": [_ldevctx("C1", "G1"), _ldevctx("C3", "G3")],        # C3/G3 only here
    }
    services = build_services(datasets)
    keys = {(s.contract_name, s.graph_name) for s in services}
    assert keys == {("C1", "G1")}  # intersection only (name-matched)
    # node hydrated from the vnsLDevCtx entry
    assert [n.name for n in services[0].nodes] == ["N1"]


# --------------------------------------------------------------------------- #
# Scope-valid subnet rule
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "scope,expected",
    [
        ("import-security", True),
        ("import-security,shared-rtctrl", True),
        ("import-security&shared-security", True),
        ("shared-rtctrl", False),
        ("", False),
        (None, False),
    ],
)
def test_scope_is_valid(scope, expected):
    assert scope_is_valid(scope) is expected


def _subnet(prefix, scope, epg):
    return {"l3extSubnet": {"attributes": {"ip": prefix, "scope": scope, "dn": f"{epg}/extsubnet-[{prefix}]"}}}


def test_classify_subnets_flags_scope_and_default():
    epg = "uni/tn-T/out-O/instP-E"
    datasets = {
        "l3extSubnet": [
            _subnet("10.0.0.0/24", "import-security", epg),
            _subnet("0.0.0.0/0", "import-security", epg),
            _subnet("192.168.0.0/24", "shared-rtctrl", "uni/tn-T/out-O/instP-E2"),
        ]
    }
    subnets = classify_subnets(datasets, [])  # no services -> unlinked
    by_prefix = {s["prefix"]: s for s in subnets}
    assert by_prefix["10.0.0.0/24"]["scope_valid"] is True
    assert by_prefix["10.0.0.0/24"]["is_default_route"] is False
    assert by_prefix["10.0.0.0/24"]["epg_dn"] == epg
    assert by_prefix["0.0.0.0/0"]["is_default_route"] is True
    assert by_prefix["192.168.0.0/24"]["scope_valid"] is False  # retained but never resolves
