"""PBR Flow Monitoring — per-fabric APIC ingestion (read-only) + poller.

Reuses the existing telco/ACI APIC access pattern (httpx login → APIC-cookie →
`/api/class/<mo>.json`, with `_apic_get_with_retry` + a bounded fetch semaphore) rather
than introducing a parallel connector. See SDD §4/§6.1.

Implements the three hard rules validated in the prototype (SDD §7.3, §9):
  • fetch-count verification for fvRsProv/fvRsCons (Bug #3) — pure + unit-tested.
  • service intersection rule — a (contract, graph) is a Service only if present in
    BOTH vnsGraphInst AND vnsLDevCtx (matched on contract+graph NAME, since vnsGraphInst
    exposes DNs and vnsLDevCtx exposes name-or-lbl).
  • scope-valid subnet rule — only l3extSubnet with scope containing "import-security".

Parsing follows the live APIC shapes observed on the Bangalore/Mumbai/Jamnagar fabrics:
  vnsGraphInst.ctrctDn=".../brc-<c>"  .graphDn=".../AbsGraph-<g>"
  vnsLDevCtx.ctrctNameOrLbl=<c> .graphNameOrLbl=<g> .nodeNameOrLbl=<Nn>
    child vnsRsLDevCtxToLDev.tDn=".../lDevVip-<devgrp>"
    child vnsLIfCtx/vnsRsLIfCtxToSvcRedirectPol.tDn=".../svcRedirectPol-<name>"
    child vnsLIfCtx/vnsRsLIfCtxToBD.tDn=".../BD-<bd>"
  vnsSvcRedirectPol.thresholdEnable=yes|no .minThresholdPercent .thresholdDownAction
  vnsRedirectDest.dn="<polDn>/RedirectDest_ip-[<ip>]"  (L3)
  vnsL1L2RedirectDest.dn="<polDn>/L1L2RedirectDest-<name>"  (L1)
  fvRsProv/fvRsCons.tnVzBrCPName=<contract>  dn=".../<epgDn>/rs(prov|cons)-<c>"
  l3extSubnet.dn="<epgDn>/extsubnet-[<prefix>]"  .scope  .ip
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Sequence, Tuple

import httpx
from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.pbr import (
    PbrHealthSample,
    PbrLayer,
    PbrNode,
    PbrRedirectDest,
    PbrService,
    PbrSubnet,
    PbrThresholdAction,
)
from app.models.telco import TelcoFabricOnboardingJob, TelcoFabricType, TelcoOnboardingStatus
from app.services import pbr_compute as compute
from app.services.crypto import decrypt_secret
# Reuse the validated APIC transport helpers from the telco collector.
from app.services.telco_collector import _apic_get_with_retry, _build_base_url

logger = logging.getLogger(__name__)

# MO classes ingested per poll (SDD §7.1). `verify` => count-verified (Bug #3);
# `subtree` => fetched with rsp-subtree=full.
_PBR_CLASSES: Dict[str, Dict[str, bool]] = {
    "vnsGraphInst": {"subtree": False, "verify": False},
    "vnsLDevCtx": {"subtree": True, "verify": False},
    "vnsRsCIfPathAtt": {"subtree": False, "verify": False},  # concrete path -> leaf ids
    "vnsSvcRedirectPol": {"subtree": False, "verify": False},
    "vnsRedirectDest": {"subtree": False, "verify": False},
    "vnsL1L2RedirectDest": {"subtree": False, "verify": False},
    "vnsEPpInfo": {"subtree": False, "verify": False},  # connector shadow-EPG VLAN encap (BD side)
    "l3extRsPathL3OutAtt": {"subtree": False, "verify": False},  # L3Out logical-interface VLAN encap
    "l3extRsEctx": {"subtree": False, "verify": False},  # L3Out -> VRF
    "l3extSubnet": {"subtree": False, "verify": False},
    "fvRsProv": {"subtree": False, "verify": True},   # count-verified (Bug #3)
    "fvRsCons": {"subtree": False, "verify": True},   # count-verified (Bug #3)
    "fvIp": {"subtree": False, "verify": False},
}

_PBR_FETCH_CONCURRENCY = 2
# Large/busy fabrics (e.g. 6k+ interfaces, 15k+ fvIp) can return 503 under load;
# give the fetch more headroom to ride out transient APIC overload before failing
# the whole fabric. (Shared _apic_get_with_retry defaults stay for telco.)
_PBR_FETCH_RETRIES = 6
_PBR_FETCH_BACKOFF = 3.0


class PbrCollectionError(Exception):
    """Raised when a PBR collection run fails for a known reason."""


class PbrPartialFetchError(PbrCollectionError):
    """Raised when a count-verified fetch returned fewer objects than APIC reported
    (Bug #3). We refuse to persist a partial result."""


@dataclass
class PbrCollectionResult:
    success: bool
    timestamp: datetime
    snapshot: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


# --------------------------------------------------------------------------- #
# Pure helpers (unit-testable without APIC)
# --------------------------------------------------------------------------- #


def verify_fetch_count(mo_class: str, fetched: Sequence[Any], total_count: Any) -> None:
    """Assert a fetch is complete against APIC's reported `totalCount` (Bug #3)."""
    if total_count is None:
        return
    try:
        total = int(total_count)
    except (TypeError, ValueError):
        return
    if len(fetched) != total:
        raise PbrPartialFetchError(
            f"{mo_class}: fetched {len(fetched)} of {total} objects reported by APIC — "
            f"refusing to persist a partial fetch."
        )


def scope_is_valid(scope: Optional[str]) -> bool:
    """Scope-valid subnet rule (SDD §7.3.3): usable for IP classification only if the
    l3extSubnet scope contains `import-security`."""
    if not scope:
        return False
    tokens = [t.strip() for t in str(scope).replace("&", ",").split(",")]
    return "import-security" in tokens


def is_default_route(prefix: Optional[str]) -> bool:
    return prefix in {"0.0.0.0/0", "::/0"}


def _yn(value: Any) -> bool:
    return str(value).strip().lower() in {"yes", "true", "1"}


def _num(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _attrs(mo: Dict[str, Any], mo_class: str) -> Dict[str, Any]:
    """Pull `attributes` out of an APIC MO wrapper `{class: {attributes: {}}}`."""
    if not isinstance(mo, dict):
        return {}
    body = mo.get(mo_class) or next(iter(mo.values()), {})
    if isinstance(body, dict):
        return body.get("attributes", {}) or {}
    return {}


def _name_after(dn: Optional[str], token: str) -> Optional[str]:
    """Return the segment after the first `<token>` in a DN's matching path element.

    e.g. _name_after('uni/tn-T/brc-C-5G-IPDR', 'brc-') -> 'C-5G-IPDR'.
    """
    if not dn:
        return None
    for seg in dn.split("/"):
        if seg.startswith(token):
            return seg[len(token):]
    return None


def _epg_short_name(epg_dn: Optional[str]) -> Optional[str]:
    """Human-ish EPG name from an external/internal EPG DN."""
    if not epg_dn:
        return None
    tail = epg_dn.rstrip("/").split("/")[-1]
    for prefix in ("instP-", "epg-"):
        if tail.startswith(prefix):
            return tail[len(prefix):]
    return tail


def _walk(body: Dict[str, Any]):
    """Yield (class, attributes) for a MO body and all descendants in a subtree fetch."""
    children = body.get("children", []) or []
    for child in children:
        for cls, cbody in child.items():
            if not isinstance(cbody, dict):
                continue
            yield cls, cbody.get("attributes", {}) or {}
            yield from _walk(cbody)


# --------------------------------------------------------------------------- #
# APIC fetch
# --------------------------------------------------------------------------- #


async def _apic_login(client: httpx.AsyncClient, username: str, password: str) -> None:
    login_payload = {"aaaUser": {"attributes": {"name": username, "pwd": password}}}
    response = await client.post("/api/aaaLogin.json", json=login_payload)
    response.raise_for_status()
    data = response.json()
    try:
        token = data["imdata"][0]["aaaLogin"]["attributes"]["token"]
    except (KeyError, IndexError) as exc:
        raise PbrCollectionError("Unexpected login response from APIC.") from exc
    client.cookies.set("APIC-cookie", token)


async def fetch_class(
    client: httpx.AsyncClient, mo_class: str, *, subtree: bool = False, verify: bool = False
) -> List[Dict[str, Any]]:
    """Fetch one MO class, optionally with a full subtree, and optionally count-verify."""
    path = f"/api/class/{mo_class}.json"
    if subtree:
        path += "?query-target=self&rsp-subtree=full"
    response = await _apic_get_with_retry(
        client, path, retries=_PBR_FETCH_RETRIES, backoff=_PBR_FETCH_BACKOFF
    )
    payload = response.json()
    imdata = payload.get("imdata", [])
    if not isinstance(imdata, list):
        imdata = []
    if verify:
        verify_fetch_count(mo_class, imdata, payload.get("totalCount"))
    return imdata


async def _fetch_all(client: httpx.AsyncClient) -> Dict[str, List[Dict[str, Any]]]:
    semaphore = asyncio.Semaphore(_PBR_FETCH_CONCURRENCY)

    async def one(mo_class: str, cfg: Dict[str, bool]) -> Tuple[str, List[Dict[str, Any]]]:
        async with semaphore:
            data = await fetch_class(client, mo_class, subtree=cfg["subtree"], verify=cfg["verify"])
            return mo_class, data

    results = await asyncio.gather(*(one(k, v) for k, v in _PBR_CLASSES.items()))
    return dict(results)


# --------------------------------------------------------------------------- #
# Normalization
# --------------------------------------------------------------------------- #


import re


@dataclass
class _Pol:
    name: Optional[str]
    threshold_enable: bool
    min_pct: Optional[float]
    max_pct: Optional[float]
    action: PbrThresholdAction
    l3_dests: List[Dict[str, Any]] = field(default_factory=list)  # {ip,mac}
    l1_dests: List[Dict[str, Any]] = field(default_factory=list)  # {ref,name}


@dataclass
class _ParsedNode:
    dn: str
    name: Optional[str]
    layer: PbrLayer
    device_group_dn: Optional[str]
    device_group_name: Optional[str]
    redirect_policy_names: List[str] = field(default_factory=list)
    threshold_enable: bool = False
    min_threshold_pct: Optional[float] = None
    max_threshold_pct: Optional[float] = None
    threshold_down_action: PbrThresholdAction = PbrThresholdAction.UNKNOWN
    active_pct: Optional[float] = None
    dests: List[Dict[str, Any]] = field(default_factory=list)  # for health calc
    detail: Dict[str, Any] = field(default_factory=dict)       # full prototype-shape node
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class _ParsedService:
    contract_dn: str
    graph_dn: str
    contract_name: Optional[str]
    graph_name: Optional[str]
    consumer_epg_dn: Optional[str] = None
    provider_epg_dn: Optional[str] = None
    consumer_epg_name: Optional[str] = None
    provider_epg_name: Optional[str] = None
    consumer_epg_dns: List[str] = field(default_factory=list)  # all consumer external-EPG DNs
    provider_epg_dns: List[str] = field(default_factory=list)
    consumer_epgs: List[Dict[str, Any]] = field(default_factory=list)  # {l3out,epg,subnets,...}
    provider_epgs: List[Dict[str, Any]] = field(default_factory=list)
    nodes: List[_ParsedNode] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)


def _parse_redirect_policies(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[str, _Pol]:
    pols: Dict[str, _Pol] = {}
    for mo in datasets.get("vnsSvcRedirectPol", []):
        a = _attrs(mo, "vnsSvcRedirectPol")
        dn = a.get("dn")
        if not dn:
            continue
        pols[dn] = _Pol(
            name=a.get("name"),
            threshold_enable=_yn(a.get("thresholdEnable")),
            min_pct=_num(a.get("minThresholdPercent")),
            max_pct=_num(a.get("maxThresholdPercent")),
            action=PbrThresholdAction.from_raw(a.get("thresholdDownAction")),
        )
    for mo in datasets.get("vnsRedirectDest", []):
        a = _attrs(mo, "vnsRedirectDest")
        dn = a.get("dn") or ""
        parent = dn.split("/RedirectDest")[0]
        if parent in pols:
            pols[parent].l3_dests.append({"ip": a.get("ip"), "mac": a.get("mac")})
    for mo in datasets.get("vnsL1L2RedirectDest", []):
        a = _attrs(mo, "vnsL1L2RedirectDest")
        dn = a.get("dn") or ""
        parent = dn.split("/L1L2RedirectDest")[0]
        if parent in pols:
            pols[parent].l1_dests.append(
                {"destName": a.get("destName") or a.get("name"), "interface": a.get("implName") or a.get("destName")}
            )
    return pols


def _resolve_epgs(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Dict[str, List[str]]]:
    """contract name -> {'provider': [epg_dn...], 'consumer': [epg_dn...]}."""
    out: Dict[str, Dict[str, List[str]]] = {}

    def add(contract: Optional[str], side: str, epg_dn: str) -> None:
        if not contract or not epg_dn:
            return
        entry = out.setdefault(contract, {"provider": [], "consumer": []})
        if epg_dn not in entry[side]:
            entry[side].append(epg_dn)

    for mo in datasets.get("fvRsProv", []):
        a = _attrs(mo, "fvRsProv")
        add(a.get("tnVzBrCPName"), "provider", (a.get("dn") or "").split("/rsprov-")[0])
    for mo in datasets.get("fvRsCons", []):
        a = _attrs(mo, "fvRsCons")
        add(a.get("tnVzBrCPName"), "consumer", (a.get("dn") or "").split("/rscons-")[0])
    return out


_LEAF_RE = re.compile(r"/(?:protpaths|paths)-([0-9-]+)/")


def _parse_leafs(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[str]]:
    """device-group DN (lDevVip-<DG>) -> sorted leaf ids, from vnsRsCIfPathAtt tDn
    (e.g. topology/pod-1/protpaths-701-751/pathep-[…] -> '701-751')."""
    out: Dict[str, set] = {}
    for mo in datasets.get("vnsRsCIfPathAtt", []):
        a = _attrs(mo, "vnsRsCIfPathAtt")
        dn = a.get("dn") or ""
        devgrp = dn.split("/cDev-")[0]
        m = _LEAF_RE.search(a.get("tDn") or "")
        if devgrp and m:
            out.setdefault(devgrp, set()).add(m.group(1))
    return {k: sorted(v) for k, v in out.items()}


def _parse_encaps(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[Tuple[str, str], str]:
    """(device-group name, BD/connector name) -> VLAN encap, from vnsEPpInfo.

    e.g. dn '…/lDevVip-DG-CGNAT-TEST…/G-…-N-BD_CGN_Test_683-C-CGNAT-683', encap
    'vlan-683'  ->  ('DG-CGNAT-TEST', 'BD_CGN_Test_683') -> 'vlan-683'.
    """
    out: Dict[Tuple[str, str], str] = {}
    for mo in datasets.get("vnsEPpInfo", []):
        a = _attrs(mo, "vnsEPpInfo")
        dn = a.get("dn") or ""
        encap = a.get("encap")
        if not encap or encap == "unknown":
            continue
        dg = _name_after(dn, "lDevVip-")
        # trim any trailing bracket/path noise from the device-group token
        if dg:
            dg = re.split(r"[\]/]", dg)[0]
        seg = dn.rstrip("/").split("/")[-1]
        nname = None
        if "-N-" in seg and "-C-" in seg:
            nname = seg.rsplit("-C-", 1)[0].split("-N-", 1)[1]
        if dg and nname:
            out[(dg, nname)] = encap
    return out


def _parse_l3out_encaps(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[str, str]:
    """L3Out name -> VLAN encap, from l3extRsPathL3OutAtt (…/out-<L3Out>/…, encap 'vlan-N')."""
    out: Dict[str, str] = {}
    for mo in datasets.get("l3extRsPathL3OutAtt", []):
        a = _attrs(mo, "l3extRsPathL3OutAtt")
        encap = a.get("encap")
        if not encap or not str(encap).startswith("vlan"):
            continue
        m = re.search(r"/out-([^/]+)/", a.get("dn") or "")
        if m and m.group(1) not in out:
            out[m.group(1)] = encap
    return out


def _parse_l3out_vrfs(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[str, str]:
    """L3Out name -> VRF name, from l3extRsEctx (…/out-<L3Out>/…, tDn '…/ctx-<VRF>')."""
    out: Dict[str, str] = {}
    for mo in datasets.get("l3extRsEctx", []):
        a = _attrs(mo, "l3extRsEctx")
        m = re.search(r"/out-([^/]+)/", a.get("dn") or "")
        vrf = _name_after(a.get("tDn"), "ctx-") or a.get("tnFvCtxName")
        if m and vrf:
            out.setdefault(m.group(1), vrf)
    return out


def _learned_ip_macs(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[str, str]:
    """learned endpoint IP -> MAC, from fvIp.dn (…/cep-<MAC>/ip-[<addr>])."""
    out: Dict[str, str] = {}
    for mo in datasets.get("fvIp", []):
        a = _attrs(mo, "fvIp")
        addr = a.get("addr")
        m = re.search(r"/cep-([0-9A-Fa-f:]{17})", a.get("dn") or "")
        if addr and m:
            out[addr] = m.group(1)
    return out


def _lifctx_sides(body: Dict[str, Any], pols: Dict[str, _Pol]) -> Dict[str, Dict[str, Any]]:
    """Parse a vnsLDevCtx body's direct vnsLIfCtx children into consumer/provider sides."""
    sides: Dict[str, Dict[str, Any]] = {}
    idx = 0
    for child in body.get("children", []) or []:
        lif = child.get("vnsLIfCtx")
        if not lif:
            continue
        a = lif.get("attributes", {}) or {}
        conn = (a.get("connNameOrLbl") or "").lower()
        if conn.startswith("cons"):
            side = "consumer"
        elif conn.startswith("prov"):
            side = "provider"
        else:
            side = "consumer" if idx == 0 else "provider"
        idx += 1
        info: Dict[str, Any] = {
            "vrf": _name_after(a.get("ctxDn"), "ctx-"),
            "bd": None,
            "l3out": None,
            "redirect_policy": None,
            "redirect_pol_dn": None,
        }
        for gc, ga in _walk(lif):
            if gc == "vnsRsLIfCtxToBD":
                info["bd"] = _name_after(ga.get("tDn"), "BD-")
            elif gc == "vnsRsLIfCtxToSvcRedirectPol":
                info["redirect_pol_dn"] = ga.get("tDn")
                pol = pols.get(ga.get("tDn"))
                info["redirect_policy"] = pol.name if pol else _name_after(ga.get("tDn"), "svcRedirectPol-")
            elif gc == "vnsRsLIfCtxToInstP":
                tdn = ga.get("tDn") or ""
                l3o = _name_after(tdn, "out-")
                epg = _name_after(tdn, "instP-")
                if l3o or epg:
                    info["l3out"] = [l3o, epg]
        sides[side] = info
    return sides


def _hydrate_node(
    nd: Dict[str, Any],
    pols: Dict[str, _Pol],
    learned_ips: set[str],
    ip_macs: Dict[str, str],
    leaf_map: Dict[str, List[str]],
    encaps: Dict[Tuple[str, str], str],
    l3out_encaps: Dict[str, str],
    l3out_vrfs: Dict[str, str],
) -> _ParsedNode:
    sides = nd["sides"]
    cons = sides.get("consumer", {})
    prov = sides.get("provider", {})

    def _vrf(side: Dict[str, Any]) -> Optional[str]:
        # Prefer the connector's own ctxDn; fall back to the L3Out's VRF.
        if side.get("vrf"):
            return side["vrf"]
        l3o = side.get("l3out")
        return l3out_vrfs.get(l3o[0]) if l3o and l3o[0] else None

    # Collect the policies referenced by this node's connectors.
    pol_dns = [s.get("redirect_pol_dn") for s in (cons, prov) if s.get("redirect_pol_dn")]
    l3: List[Dict[str, Any]] = []
    l1: List[Dict[str, Any]] = []
    chosen: Optional[_Pol] = None
    pol_names: List[str] = []
    for pol_dn in pol_dns:
        pol = pols.get(pol_dn)
        if not pol:
            continue
        if pol.name and pol.name not in pol_names:
            pol_names.append(pol.name)
        l3.extend(pol.l3_dests)
        l1.extend(pol.l1_dests)
        if chosen is None or (pol.threshold_enable and not chosen.threshold_enable):
            chosen = pol

    layer = PbrLayer.L1 if (l1 and not l3) else PbrLayer.L3
    devgrp_dn = nd.get("devgrp")
    devgrp_name = _name_after(devgrp_dn, "lDevVip-")
    leafs = leaf_map.get(devgrp_dn or "", [])

    redirect_dests: List[Dict[str, Any]] = []
    redirect_interfaces: Optional[Dict[str, Any]] = None
    health_dests: List[Dict[str, Any]] = []
    if layer == PbrLayer.L1:
        cons_pol = pols.get(cons.get("redirect_pol_dn"))
        prov_pol = pols.get(prov.get("redirect_pol_dn"))
        redirect_interfaces = {
            "consumer": [
                {"destName": d.get("destName"), "device": devgrp_name, "interface": d.get("interface")}
                for d in (cons_pol.l1_dests if cons_pol else [])
            ],
            "provider": [
                {"destName": d.get("destName"), "device": devgrp_name, "interface": d.get("interface")}
                for d in (prov_pol.l1_dests if prov_pol else [])
            ],
        }
        resolved = bool(redirect_interfaces["consumer"] or redirect_interfaces["provider"])
        health_dests = [{"layer": "L1", "resolved": resolved}] if resolved else []
    else:
        # Keep the IN (consumer policy) and OUT (provider policy) redirect destinations
        # distinct, so the node card can label which direction each IP belongs to.
        for pol_side, pol_dn in (("in", cons.get("redirect_pol_dn")), ("out", prov.get("redirect_pol_dn"))):
            pol = pols.get(pol_dn)
            if not pol:
                continue
            seen = set()
            for d in pol.l3_dests:
                ip = d.get("ip")
                if not ip or ip in seen:
                    continue
                seen.add(ip)
                active = ip in learned_ips
                redirect_dests.append(
                    {
                        "ip": ip,
                        "configured_mac": d.get("mac"),
                        "learned_mac": ip_macs.get(ip, "00:00:00:00:00:00"),
                        "active": active,
                        "side": pol_side,
                    }
                )
                health_dests.append({"ip": ip, "learned": active, "layer": "L3"})

    # Active % + breach (L3 only), computed for display in the node card.
    active_pct: Optional[float] = None
    breached = False
    if layer == PbrLayer.L3 and redirect_dests:
        active_pct = round(sum(1 for d in redirect_dests if d["active"]) / len(redirect_dests) * 100)
        if chosen and chosen.threshold_enable and chosen.min_pct is not None:
            breached = active_pct < chosen.min_pct

    threshold = {
        "enable": bool(chosen and chosen.threshold_enable),
        "min": chosen.min_pct if chosen else 0,
        "max": chosen.max_pct if chosen else 0,
        "action": (chosen.action.value if chosen else PbrThresholdAction.UNKNOWN.value),
        "active_pct": active_pct,
        "breached": breached,
    }

    def _encap(side: Dict[str, Any]) -> Optional[str]:
        # L1 connectors carry no VLAN tag; L3 BD-side comes from vnsEPpInfo; L3Out-side
        # comes from the L3Out logical-interface path attachment.
        if layer == PbrLayer.L1:
            return "L1 (no VLAN)"
        bd = side.get("bd")
        if bd:
            enc = encaps.get((devgrp_name or "", bd))
            if enc:
                return enc
        l3o = side.get("l3out")
        if l3o and l3o[0]:
            return l3out_encaps.get(l3o[0])
        return None

    detail = {
        "node": nd.get("node_name"),
        "devgrp": devgrp_name,
        "leafs": leafs,
        "device_layer": layer.value,
        "consumer_bd": cons.get("bd"),
        "consumer_l3out": cons.get("l3out"),
        "consumer_vrf": _vrf(cons),
        "consumer_lif_encap": _encap(cons),
        "consumer_redirect_policy": cons.get("redirect_policy"),
        "provider_bd": prov.get("bd"),
        "provider_l3out": prov.get("l3out"),
        "provider_vrf": _vrf(prov),
        "provider_lif_encap": _encap(prov),
        "provider_redirect_policy": prov.get("redirect_policy"),
        "redirect_dests": redirect_dests,
        "redirect_interfaces": redirect_interfaces,
        "threshold": threshold,
    }

    return _ParsedNode(
        dn=nd["dn"] or "",
        name=nd.get("node_name"),
        layer=layer,
        device_group_dn=devgrp_dn,
        device_group_name=devgrp_name,
        redirect_policy_names=pol_names,
        threshold_enable=bool(chosen and chosen.threshold_enable and layer == PbrLayer.L3),
        min_threshold_pct=chosen.min_pct if chosen else None,
        max_threshold_pct=chosen.max_pct if chosen else None,
        threshold_down_action=chosen.action if chosen else PbrThresholdAction.UNKNOWN,
        active_pct=active_pct,
        dests=health_dests,
        detail=detail,
        raw=nd.get("raw", {}),
    )


def _parse_ldevctx(
    datasets: Dict[str, List[Dict[str, Any]]], pols: Dict[str, _Pol]
) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    """(contract_name, graph_name) -> list of node descriptors with consumer/provider sides."""
    by_svc: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for mo in datasets.get("vnsLDevCtx", []):
        body = mo.get("vnsLDevCtx", {})
        a = body.get("attributes", {}) or {}
        cname = a.get("ctrctNameOrLbl")
        gname = a.get("graphNameOrLbl")
        if not cname or not gname:
            continue
        devgrp = None
        for cls, ca in _walk(body):
            if cls == "vnsRsLDevCtxToLDev":
                devgrp = ca.get("tDn")
                break
        by_svc.setdefault((cname, gname), []).append(
            {
                "dn": a.get("dn"),
                "node_name": a.get("nodeNameOrLbl"),
                "devgrp": devgrp,
                "sides": _lifctx_sides(body, pols),
                "raw": a,
            }
        )
    return by_svc


def _epg_groups(
    epg_dns: List[str], subnets_by_epg: Dict[str, List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """Build the prototype's per-EPG group: {l3out, epg, subnets[], excluded_subnets[],
    default_v4, default_v6} (scope-valid subnets vs route-control-only excluded)."""
    groups: List[Dict[str, Any]] = []
    for epg_dn in epg_dns:
        subs = subnets_by_epg.get(epg_dn, [])
        valid = [s["prefix"] for s in subs if s["scope_valid"]]
        excluded = [s["prefix"] for s in subs if not s["scope_valid"]]
        groups.append(
            {
                "l3out": _name_after(epg_dn, "out-") or "—",
                "epg": _epg_short_name(epg_dn) or "—",
                "subnets": valid,
                "excluded_subnets": excluded,
                "default_v4": any(s["prefix"] == "0.0.0.0/0" and s["scope_valid"] for s in subs),
                "default_v6": any(s["prefix"] == "::/0" and s["scope_valid"] for s in subs),
            }
        )
    return groups


def build_services(datasets: Dict[str, List[Dict[str, Any]]], learned_ips: Optional[set[str]] = None) -> List[_ParsedService]:
    """Apply the intersection rule (on contract+graph NAME) and hydrate nodes + EPG groups."""
    learned_ips = learned_ips or set()
    pols = _parse_redirect_policies(datasets)
    epgs = _resolve_epgs(datasets)
    ldev = _parse_ldevctx(datasets, pols)
    leaf_map = _parse_leafs(datasets)
    ip_macs = _learned_ip_macs(datasets)
    encaps = _parse_encaps(datasets)
    l3out_encaps = _parse_l3out_encaps(datasets)
    l3out_vrfs = _parse_l3out_vrfs(datasets)

    # l3extSubnet grouped by owning external-EPG DN, tagged scope-valid.
    subnets_by_epg: Dict[str, List[Dict[str, Any]]] = {}
    for mo in datasets.get("l3extSubnet", []):
        a = _attrs(mo, "l3extSubnet")
        prefix = a.get("ip")
        if not prefix:
            continue
        epg_dn = (a.get("dn") or "").split("/extsubnet-")[0]
        subnets_by_epg.setdefault(epg_dn, []).append(
            {"prefix": prefix, "scope_valid": scope_is_valid(a.get("scope"))}
        )

    graph_meta: Dict[Tuple[str, str], Dict[str, Optional[str]]] = {}
    for mo in datasets.get("vnsGraphInst", []):
        a = _attrs(mo, "vnsGraphInst")
        cname = _name_after(a.get("ctrctDn"), "brc-")
        gname = _name_after(a.get("graphDn"), "AbsGraph-")
        if cname and gname:
            graph_meta[(cname, gname)] = {"ctrctDn": a.get("ctrctDn"), "graphDn": a.get("graphDn")}

    # Intersection rule: present in BOTH vnsGraphInst AND vnsLDevCtx.
    keys = set(graph_meta) & set(ldev)

    services: List[_ParsedService] = []
    for (cname, gname) in sorted(keys):
        meta = graph_meta[(cname, gname)]
        epg = epgs.get(cname, {"provider": [], "consumer": []})
        consumer_groups = _epg_groups(epg["consumer"], subnets_by_epg)
        provider_groups = _epg_groups(epg["provider"], subnets_by_epg)
        provider_dn = epg["provider"][0] if epg["provider"] else None
        consumer_dn = epg["consumer"][0] if epg["consumer"] else None
        nodes = [
            _hydrate_node(nd, pols, learned_ips, ip_macs, leaf_map, encaps, l3out_encaps, l3out_vrfs)
            for nd in ldev[(cname, gname)]
        ]
        nodes.sort(key=lambda n: n.name or "")
        services.append(
            _ParsedService(
                contract_dn=meta.get("ctrctDn") or cname,
                graph_dn=meta.get("graphDn") or gname,
                contract_name=cname,
                graph_name=gname,
                consumer_epg_dn=consumer_dn,
                provider_epg_dn=provider_dn,
                consumer_epg_name=_epg_short_name(consumer_dn),
                provider_epg_name=_epg_short_name(provider_dn),
                consumer_epg_dns=list(epg["consumer"]),
                provider_epg_dns=list(epg["provider"]),
                consumer_epgs=consumer_groups,
                provider_epgs=provider_groups,
                nodes=nodes,
                raw={"contract": cname, "graph": gname},
            )
        )
    return services


def classify_subnets(
    datasets: Dict[str, List[Dict[str, Any]]], services: Sequence[_ParsedService]
) -> List[Dict[str, Any]]:
    """Tag every l3extSubnet with scope_valid / is_default_route and link it to a
    service+side when its owning external EPG matches a service's consumer/provider EPG.

    Invalid-scope subnets are retained (transparency) but flagged so they never resolve a
    flow (SDD §7.3.3). `svc_key`/`side` carry the logical link resolved to ids at persist.
    """
    # epg_dn -> list of (service_key, side)
    epg_index: Dict[str, List[Tuple[Tuple[str, str], str]]] = {}
    for svc in services:
        key = (svc.contract_name or "", svc.graph_name or "")
        for epg_dn in svc.consumer_epg_dns:
            epg_index.setdefault(epg_dn, []).append((key, "consumer"))
        for epg_dn in svc.provider_epg_dns:
            epg_index.setdefault(epg_dn, []).append((key, "provider"))

    out: List[Dict[str, Any]] = []
    for mo in datasets.get("l3extSubnet", []):
        a = _attrs(mo, "l3extSubnet")
        prefix = a.get("ip")
        if not prefix:
            continue
        dn = a.get("dn") or ""
        epg_dn = dn.split("/extsubnet-")[0]
        links = epg_index.get(epg_dn, [(None, None)])
        for (svc_key, side) in links:
            out.append(
                {
                    "prefix": prefix,
                    "scope": a.get("scope"),
                    "scope_valid": scope_is_valid(a.get("scope")),
                    "is_default_route": is_default_route(prefix),
                    "epg_dn": epg_dn,
                    "svc_key": svc_key,
                    "side": side,
                    "raw": a,
                }
            )
    return out


def _learned_ips(fv_ips: List[Dict[str, Any]]) -> set[str]:
    ips: set[str] = set()
    for mo in fv_ips:
        addr = _attrs(mo, "fvIp").get("addr")
        if addr:
            ips.add(addr)
    return ips


# --------------------------------------------------------------------------- #
# Collection orchestration
# --------------------------------------------------------------------------- #


async def collect_pbr_for_job(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    password_override: Optional[str] = None,
) -> PbrCollectionResult:
    """Ingest one ACI fabric's PBR state and persist it. Read-only against APIC."""
    timestamp = datetime.now(timezone.utc)

    if job.fabric_type != TelcoFabricType.ACI:
        return PbrCollectionResult(True, timestamp, snapshot={"skipped": "non-aci fabric"})
    if not job.username:
        return PbrCollectionResult(False, timestamp, message="Username is required for ACI fabrics.")

    password = password_override
    if password is None:
        if job.password_secret is None:
            return PbrCollectionResult(False, timestamp, message="No credentials stored for this fabric.")
        password = decrypt_secret(job.password_secret)

    base_url = _build_base_url(job, default_scheme=job.connection_params.get("protocol", "https"))
    # Fail fast on an unreachable APIC (short connect) so one dead fabric can't stall
    # the whole poll tick; allow long reads for the big class queries.
    timeout = httpx.Timeout(90.0, connect=8.0)

    try:
        async with httpx.AsyncClient(base_url=base_url, verify=job.verify_ssl, timeout=timeout) as client:
            await _apic_login(client, job.username, password)
            datasets = await _fetch_all(client)
    except PbrPartialFetchError as exc:
        logger.warning("PBR partial fetch for fabric %s: %s", job.id, exc)
        return PbrCollectionResult(False, timestamp, message=str(exc))
    except httpx.HTTPError as exc:
        # Unreachable APIC etc.: keep last-known state (stale-safety, SDD §10.4).
        logger.warning("PBR collection HTTP error for fabric %s: %s", job.id, exc)
        return PbrCollectionResult(False, timestamp, message=str(exc))

    learned = _learned_ips(datasets.get("fvIp", []))
    services = build_services(datasets, learned)
    subnets = classify_subnets(datasets, services)

    snapshot = await _persist(session, job, services, subnets, learned, timestamp)
    return PbrCollectionResult(True, timestamp, snapshot=snapshot)


async def _persist(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    services: List[_ParsedService],
    subnets: List[Dict[str, Any]],
    learned_ips: set[str],
    timestamp: datetime,
) -> Dict[str, Any]:
    """Upsert this fabric's PBR rows, computing health.

    Services are keyed by (contract_dn, graph_dn) and kept with a STABLE id so
    pbr_health_samples accumulate a real per-service trend (a delete+reinsert would
    mint a new id each poll and orphan history). Child rows are deleted explicitly
    because SQLite FK cascade is not enforced in this environment.
    """
    existing = {
        (s.contract_dn, s.graph_dn): s
        for s in (
            await session.execute(select(PbrService).where(PbrService.fabric_job_id == job.id))
        ).scalars().all()
    }

    async def _clear_nodes(service_id: Any) -> None:
        node_ids = (
            await session.execute(select(PbrNode.id).where(PbrNode.service_id == service_id))
        ).scalars().all()
        if node_ids:
            await session.execute(delete(PbrRedirectDest).where(PbrRedirectDest.node_id.in_(node_ids)))
            await session.execute(delete(PbrNode).where(PbrNode.service_id == service_id))

    seen: set = set()
    service_id_by_key: Dict[Tuple[str, str], Any] = {}
    service_count = 0
    node_count = 0
    for svc in services:
        node_healths: List[compute.NodeHealth] = []
        key = (svc.contract_dn, svc.graph_dn)
        seen.add(key)
        db_service = existing.get(key)
        if db_service is None:
            db_service = PbrService(fabric_job_id=job.id, contract_dn=svc.contract_dn, graph_dn=svc.graph_dn)
            session.add(db_service)
            await session.flush()  # get id
        else:
            await _clear_nodes(db_service.id)  # refresh this service's nodes in place
        db_service.contract_name = svc.contract_name
        db_service.graph_name = svc.graph_name
        db_service.consumer_epg_dn = svc.consumer_epg_dn
        db_service.provider_epg_dn = svc.provider_epg_dn
        db_service.consumer_epg_name = svc.consumer_epg_name
        db_service.provider_epg_name = svc.provider_epg_name
        db_service.consumer_epgs = svc.consumer_epgs
        db_service.provider_epgs = svc.provider_epgs
        db_service.stale_as_of = timestamp
        db_service.raw_attributes = svc.raw
        service_id_by_key[(svc.contract_name or "", svc.graph_name or "")] = db_service.id

        for node in svc.nodes:
            configured = len(node.dests)
            learned_count = sum(
                1 for d in node.dests if d.get("learned") or d.get("resolved")
            )
            resolved = any(d.get("resolved") for d in node.dests) if node.layer == PbrLayer.L1 else False
            node_input = compute.NodeInput(
                layer=node.layer,
                configured_dest_count=configured,
                learned_dest_count=learned_count,
                threshold_enable=node.threshold_enable,
                min_threshold_pct=node.min_threshold_pct,
                threshold_down_action=node.threshold_down_action,
                l1_interface_resolved=resolved,
            )
            health = compute.evaluate_node(node_input)
            node_healths.append(health)

            d = node.detail
            db_node = PbrNode(
                fabric_job_id=job.id,
                service_id=db_service.id,
                distinguished_name=node.dn,
                name=node.name,
                layer=node.layer,
                device_group_dn=node.device_group_dn,
                device_group_name=node.device_group_name,
                leaf=",".join(d.get("leafs") or []) or None,
                consumer_bd=d.get("consumer_bd"),
                consumer_vrf=d.get("consumer_vrf"),
                consumer_vlan=d.get("consumer_lif_encap"),
                provider_bd=d.get("provider_bd"),
                provider_vrf=d.get("provider_vrf"),
                provider_vlan=d.get("provider_lif_encap"),
                redirect_policy_names=node.redirect_policy_names,
                threshold_enable=node.threshold_enable,
                min_threshold_pct=node.min_threshold_pct,
                max_threshold_pct=node.max_threshold_pct,
                threshold_down_action=node.threshold_down_action,
                configured_dest_count=configured,
                learned_dest_count=learned_count,
                health_pct=health.health_pct,
                live_status=health.live_status,
                bypassed=health.bypassed,
                active_pct=node.active_pct,
                detail=node.detail,
                raw_attributes=node.raw,
            )
            session.add(db_node)
            await session.flush()
            for rd in node.detail.get("redirect_dests", []):
                session.add(
                    PbrRedirectDest(
                        node_id=db_node.id,
                        ip=rd.get("ip"),
                        mac=rd.get("configured_mac"),
                        layer=node.layer,
                        resolved=bool(rd.get("active")),
                        learned=bool(rd.get("active")),
                        raw_attributes=rd,
                    )
                )
            node_count += 1

        health_pct, state = compute.service_health(node_healths)
        db_service.health_pct = health_pct
        db_service.state = state
        session.add(
            PbrHealthSample(
                service_id=db_service.id,
                sampled_at=timestamp,
                health_pct=health_pct,
                state=state,
                node_snapshot=[
                    {"status": h.live_status.value, "health_pct": h.health_pct, "bypassed": h.bypassed}
                    for h in node_healths
                ],
            )
        )
        service_count += 1

    # Prune services that no longer exist in the fabric (+ their nodes/dests/samples).
    for key, s in existing.items():
        if key in seen:
            continue
        await _clear_nodes(s.id)
        await session.execute(delete(PbrHealthSample).where(PbrHealthSample.service_id == s.id))
        await session.execute(delete(PbrService).where(PbrService.id == s.id))

    # Self-healing cleanup of any orphaned child rows (e.g. legacy rows left behind
    # before this upsert fix, since SQLite FK cascade isn't enforced).
    live_services = select(PbrService.id)
    live_nodes = select(PbrNode.id)
    await session.execute(delete(PbrNode).where(PbrNode.service_id.notin_(live_services)))
    await session.execute(delete(PbrHealthSample).where(PbrHealthSample.service_id.notin_(live_services)))
    await session.execute(delete(PbrRedirectDest).where(PbrRedirectDest.node_id.notin_(live_nodes)))

    # Subnets carry no history -> full replace for the fabric.
    await session.execute(delete(PbrSubnet).where(PbrSubnet.fabric_job_id == job.id))
    for sn in subnets:
        svc_key = sn.get("svc_key")
        session.add(
            PbrSubnet(
                fabric_job_id=job.id,
                service_id=service_id_by_key.get(svc_key) if svc_key else None,
                side=sn.get("side"),
                prefix=sn["prefix"],
                scope=sn.get("scope"),
                scope_valid=sn["scope_valid"],
                is_default_route=sn["is_default_route"],
                epg_dn=sn.get("epg_dn"),
                raw_attributes=sn.get("raw", {}),
            )
        )

    await session.flush()
    return {
        "service_count": service_count,
        "node_count": node_count,
        "subnet_count": len(subnets),
        "scope_valid_subnets": sum(1 for s in subnets if s["scope_valid"]),
    }


# --------------------------------------------------------------------------- #
# Poller (follows NxosPoller's robust shutdown + per-item DB-lock retry)
# --------------------------------------------------------------------------- #


class PbrPoller:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], tick_seconds: int = 60) -> None:
        self._session_factory = session_factory
        self._tick_seconds = tick_seconds
        self._shutdown = asyncio.Event()
        self._task: Optional[asyncio.Task[None]] = None
        # Per-fabric last-poll time (in-memory) so we honour poll_interval_seconds
        # instead of polling every tick — the every-tick behaviour overloaded large
        # APICs (503) and left big fabrics silently empty. Resets on restart.
        self._last_polled: Dict[str, datetime] = {}

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._shutdown.clear()
        self._task = asyncio.create_task(self._run(), name="pbr-poller")
        logger.info("PBR poller started (tick=%ss)", self._tick_seconds)

    async def stop(self) -> None:
        self._shutdown.set()
        if self._task:
            await self._task
            logger.info("PBR poller stopped")

    async def _run(self) -> None:
        # A failed tick (e.g. a transient DB lock) must NOT kill the loop — catch inside
        # the loop and keep polling on the next interval.
        while not self._shutdown.is_set():
            try:
                await self._tick()
            except Exception:  # noqa: BLE001 - keep the poller alive across any tick error
                logger.exception("PBR poller tick failed; retrying next interval")
            try:
                await asyncio.wait_for(self._shutdown.wait(), timeout=self._tick_seconds)
            except asyncio.TimeoutError:
                pass

    async def _tick(self) -> None:
        async with self._session() as session:
            result = await session.execute(
                select(TelcoFabricOnboardingJob).where(
                    TelcoFabricOnboardingJob.fabric_type == TelcoFabricType.ACI
                )
            )
            # Pre-filter by the per-fabric interval; record the attempt up-front so a
            # failing fabric is retried on its interval, not hammered every tick.
            jobs = [j for j in result.scalars().all() if self._should_poll(j)]
            for job in jobs:
                self._last_polled[str(job.id)] = datetime.now(timezone.utc)
                for attempt in range(3):
                    try:
                        res = await collect_pbr_for_job(session, job)
                        await session.commit()
                        if res is not None and res.success:
                            logger.info("PBR poll ok fabric=%s %s", job.name, res.snapshot)
                        elif res is not None:
                            logger.warning("PBR poll kept last-known fabric=%s: %s", job.name, res.message)
                        break
                    except OperationalError as exc:  # SQLite "database is locked"
                        await session.rollback()
                        if "locked" in str(exc).lower() and attempt < 2:
                            await asyncio.sleep(0.5 * (attempt + 1))
                            continue
                        logger.warning("PBR poll DB error for fabric %s: %s", job.name, exc)
                        break
                    except Exception:  # never let one fabric kill the tick
                        await session.rollback()
                        logger.exception("PBR poll failed for fabric %s", job.name)
                        break

    def _should_poll(self, job: TelcoFabricOnboardingJob) -> bool:
        if job.poll_interval_seconds <= 0:
            return False
        if job.status not in (TelcoOnboardingStatus.READY, TelcoOnboardingStatus.FAILED):
            return False
        # Honour the per-fabric interval (SDD §7.2) instead of every tick — polling
        # every tick overloaded large APICs. First run after start polls now.
        last = self._last_polled.get(str(job.id))
        if last is None:
            return True
        return (datetime.now(timezone.utc) - last).total_seconds() >= job.poll_interval_seconds

    @asynccontextmanager
    async def _session(self) -> AsyncGenerator[AsyncSession, None]:
        session = self._session_factory()
        try:
            yield session
        finally:
            await session.close()


def build_pbr_poller(
    session_factory: async_sessionmaker[AsyncSession], tick_seconds: int
) -> PbrPoller:
    return PbrPoller(session_factory=session_factory, tick_seconds=tick_seconds)
