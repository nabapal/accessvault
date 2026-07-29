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
    "vnsSvcRedirectPol": {"subtree": False, "verify": False},
    "vnsRedirectDest": {"subtree": False, "verify": False},
    "vnsL1L2RedirectDest": {"subtree": False, "verify": False},
    "l3extSubnet": {"subtree": False, "verify": False},
    "fvRsProv": {"subtree": False, "verify": True},   # count-verified (Bug #3)
    "fvRsCons": {"subtree": False, "verify": True},   # count-verified (Bug #3)
    "fvIp": {"subtree": False, "verify": False},
}

_PBR_FETCH_CONCURRENCY = 2


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
    response = await _apic_get_with_retry(client, path)
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
    consumer_bd: Optional[str]
    redirect_policy_names: List[str] = field(default_factory=list)
    threshold_enable: bool = False
    min_threshold_pct: Optional[float] = None
    max_threshold_pct: Optional[float] = None
    threshold_down_action: PbrThresholdAction = PbrThresholdAction.UNKNOWN
    dests: List[Dict[str, Any]] = field(default_factory=list)
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
            pols[parent].l1_dests.append({"ref": dn, "name": a.get("destName") or a.get("name")})
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


def _parse_ldevctx(datasets: Dict[str, List[Dict[str, Any]]]) -> Dict[Tuple[str, str], List[Dict[str, Any]]]:
    """(contract_name, graph_name) -> list of raw node descriptors from vnsLDevCtx subtree."""
    by_svc: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for mo in datasets.get("vnsLDevCtx", []):
        body = mo.get("vnsLDevCtx", {})
        a = body.get("attributes", {}) or {}
        cname = a.get("ctrctNameOrLbl")
        gname = a.get("graphNameOrLbl")
        if not cname or not gname:
            continue
        devgrp = None
        redirect_pol_dns: List[str] = []
        bds: List[str] = []
        for cls, ca in _walk(body):
            if cls == "vnsRsLDevCtxToLDev":
                devgrp = ca.get("tDn")
            elif cls == "vnsRsLIfCtxToSvcRedirectPol":
                tdn = ca.get("tDn")
                if tdn and tdn not in redirect_pol_dns:
                    redirect_pol_dns.append(tdn)
            elif cls == "vnsRsLIfCtxToBD":
                if ca.get("tDn"):
                    bds.append(ca.get("tDn"))
        by_svc.setdefault((cname, gname), []).append(
            {
                "dn": a.get("dn"),
                "node_name": a.get("nodeNameOrLbl"),
                "devgrp": devgrp,
                "redirect_pol_dns": redirect_pol_dns,
                "bds": bds,
                "raw": a,
            }
        )
    return by_svc


def _hydrate_node(nd: Dict[str, Any], pols: Dict[str, _Pol], learned_ips: set[str]) -> _ParsedNode:
    pol_names: List[str] = []
    l3: List[Dict[str, Any]] = []
    l1: List[Dict[str, Any]] = []
    chosen: Optional[_Pol] = None
    for pol_dn in nd["redirect_pol_dns"]:
        pol = pols.get(pol_dn)
        if not pol:
            continue
        if pol.name:
            pol_names.append(pol.name)
        l3.extend(pol.l3_dests)
        l1.extend(pol.l1_dests)
        # Prefer a threshold-enabled policy for the node's threshold summary.
        if chosen is None or (pol.threshold_enable and not chosen.threshold_enable):
            chosen = pol

    layer = PbrLayer.L1 if (l1 and not l3) else PbrLayer.L3
    dests: List[Dict[str, Any]] = []
    if layer == PbrLayer.L1:
        for d in l1:
            dests.append({"layer": "L1", "l1_ref": d.get("ref"), "resolved": True, "raw": d})
    else:
        for d in l3:
            ip = d.get("ip")
            dests.append({"ip": ip, "mac": d.get("mac"), "layer": "L3", "learned": ip in learned_ips, "raw": d})

    devgrp_dn = nd.get("devgrp")
    return _ParsedNode(
        dn=nd["dn"] or "",
        name=nd.get("node_name"),
        layer=layer,
        device_group_dn=devgrp_dn,
        device_group_name=_name_after(devgrp_dn, "lDevVip-"),
        consumer_bd=_name_after(nd["bds"][0], "BD-") if nd.get("bds") else None,
        redirect_policy_names=pol_names,
        threshold_enable=bool(chosen and chosen.threshold_enable and layer == PbrLayer.L3),
        min_threshold_pct=chosen.min_pct if chosen else None,
        max_threshold_pct=chosen.max_pct if chosen else None,
        threshold_down_action=chosen.action if chosen else PbrThresholdAction.UNKNOWN,
        dests=dests,
        raw=nd.get("raw", {}),
    )


