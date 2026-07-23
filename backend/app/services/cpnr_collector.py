from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CPNR_OBJECT_TYPES,
    CpnrChangeEvent,
    CpnrObject,
    CpnrPairStatus,
    CpnrRole,
    CpnrStatus,
    CpnrVm,
)
from app.services.crypto import decrypt_secret

logger = logging.getLogger(__name__)

# object_type -> (REST resource class, business-key field)
OBJECT_SPECS: Dict[str, Tuple[str, str]] = {
    "scope": ("Scope", "name"),
    "prefix": ("Prefix", "name"),
    "reservation4": ("Reservation", "ipaddr"),
    "reservation6": ("Reservation6", "ip6Address"),
    "client_entry": ("ClientEntry", "name"),
    "client_class": ("ClientClass", "name"),
}

_COUNT_FIELD = {
    "scope": "scope_count",
    "prefix": "prefix_count",
    "reservation4": "reservation4_count",
    "reservation6": "reservation6_count",
    "client_entry": "client_count",
    "client_class": "client_class_count",
}


@dataclass
class CpnrCollectionResult:
    success: bool
    timestamp: datetime
    counts: Dict[str, int]
    message: Optional[str] = None


@dataclass
class CpnrConnectivityResult:
    reachable: bool
    checked_at: datetime
    version: Optional[str] = None
    message: Optional[str] = None


def _normalize(obj: Dict[str, Any]) -> Dict[str, Any]:
    """Drop server-local fields so the same config hashes identically on both VMs."""
    return {k: v for k, v in obj.items() if k not in ("objectOid",)}


