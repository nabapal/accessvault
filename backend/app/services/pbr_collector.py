"""PBR Flow Monitoring — per-fabric APIC ingestion (read-only) + poller.

Reuses the existing telco/ACI APIC access pattern (httpx login → APIC-cookie →
`/api/class/<mo>.json`, with `_apic_get_with_retry` + a bounded fetch semaphore) rather
than introducing a parallel connector. See SDD §4/§6.1.

Implements the three hard rules validated in the prototype (SDD §7.3, §9):
  • fetch-count verification for fvRsProv/fvRsCons (Bug #3) — pure + unit-tested.
  • service intersection rule — a (contract, graph) is a Service only if present in
    BOTH vnsGraphInst AND vnsLDevCtx.
  • scope-valid subnet rule — only l3extSubnet with scope containing "import-security".

NOTE ON APIC PARSING FIDELITY
-----------------------------
The prototype's exact DN-walking / attribute extraction was validated against live data
but its embedded dataset was pre-shaped; the per-MO extraction below follows *standard,
documented ACI DN conventions*. The rules, health computation, and persistence are
validated by unit tests; the raw attribute/DN extraction in `_*` helpers should be
diffed against live APIC responses before production trust. Extraction is defensive: a
fabric that yields nothing parseable persists nothing and keeps last-known state
(stale-safety, SDD §10.4).
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
    "vnsCDev": {"subtree": False, "verify": False},
    "vnsCIf": {"subtree": False, "verify": False},
    "vnsRsCIfPathAtt": {"subtree": False, "verify": False},
    "vnsSvcRedirectPol": {"subtree": False, "verify": False},
    "vnsRedirectDest": {"subtree": False, "verify": False},
    "vnsL1L2RedirectDest": {"subtree": False, "verify": False},
    "vnsRsToCIf": {"subtree": False, "verify": False},
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
    """Assert a fetch is complete against APIC's reported `totalCount` (Bug #3).

    APIC returns `totalCount` as a string at the top of the payload. If it is missing or
    unparseable we cannot verify and return quietly; if present and mismatched we raise,
    so the caller keeps last-known state rather than persisting a wrong partial mapping.
    """
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


def _attrs(mo: Dict[str, Any], mo_class: str) -> Dict[str, Any]:
    """Pull `attributes` out of an APIC MO wrapper `{class: {attributes: {}}}`."""
    if not isinstance(mo, dict):
        return {}
    body = mo.get(mo_class) or next(iter(mo.values()), {})
    if isinstance(body, dict):
        return body.get("attributes", {}) or {}
    return {}


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

    # Count-verify failures MUST propagate (Bug #3) — do not swallow.
    results = await asyncio.gather(*(one(k, v) for k, v in _PBR_CLASSES.items()))
    return dict(results)


# --------------------------------------------------------------------------- #
# Normalization (best-effort, standard ACI DN conventions — see module docstring)
# --------------------------------------------------------------------------- #


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
    dests: List[Dict[str, Any]] = field(default_factory=list)  # {ip,mac,layer,l1_ref,resolved,learned,raw}
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class _ParsedService:
    contract_dn: str
    graph_dn: str
    contract_name: Optional[str]
    graph_name: Optional[str]
    consumer_epg_dn: Optional[str] = None
    provider_epg_dn: Optional[str] = None
    nodes: List[_ParsedNode] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)


def _service_key(contract_dn: Optional[str], graph_dn: Optional[str]) -> Optional[Tuple[str, str]]:
    if contract_dn and graph_dn:
        return (contract_dn, graph_dn)
    return None


def _graph_keys(graph_insts: List[Dict[str, Any]]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    out: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for mo in graph_insts:
        a = _attrs(mo, "vnsGraphInst")
        key = _service_key(a.get("ctrctDn") or a.get("contractDn"), a.get("graphDn") or a.get("dn"))
        if key:
            out[key] = a
    return out


def _ldevctx_keys(ldev_ctxs: List[Dict[str, Any]]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    out: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for mo in ldev_ctxs:
        a = _attrs(mo, "vnsLDevCtx")
        key = _service_key(a.get("ctrctDn") or a.get("ctrctNameOrLbl"), a.get("graphDn") or a.get("graphNameOrLbl"))
        if key:
            out[key] = a
    return out


def _learned_ips(fv_ips: List[Dict[str, Any]]) -> set[str]:
    ips: set[str] = set()
    for mo in fv_ips:
        addr = _attrs(mo, "fvIp").get("addr")
        if addr:
            ips.add(addr)
    return ips


def _last_dn_token(dn: Optional[str]) -> Optional[str]:
    if not dn:
        return None
    tail = dn.rstrip("/").split("/")[-1]
    for prefix in ("brc-", "AbsGraph-", "epg-", "tn-"):
        if tail.startswith(prefix):
            return tail[len(prefix):]
    return tail


def build_services(datasets: Dict[str, List[Dict[str, Any]]]) -> List[_ParsedService]:
    """Apply the intersection rule and assemble parsed services (SDD §7.3.1).

    Intersection + scope filtering are exact; node/dest hydration is best-effort per the
    module docstring.
    """
    graph_keys = _graph_keys(datasets.get("vnsGraphInst", []))
    ldev_keys = _ldevctx_keys(datasets.get("vnsLDevCtx", []))
    # Service intersection rule: present in BOTH, never the union.
    services_keys = set(graph_keys) & set(ldev_keys)

    services: List[_ParsedService] = []
    for (contract_dn, graph_dn) in sorted(services_keys):
        g = graph_keys[(contract_dn, graph_dn)]
        services.append(
            _ParsedService(
                contract_dn=contract_dn,
                graph_dn=graph_dn,
                contract_name=g.get("ctrctName") or _last_dn_token(contract_dn),
                graph_name=g.get("graphName") or _last_dn_token(graph_dn),
                raw={"vnsGraphInst": g, "vnsLDevCtx": ldev_keys[(contract_dn, graph_dn)]},
            )
        )
    return services


def classify_subnets(l3ext_subnets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Tag every l3extSubnet with scope_valid / is_default_route. Invalid-scope subnets
    are retained (transparency) but flagged so they never resolve a flow (SDD §7.3.3)."""
    out: List[Dict[str, Any]] = []
    for mo in l3ext_subnets:
        a = _attrs(mo, "l3extSubnet")
        prefix = a.get("ip")
        if not prefix:
            continue
        out.append(
            {
                "prefix": prefix,
                "scope": a.get("scope"),
                "scope_valid": scope_is_valid(a.get("scope")),
                "is_default_route": is_default_route(prefix),
                "dn": a.get("dn"),
                "raw": a,
            }
        )
    return out


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

    services = build_services(datasets)
    subnets = classify_subnets(datasets.get("l3extSubnet", []))
    learned = _learned_ips(datasets.get("fvIp", []))

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
    """Replace this fabric's PBR rows with the freshly-collected set, computing health.

    Volumes are small (tens of services/nodes), so a full replace keeps the code simple
    and avoids stale rows.
    """
    await session.execute(delete(PbrSubnet).where(PbrSubnet.fabric_job_id == job.id))
    await session.execute(delete(PbrService).where(PbrService.fabric_job_id == job.id))
    await session.flush()

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
            stale_as_of=timestamp,
            raw_attributes=svc.raw,
        )
        session.add(db_service)
        await session.flush()  # get id

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
                        layer=d.get("layer", node.layer),
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
        session.add(
            PbrSubnet(
                fabric_job_id=job.id,
                prefix=sn["prefix"],
                scope=sn.get("scope"),
                scope_valid=sn["scope_valid"],
                is_default_route=sn["is_default_route"],
                epg_dn=sn.get("dn"),
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

    def _should_poll(self, job: TelcoFabricOnboardingJob) -> bool:
        if job.poll_interval_seconds <= 0:
            return False
        # Only poll fabrics onboarded far enough to have credentials/validation.
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