def build_services(datasets: Dict[str, List[Dict[str, Any]]], learned_ips: Optional[set[str]] = None) -> List[_ParsedService]:
    """Apply the intersection rule (on contract+graph NAME) and hydrate nodes + EPGs."""
    learned_ips = learned_ips or set()
    pols = _parse_redirect_policies(datasets)
    epgs = _resolve_epgs(datasets)
    ldev = _parse_ldevctx(datasets)

    # vnsGraphInst keyed by (contract_name, graph_name); keep the real DNs.
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
        provider_dn = epg["provider"][0] if epg["provider"] else None
        consumer_dn = epg["consumer"][0] if epg["consumer"] else None
        nodes = [_hydrate_node(nd, pols, learned_ips) for nd in ldev[(cname, gname)]]
        # Order nodes by name (N1, N2, …) for a stable topology.
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
        if svc.consumer_epg_dn:
            epg_index.setdefault(svc.consumer_epg_dn, []).append((key, "consumer"))
        if svc.provider_epg_dn:
            epg_index.setdefault(svc.provider_epg_dn, []).append((key, "provider"))

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
    timeout = httpx.Timeout(30.0, read=90.0)

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
    """Replace this fabric's PBR rows with the freshly-collected set, computing health."""
    await session.execute(delete(PbrSubnet).where(PbrSubnet.fabric_job_id == job.id))
    await session.execute(delete(PbrService).where(PbrService.fabric_job_id == job.id))
    await session.flush()

    service_id_by_key: Dict[Tuple[str, str], Any] = {}
    service_count = 0
    node_count = 0
    for svc in services:
        node_healths: List[compute.NodeHealth] = []
        db_service = PbrService(
            fabric_job_id=job.id,
            contract_dn=svc.contract_dn,
            graph_dn=svc.graph_dn,
            contract_name=svc.contract_name,
            graph_name=svc.graph_name,
            consumer_epg_dn=svc.consumer_epg_dn,
            provider_epg_dn=svc.provider_epg_dn,
            consumer_epg_name=svc.consumer_epg_name,
            provider_epg_name=svc.provider_epg_name,
            stale_as_of=timestamp,
            raw_attributes=svc.raw,
        )
        session.add(db_service)
        await session.flush()  # get id
        service_id_by_key[(svc.contract_name or "", svc.graph_name or "")] = db_service.id

        for node in svc.nodes:
            configured = len(node.dests)
            learned_count = sum(
                1 for d in node.dests if (d.get("ip") in learned_ips) or d.get("learned")
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

            db_node = PbrNode(
                fabric_job_id=job.id,
                service_id=db_service.id,
                distinguished_name=node.dn,
                name=node.name,
                layer=node.layer,
                device_group_dn=node.device_group_dn,
                device_group_name=node.device_group_name,
                consumer_bd=node.consumer_bd,
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
                raw_attributes=node.raw,
            )
            session.add(db_node)
            await session.flush()
            for d in node.dests:
                session.add(
                    PbrRedirectDest(
                        node_id=db_node.id,
                        ip=d.get("ip"),
                        mac=d.get("mac"),
                        layer=PbrLayer.from_raw(d.get("layer")) if isinstance(d.get("layer"), str) else node.layer,
                        l1_interface_ref=d.get("l1_ref"),
                        resolved=bool(d.get("resolved")),
                        learned=bool((d.get("ip") in learned_ips) or d.get("learned")),
                        raw_attributes=d.get("raw", {}),
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
        try:
            while not self._shutdown.is_set():
                await self._tick()
                try:
                    await asyncio.wait_for(self._shutdown.wait(), timeout=self._tick_seconds)
                except asyncio.TimeoutError:
                    pass
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("PBR poller encountered an unexpected error")

    async def _tick(self) -> None:
        async with self._session() as session:
            result = await session.execute(
                select(TelcoFabricOnboardingJob).where(
                    TelcoFabricOnboardingJob.fabric_type == TelcoFabricType.ACI
                )
            )
            jobs = result.scalars().all()
            for job in jobs:
                if not self._should_poll(job):
                    continue
                for attempt in range(3):
                    try:
                        await collect_pbr_for_job(session, job)
                        await session.commit()
                        break
                    except OperationalError as exc:  # SQLite "database is locked"
                        await session.rollback()
                        if "locked" in str(exc).lower() and attempt < 2:
                            await asyncio.sleep(0.5 * (attempt + 1))
                            continue
                        logger.warning("PBR poll DB error for fabric %s: %s", job.id, exc)
                        break
                    except Exception:  # pragma: no cover - never let one fabric kill the tick
                        await session.rollback()
                        logger.exception("PBR poll failed for fabric %s", job.id)
                        break

    def _should_poll(self, job: TelcoFabricOnboardingJob) -> bool:
        if job.poll_interval_seconds <= 0:
            return False
        return job.status in (TelcoOnboardingStatus.READY, TelcoOnboardingStatus.FAILED)

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