def _content_hash(data: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def _base_url(vm: CpnrVm) -> str:
    port = vm.port or 8443
    return f"https://{vm.mgmt_ip}:{port}"


def _password(vm: CpnrVm, override: Optional[str]) -> Optional[str]:
    if override is not None:
        return override
    if vm.password_secret is not None:
        return decrypt_secret(vm.password_secret)
    return None


def _fetch_all(client: httpx.Client, resource: str) -> List[Dict[str, Any]]:
    """Fetch every object of a resource, following CPNR's Link: rel=next cursor."""
    items: List[Dict[str, Any]] = []
    url: Optional[str] = f"/web-services/rest/resource/{resource}"
    pages = 0
    while url and pages < 500:
        resp = client.get(url)
        pages += 1
        if resp.status_code != 200:
            if pages == 1:
                raise RuntimeError(f"{resource}: HTTP {resp.status_code}")
            break
        body = resp.json()
        if isinstance(body, list):
            items.extend(body)
        nxt = None
        for part in resp.headers.get("link", "").split(","):
            if 'rel="next"' in part:
                nxt = part[part.find("<") + 1 : part.find(">")]
        url = nxt
    return items


def _collect_objects(client: httpx.Client) -> Dict[str, List[Tuple[str, str, Dict[str, Any]]]]:
    """Return {object_type: [(object_key, content_hash, data), ...]}."""
    out: Dict[str, List[Tuple[str, str, Dict[str, Any]]]] = {}
    for otype, (resource, key_field) in OBJECT_SPECS.items():
        rows: List[Tuple[str, str, Dict[str, Any]]] = []
        for raw in _fetch_all(client, resource):
            data = _normalize(raw)
            key = str(data.get(key_field) or raw.get("objectOid") or "")
            if not key:
                continue
            rows.append((key, _content_hash(data), data))
        out[otype] = rows
    return out


def _client(vm: CpnrVm, password: str) -> httpx.Client:
    return httpx.Client(
        base_url=_base_url(vm),
        verify=bool(vm.verify_ssl),
        timeout=45.0,
        auth=(vm.username or "", password),
        headers={"Accept": "application/json"},
    )


def _diff_fields(old: Dict[str, Any], new: Dict[str, Any]) -> List[Dict[str, Any]]:
    changes: List[Dict[str, Any]] = []
    for field in sorted(set(old) | set(new)):
        ov, nv = old.get(field), new.get(field)
        if json.dumps(ov, sort_keys=True, default=str) != json.dumps(nv, sort_keys=True, default=str):
            changes.append({"field": field, "old": ov, "new": nv})
    return changes


async def _apply(session: AsyncSession, vm: CpnrVm, collected: Dict[str, List[Tuple[str, str, Dict[str, Any]]]]) -> Dict[str, int]:
    """Persist per-type objects with change detection + delete-not-seen (req 5/6)."""
    counts: Dict[str, int] = {}
    for otype in CPNR_OBJECT_TYPES:
        rows = collected.get(otype, [])
        counts[otype] = len(rows)

        existing = (
            await session.execute(
                select(CpnrObject).where(CpnrObject.vm_id == vm.id, CpnrObject.object_type == otype)
            )
        ).scalars().all()
        old_by_key = {o.object_key: o for o in existing}
        new_by_key = {key: (h, data) for key, h, data in rows}

        # change events (skip first-ever population to avoid a noisy "all added")
        first_seen = len(existing) == 0
        if not first_seen:
            now = datetime.now(timezone.utc)
            for key, (h, data) in new_by_key.items():
                if key not in old_by_key:
                    session.add(CpnrChangeEvent(vm_id=vm.id, ts=now, object_type=otype, object_key=key, action="added"))
                elif old_by_key[key].content_hash != h:
                    session.add(CpnrChangeEvent(
                        vm_id=vm.id, ts=now, object_type=otype, object_key=key, action="modified",
                        changes=_diff_fields(old_by_key[key].data or {}, data),
                    ))
            for key in old_by_key:
                if key not in new_by_key:
                    session.add(CpnrChangeEvent(vm_id=vm.id, ts=now, object_type=otype, object_key=key, action="removed"))

        # replace rows for this type
        await session.execute(
            delete(CpnrObject).where(CpnrObject.vm_id == vm.id, CpnrObject.object_type == otype)
        )
        for key, h, data in rows:
            session.add(CpnrObject(vm_id=vm.id, object_type=otype, object_key=key, content_hash=h, data=data))

    # rollup counts
    for otype, field in _COUNT_FIELD.items():
        setattr(vm, field, counts.get(otype, 0))
    return counts


async def run_collection_for_vm(
    session: AsyncSession, vm: CpnrVm, password_override: Optional[str] = None
) -> CpnrCollectionResult:
    ts = datetime.now(timezone.utc)
    password = _password(vm, password_override)
    if not vm.username or not password:
        vm.last_polled_at = ts
        vm.status = CpnrStatus.ERROR
        vm.last_error = "Missing username or password for VM."
        return CpnrCollectionResult(success=False, timestamp=ts, counts={}, message=vm.last_error)

    try:
        with _client(vm, password) as client:
            collected = _collect_objects(client)
    except Exception as exc:  # pragma: no cover - network safety
        logger.warning("CPNR collection failed for %s: %s", vm.mgmt_ip, exc)
        vm.last_polled_at = ts
        vm.status = CpnrStatus.ERROR
        vm.last_error = str(exc)[:500]
        return CpnrCollectionResult(success=False, timestamp=ts, counts={}, message=vm.last_error)

    counts = await _apply(session, vm, collected)
    vm.last_polled_at = ts
    vm.status = CpnrStatus.OK
    vm.last_error = None
    await maybe_compare_pair(session, vm)
    return CpnrCollectionResult(success=True, timestamp=ts, counts=counts)


async def test_connection_for_vm(vm: CpnrVm, password_override: Optional[str] = None) -> CpnrConnectivityResult:
    ts = datetime.now(timezone.utc)
    password = _password(vm, password_override)
    if not vm.username or not password:
        return CpnrConnectivityResult(reachable=False, checked_at=ts, message="Missing username or password.")
    try:
        with _client(vm, password) as client:
            resp = client.get("/web-services/rest/resource/Scope")
            if resp.status_code == 200:
                return CpnrConnectivityResult(reachable=True, checked_at=ts)
            return CpnrConnectivityResult(reachable=False, checked_at=ts, message=f"HTTP {resp.status_code}")
    except Exception as exc:  # pragma: no cover
        return CpnrConnectivityResult(reachable=False, checked_at=ts, message=str(exc)[:300])


# --------------------------------------------------------------------------- pair diff (req 3/4)

async def _load_objects(session: AsyncSession, vm_id) -> Dict[str, Dict[str, Tuple[str, Dict[str, Any]]]]:
    rows = (await session.execute(select(CpnrObject).where(CpnrObject.vm_id == vm_id))).scalars().all()
    out: Dict[str, Dict[str, Tuple[str, Dict[str, Any]]]] = {t: {} for t in CPNR_OBJECT_TYPES}
    for o in rows:
        out.setdefault(o.object_type, {})[o.object_key] = (o.content_hash, o.data or {})
    return out


def _compare_maps(prim: Dict[str, Dict[str, Tuple[str, Dict[str, Any]]]],
                  sec: Dict[str, Dict[str, Tuple[str, Dict[str, Any]]]]) -> Dict[str, Any]:
    report: Dict[str, Any] = {"by_type": {}, "inconsistency_count": 0}
    total = 0
    for otype in CPNR_OBJECT_TYPES:
        p, s = prim.get(otype, {}), sec.get(otype, {})
        only_primary = sorted(set(p) - set(s))
        only_secondary = sorted(set(s) - set(p))
        mismatched = []
        for key in sorted(set(p) & set(s)):
            if p[key][0] != s[key][0]:
                mismatched.append({"key": key, "changes": _diff_fields(p[key][1], s[key][1])})
        n = len(only_primary) + len(only_secondary) + len(mismatched)
        total += n
        report["by_type"][otype] = {
            "primary_count": len(p),
            "secondary_count": len(s),
            "only_primary": only_primary,
            "only_secondary": only_secondary,
            "mismatched": mismatched,
            "inconsistency_count": n,
        }
    report["inconsistency_count"] = total
    report["in_sync"] = total == 0
    return report


async def compare_pair(session: AsyncSession, primary: CpnrVm, secondary: CpnrVm) -> Dict[str, Any]:
    prim = await _load_objects(session, primary.id)
    sec = await _load_objects(session, secondary.id)
    report = _compare_maps(prim, sec)
    now = datetime.now(timezone.utc)
    status = CpnrPairStatus.IN_SYNC if report["in_sync"] else CpnrPairStatus.DRIFT
    for vm in (primary, secondary):
        vm.pair_status = status
        vm.inconsistency_count = report["inconsistency_count"]
        vm.last_compared_at = now
    report["primary"] = {"id": str(primary.id), "name": primary.name, "mgmt_ip": primary.mgmt_ip}
    report["secondary"] = {"id": str(secondary.id), "name": secondary.name, "mgmt_ip": secondary.mgmt_ip}
    return report


async def _pair_partner(session: AsyncSession, vm: CpnrVm) -> Optional[CpnrVm]:
    if not vm.pair_id:
        return None
    others = (
        await session.execute(select(CpnrVm).where(CpnrVm.pair_id == vm.pair_id, CpnrVm.id != vm.id))
    ).scalars().all()
    return others[0] if others else None


async def maybe_compare_pair(session: AsyncSession, vm: CpnrVm) -> None:
    """After a VM sync, refresh the pair-consistency rollup if a partner exists."""
    if not vm.pair_id:
        vm.pair_status = CpnrPairStatus.SINGLE
        return
    partner = await _pair_partner(session, vm)
    if partner is None:
        vm.pair_status = CpnrPairStatus.UNKNOWN
        return
    primary = vm if vm.role == CpnrRole.PRIMARY else partner
    secondary = partner if primary is vm else vm
    await compare_pair(session, primary, secondary)
