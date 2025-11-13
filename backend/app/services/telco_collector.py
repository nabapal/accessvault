from __future__ import annotations

import logging
import asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple

import httpx
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.models import AciFabricNode, AciFabricNodeDetail, AciFabricNodeInterface
from app.models.telco import TelcoFabricOnboardingJob, TelcoFabricType, TelcoOnboardingStatus
from app.services.crypto import decrypt_secret
from app.services.nautobot import fetch_nautobot_device_locations

logger = logging.getLogger(__name__)


@dataclass
class TelcoCollectionResult:
    success: bool
    timestamp: datetime
    snapshot: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


class TelcoCollectionError(Exception):
    """Raised when a Telco collection run fails for a known reason."""


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        if isinstance(value, str) and value.strip() == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _parse_datetime(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate or candidate.lower() in {"never", "unspecified"}:
        return None
    try:
        return datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError:
        return None


def _extract_node_path(distinguished_name: str | None) -> str | None:
    if not distinguished_name or "node-" not in distinguished_name:
        return None
    marker = "/sys"
    idx = distinguished_name.find(marker)
    if idx != -1:
        return distinguished_name[:idx]
    parts = distinguished_name.split("/")
    for index, part in enumerate(parts):
        if part.startswith("node-"):
            return "/".join(parts[: index + 1])
    return None


def _normalize_interface_dn(distinguished_name: str | None) -> str | None:
    if not distinguished_name:
        return None
    if "/phys/" in distinguished_name:
        return distinguished_name[: distinguished_name.find("/phys/")]
    if distinguished_name.endswith("/phys"):
        return distinguished_name[: -5]
    if "/phys-" in distinguished_name:
        return distinguished_name
    return distinguished_name


def _extract_interface_name(distinguished_name: str | None) -> str | None:
    if not distinguished_name:
        return None
    if "[" in distinguished_name and "]" in distinguished_name:
        start = distinguished_name.find("[") + 1
        end = distinguished_name.find("]", start)
        if start > 0 and end > start:
            return distinguished_name[start:end]
    parts = distinguished_name.split("/")
    return parts[-1] if parts else None


def _clean_string(value: Any) -> str | None:
    if not value or not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _normalize_port_channel_id(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.lower().startswith("po"):
        return text.lower()
    if text.isdigit():
        return f"po{text}"
    return text.lower()


def _parse_epg_binding(dn: str | None) -> str | None:
    if not dn or "epg-" not in dn:
        return None
    tenant = None
    app_profile = None
    epg = None
    for segment in dn.split("/"):
        if segment.startswith("tn-"):
            tenant = segment[3:]
        elif segment.startswith("ap-"):
            app_profile = segment[3:]
        elif segment.startswith("epg-"):
            epg = segment[4:]
    if tenant and app_profile and epg:
        return f"{tenant} / {app_profile} / {epg}"
    if tenant and epg:
        return f"{tenant} / {epg}"
    return None


def _parse_l3out_binding(dn: str | None) -> str | None:
    if not dn or "out-" not in dn:
        return None
    tenant = None
    l3out = None
    node_profile = None
    interface_profile = None
    for segment in dn.split("/"):
        lower = segment.lower()
        if segment.startswith("tn-"):
            tenant = segment[3:]
        elif segment.startswith("out-"):
            l3out = segment[4:]
        elif lower.startswith("lnodep-"):
            node_profile = segment.split("-", 1)[1]
        elif lower.startswith("lifp-"):
            interface_profile = segment.split("-", 1)[1]
    parts = [part for part in [tenant, l3out, node_profile, interface_profile] if part]
    if parts:
        return " / ".join(parts)
    return None


def _parse_path_binding_target(path_dn: str | None) -> Tuple[str | None, str | None, str | None]:
    if not path_dn:
        return None, None, None
    marker = "/pathep-["
    idx = path_dn.find(marker)
    if idx == -1:
        return None, None, None
    endpoint = path_dn[idx + len(marker) :]
    if endpoint.endswith("]"):
        endpoint = endpoint[:-1]
    endpoint = endpoint.strip()
    base = path_dn[:idx]

    port_channel_id = None
    interface_dn = None
    pod_segment = None
    node_segment = None

    if endpoint.lower().startswith("po"):
        port_channel_id = _normalize_port_channel_id(endpoint)
    else:
        for segment in base.split("/"):
            if segment.startswith("pod-"):
                pod_segment = segment
            elif segment.startswith("paths-") and "-" in segment:
                node_segment = f"node-{segment.split('-', 1)[1]}"
            elif segment.startswith("node-"):
                node_segment = segment
        if pod_segment and node_segment:
            interface_dn = f"topology/{pod_segment}/{node_segment}/sys/phys-[{endpoint}]"

    if not pod_segment:
        for segment in base.split("/"):
            if segment.startswith("pod-"):
                pod_segment = segment
                break

    pod_path = f"topology/{pod_segment}" if pod_segment else None

    return interface_dn, port_channel_id, pod_path


def _binding_record(
    name: str,
    *,
    encap: str | None = None,
    mode: str | None = None,
    immediacy: str | None = None,
    path: str | None = None,
) -> Dict[str, Any]:
    record: Dict[str, Any] = {"name": name}
    if encap:
        record["encap"] = encap
    if mode:
        record["mode"] = mode
    if immediacy:
        record["immediacy"] = immediacy
    if path:
        record["path"] = path
    return record


def _deduplicate_binding_records(bindings: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[Tuple[Any, ...]] = set()
    results: List[Dict[str, Any]] = []
    for binding in bindings:
        if not binding:
            continue
        name = _clean_string(binding.get("name")) if isinstance(binding, dict) else None
        if not name:
            continue
        encap = _clean_string(binding.get("encap")) if isinstance(binding, dict) else None
        mode = _clean_string(binding.get("mode")) if isinstance(binding, dict) else None
        immediacy = _clean_string(binding.get("immediacy")) if isinstance(binding, dict) else None
        path = _clean_string(binding.get("path")) if isinstance(binding, dict) else None
        key = (name, encap, mode, immediacy, path)
        if key in seen:
            continue
        seen.add(key)
        compact = {"name": name}
        if encap:
            compact["encap"] = encap
        if mode:
            compact["mode"] = mode
        if immediacy:
            compact["immediacy"] = immediacy
        if path:
            compact["path"] = path
        results.append(compact)
    return results


def _serialize_datetime(value: datetime | None) -> datetime | str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _append_health_sample(container: Dict[str, Any], attributes: Dict[str, Any], window: str) -> None:
    samples = container.setdefault("samples", [])
    samples.append(
        {
            "window": window,
            "health_last": _safe_float(attributes.get("healthLast")),
            "health_avg": _safe_float(attributes.get("healthAvg")),
            "health_max": _safe_float(attributes.get("healthMax")),
            "health_min": _safe_float(attributes.get("healthMin")),
            "sample_start": _serialize_datetime(_parse_datetime(attributes.get("repIntvStart"))),
            "sample_end": _serialize_datetime(_parse_datetime(attributes.get("repIntvEnd"))),
        }
    )


_ACI_DETAIL_ENDPOINTS: Dict[str, str] = {
    "topSystem": "/api/class/topSystem.json",
    "fabricNodeHealth15min": "/api/class/fabricNodeHealth15min.json",
    "fabricNodeHealth1d": "/api/class/fabricNodeHealth1d.json",
    "procSysCPU15min": "/api/class/procSysCPU15min.json",
    "procSysMem15min": "/api/class/procSysMem15min.json",
    "eqptTemp5min": "/api/class/eqptTemp5min.json",
    "eqptFan": "/api/class/eqptFan.json",
    "firmwareRunning": "/api/class/firmwareRunning.json",
    "l1PhysIf": "/api/class/l1PhysIf.json",
    "ethpmPhysIf": "/api/class/ethpmPhysIf.json",
    "ethpmFcot": "/api/class/ethpmFcot.json",
    "pcAggrIf": "/api/class/pcAggrIf.json",
    "pcRsMbrIfs": "/api/class/pcRsMbrIfs.json",
    "fvRsPathAtt": "/api/class/fvRsPathAtt.json",
    "l3extRsPathL3OutAtt": "/api/class/l3extRsPathL3OutAtt.json",
}


async def run_collection_for_job(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    password_override: Optional[str] = None,
) -> TelcoCollectionResult:
    password = password_override
    if password is None:
        if job.password_secret is None:
            return TelcoCollectionResult(
                success=False,
                timestamp=datetime.now(timezone.utc),
                message="No credentials stored for this fabric.",
            )
        password = decrypt_secret(job.password_secret)

    timestamp = datetime.now(timezone.utc)

    try:
        if job.fabric_type == TelcoFabricType.ACI:
            snapshot = await _collect_aci_fabric(session, job, password)
        elif job.fabric_type == TelcoFabricType.NXOS:
            snapshot = await _collect_nxos_fabric(job, password)
        else:  # pragma: no cover - defensive guard
            raise TelcoCollectionError(f"Unsupported fabric type: {job.fabric_type}")
    except TelcoCollectionError as exc:
        logger.warning("Telco collection error", extra={"job": str(job.id), "error": str(exc)})
        return TelcoCollectionResult(success=False, timestamp=timestamp, message=str(exc))
    except httpx.HTTPError as exc:
        logger.warning("HTTP error during telco collection", extra={"job": str(job.id), "error": str(exc)})
        return TelcoCollectionResult(success=False, timestamp=timestamp, message=str(exc))
    except Exception as exc:  # pragma: no cover - runtime safety
        logger.exception("Unexpected error during telco collection", extra={"job": str(job.id)})
        return TelcoCollectionResult(success=False, timestamp=timestamp, message=str(exc))

    return TelcoCollectionResult(success=True, timestamp=timestamp, snapshot=snapshot)


async def _collect_aci_fabric(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    password: str,
) -> Dict[str, Any]:
    if not job.username:
        raise TelcoCollectionError("Username is required for Cisco ACI fabrics.")

    base_url = _build_base_url(job, default_scheme=job.connection_params.get("protocol", "https"))
    timeout = httpx.Timeout(30.0, read=60.0)
    login_payload = {"aaaUser": {"attributes": {"name": job.username, "pwd": password}}}

    detail_counts = {"node_detail_count": 0, "interface_count": 0}
    nautobot_enriched = 0
    count = 0
    nodes: List[AciFabricNode] = []

    async with httpx.AsyncClient(base_url=base_url, verify=job.verify_ssl, timeout=timeout) as client:
        response = await client.post("/api/aaaLogin.json", json=login_payload)
        response.raise_for_status()
        login_data = response.json()
        try:
            token = login_data["imdata"][0]["aaaLogin"]["attributes"]["token"]
        except (KeyError, IndexError) as exc:  # pragma: no cover - defensive parsing
            raise TelcoCollectionError("Unexpected login response from APIC.") from exc

        client.cookies.set("APIC-cookie", token)
        fabric_response = await client.get("/api/class/fabricNode.json")
        fabric_response.raise_for_status()
        payload = fabric_response.json()

        items = payload.get("imdata", [])
        await _ensure_aci_node_location_columns(session)
        count = await _upsert_aci_nodes(session, items, job)
        await session.flush()

        result = await session.execute(select(AciFabricNode).where(AciFabricNode.fabric_job_id == job.id))
        nodes = result.scalars().all()
        if nodes:
            detail_counts = await _collect_and_upsert_aci_node_details(session, client, job, nodes)

    if nodes:
        nautobot_enriched = await _enrich_nodes_with_nautobot(session, nodes)

    snapshot = {"fabric_node_count": count}
    snapshot.update(detail_counts)
    if nautobot_enriched:
        snapshot["nautobot_enriched_nodes"] = nautobot_enriched
    return snapshot


async def _enrich_nodes_with_nautobot(session: AsyncSession, nodes: Iterable[AciFabricNode]) -> int:
    settings = get_settings()
    base_url = settings.nautobot_base_url
    token = settings.nautobot_token

    if not base_url or not token:
        return 0

    try:
        location_index = await fetch_nautobot_device_locations(base_url, token)
    except httpx.HTTPError as exc:
        logger.warning("Failed to enrich ACI nodes from Nautobot: %s", exc)
        return 0

    updated = 0
    for node in nodes:
        record = location_index.lookup(node.name)
        if record is None:
            continue
        site_name, rack_location = record
        changed = False
        if node.site_name != site_name:
            node.site_name = site_name
            changed = True
        if node.rack_location != rack_location:
            node.rack_location = rack_location
            changed = True
        if changed:
            updated += 1

    if updated:
        await session.flush()

    return updated


async def _ensure_aci_node_location_columns(session: AsyncSession) -> None:
    bind = session.get_bind()
    if bind is None:
        return

    dialect = bind.dialect.name
    statements: List[str] = []

    if dialect == "sqlite":
        result = await session.execute(text("PRAGMA table_info('aci_fabric_nodes')"))
        existing_columns = {row[1] for row in result.all() if len(row) > 1}
        if "site_name" not in existing_columns:
            statements.append("ALTER TABLE aci_fabric_nodes ADD COLUMN site_name VARCHAR")
        if "rack_location" not in existing_columns:
            statements.append("ALTER TABLE aci_fabric_nodes ADD COLUMN rack_location VARCHAR")
    else:
        statements = [
            "ALTER TABLE aci_fabric_nodes ADD COLUMN IF NOT EXISTS site_name VARCHAR",
            "ALTER TABLE aci_fabric_nodes ADD COLUMN IF NOT EXISTS rack_location VARCHAR",
        ]

    for ddl in statements:
        try:
            await session.execute(text(ddl))
        except Exception as exc:
            message = str(exc).lower()
            if "duplicate" in message or "exists" in message:
                continue
            raise

    if statements:
        await session.commit()


async def _collect_nxos_fabric(
    job: TelcoFabricOnboardingJob,
    password: str,
) -> Dict[str, Any]:
    if not job.username:
        raise TelcoCollectionError("Username is required for NX-OS fabrics.")

    transport = (job.connection_params.get("transport") or "nxapi-https").lower()
    if transport == "ssh":
        raise TelcoCollectionError("SSH transport is not yet supported. Enable NX-API and select nxapi-http or nxapi-https.")

    scheme = "https" if transport.endswith("https") else "http"
    base_url = _build_base_url(job, default_scheme=scheme)
    verify = job.verify_ssl if scheme == "https" else False
    timeout = httpx.Timeout(20.0, read=40.0)

    payload = {
        "ins_api": {
            "version": "1.0",
            "type": "cli_show",
            "chunk": "0",
            "sid": "1",
            "input": "show inventory",
            "output_format": "json",
        }
    }

    async with httpx.AsyncClient(base_url=base_url, verify=verify, timeout=timeout, auth=(job.username, password)) as client:
        response = await client.post("/ins", json=payload)
        response.raise_for_status()
        data = response.json()

    modules = _parse_nxos_inventory(data)
    return {
        "module_count": len(modules),
        "modules": modules[:10],
    }


async def _upsert_aci_nodes(
    session: AsyncSession,
    items: Iterable[Dict[str, Any]],
    job: TelcoFabricOnboardingJob,
) -> int:
    total = 0
    for item in items:
        attributes = item.get("fabricNode", {}).get("attributes") if isinstance(item, dict) else None
        if not attributes:
            continue
        dn = attributes.get("dn")
        if not dn:
            continue
        result = await session.execute(
            select(AciFabricNode).where(
                AciFabricNode.distinguished_name == dn,
                AciFabricNode.fabric_job_id == job.id,
            )
        )
        node = result.scalar_one_or_none()
        if node is None:
            node = AciFabricNode(
                distinguished_name=dn,
                name=attributes.get("name") or dn.split("/")[-1],
                node_id=attributes.get("id") or dn,
                fabric_job_id=job.id,
            )
            session.add(node)
        else:
            node.fabric_job_id = job.id
        node.update_from_attributes(attributes)
        total += 1
    return total


async def _collect_and_upsert_aci_node_details(
    session: AsyncSession,
    client: httpx.AsyncClient,
    job: TelcoFabricOnboardingJob,
    nodes: Iterable[AciFabricNode],
) -> Dict[str, int]:
    node_map: Dict[str, AciFabricNode] = {}
    for node in nodes:
        if node.distinguished_name:
            node_map[node.distinguished_name] = node
    if not node_map:
        return {"node_detail_count": 0, "interface_count": 0}

    datasets = await _fetch_aci_detail_datasets(client)
    snapshots = _build_node_snapshots(node_map, datasets)
    if not snapshots:
        return {"node_detail_count": 0, "interface_count": 0}

    detail_count, _ = await _upsert_node_detail_records(session, job, node_map, snapshots)
    interface_count = await _replace_node_interfaces(session, job, node_map, snapshots)
    return {"node_detail_count": detail_count, "interface_count": interface_count}


async def _fetch_aci_detail_datasets(client: httpx.AsyncClient) -> Dict[str, List[Dict[str, Any]]]:
    tasks = [client.get(path) for path in _ACI_DETAIL_ENDPOINTS.values()]
    responses = await asyncio.gather(*tasks, return_exceptions=True)
    datasets: Dict[str, List[Dict[str, Any]]] = {}

    for (key, response) in zip(_ACI_DETAIL_ENDPOINTS.keys(), responses):
        if isinstance(response, Exception):
            logger.warning("Failed to fetch APIC endpoint %s: %s", key, response)
            datasets[key] = []
            continue
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.warning("APIC returned an error for endpoint %s: %s", key, exc)
            datasets[key] = []
            continue
        payload = response.json()
        items = payload.get("imdata", [])
        datasets[key] = items if isinstance(items, list) else []

    return datasets


def _build_node_snapshots(
    node_map: Dict[str, AciFabricNode],
    datasets: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Dict[str, Any]]:
    snapshots: Dict[str, Dict[str, Any]] = {
        node_path: {
            "general": {},
            "health": {"samples": []},
            "resources": {},
            "environment": {"temperatures": [], "fans": [], "power_supplies": []},
            "firmware": {},
            "port_channels": [],
            "interfaces": [],
            "connected_endpoints": [],
        }
        for node_path in node_map.keys()
    }

    for item in datasets.get("topSystem", []):
        attributes = item.get("topSystem", {}).get("attributes")
        if not attributes:
            continue
        node_path = _extract_node_path(attributes.get("dn"))
        if node_path not in snapshots:
            continue
        general = snapshots[node_path]["general"]
        general.update(
            {
                "fabric_domain": attributes.get("fabricDomain"),
                "fabric_id": attributes.get("fabricId"),
                "pod_id": attributes.get("podId"),
                "address": attributes.get("address"),
                "inband_address": attributes.get("inbMgmtAddr"),
                "inband_gateway": attributes.get("inbMgmtGateway"),
                "oob_address": attributes.get("oobMgmtAddr"),
                "oob_gateway": attributes.get("oobMgmtGateway"),
                "serial": attributes.get("serial"),
                "system_name": attributes.get("name"),
                "uptime": attributes.get("systemUpTime"),
                "last_reboot_at": _serialize_datetime(_parse_datetime(attributes.get("lastRebootTime"))),
                "last_reset_reason": attributes.get("lastResetReason"),
                "current_time": _serialize_datetime(_parse_datetime(attributes.get("currentTime"))),
                "mode": attributes.get("mode"),
            }
        )

    health_mappings = {"fabricNodeHealth15min": "15min", "fabricNodeHealth1d": "1d"}
    for key, window in health_mappings.items():
        for item in datasets.get(key, []):
            attributes = item.get(key, {}).get("attributes")
            if not attributes:
                continue
            node_path = _extract_node_path(attributes.get("dn"))
            if node_path not in snapshots:
                continue
            _append_health_sample(snapshots[node_path]["health"], attributes, window)

    for item in datasets.get("procSysCPU15min", []):
        attributes = item.get("procSysCPU15min", {}).get("attributes")
        if not attributes:
            continue
        node_path = _extract_node_path(attributes.get("dn"))
        if node_path not in snapshots:
            continue
        idle = _safe_float(attributes.get("idleAvg"))
        user = _safe_float(attributes.get("userAvg"))
        kernel = _safe_float(attributes.get("kernelAvg"))
        usage_pct = None
        if idle is not None:
            usage_pct = max(0.0, min(100.0, 100.0 - idle))
        snapshots[node_path]["resources"]["cpu"] = {
            "usage_pct": usage_pct,
            "idle_pct": idle,
            "user_pct": user,
            "kernel_pct": kernel,
            "sample_start": _serialize_datetime(_parse_datetime(attributes.get("repIntvStart"))),
            "sample_end": _serialize_datetime(_parse_datetime(attributes.get("repIntvEnd"))),
        }

    for item in datasets.get("procSysMem15min", []):
        attributes = item.get("procSysMem15min", {}).get("attributes")
        if not attributes:
            continue
        node_path = _extract_node_path(attributes.get("dn"))
        if node_path not in snapshots:
            continue
        total = _safe_int(attributes.get("totalAvg"))
        used = _safe_int(attributes.get("usedAvg"))
        free = _safe_int(attributes.get("freeAvg"))
        usage_pct = None
        if total and total > 0 and used is not None:
            usage_pct = max(0.0, min(100.0, (used / total) * 100.0))
        snapshots[node_path]["resources"]["memory"] = {
            "total_kb": total,
            "used_kb": used,
            "free_kb": free,
            "usage_pct": usage_pct,
            "sample_start": _serialize_datetime(_parse_datetime(attributes.get("repIntvStart"))),
            "sample_end": _serialize_datetime(_parse_datetime(attributes.get("repIntvEnd"))),
        }

    for item in datasets.get("eqptTemp5min", []):
        attributes = item.get("eqptTemp5min", {}).get("attributes")
        if not attributes:
            continue
        dn = attributes.get("dn")
        node_path = _extract_node_path(dn)
        if node_path not in snapshots:
            continue
        segments = dn.split("/") if dn else []
        sensor = segments[-2] if len(segments) >= 2 else (dn or "sensor")
        location = segments[-3] if len(segments) >= 3 else None
        name = sensor if not location else f"{location}/{sensor}"
        snapshots[node_path]["environment"]["temperatures"].append(
            {
                "name": name,
                "value_celsius": _safe_float(attributes.get("currentLast")),
                "normalized_value": _safe_float(attributes.get("normalizedLast")),
                "distinguished_name": dn,
            }
        )

    for item in datasets.get("eqptFan", []):
        attributes = item.get("eqptFan", {}).get("attributes")
        if not attributes:
            continue
        dn = attributes.get("dn")
        node_path = _extract_node_path(dn)
        if node_path not in snapshots:
            continue
        fan_label = attributes.get("descr") or attributes.get("id") or _extract_interface_name(dn)
        snapshots[node_path]["environment"]["fans"].append(
            {
                "name": fan_label or "fan",
                "direction": attributes.get("dir"),
                "model": attributes.get("model"),
                "vendor": attributes.get("vendor"),
                "status": attributes.get("operSt"),
                "distinguished_name": dn,
            }
        )

    for item in datasets.get("firmwareRunning", []):
        attributes = item.get("firmwareRunning", {}).get("attributes")
        if not attributes:
            continue
        node_path = _extract_node_path(attributes.get("dn"))
        if node_path not in snapshots:
            continue
        snapshots[node_path]["firmware"] = {
            "version": attributes.get("version"),
            "description": attributes.get("descr"),
            "pe_version": attributes.get("peVer"),
            "bios_version": attributes.get("biosVer"),
            "bios_timestamp": _serialize_datetime(_parse_datetime(attributes.get("biosTs"))),
            "kickstart_image": attributes.get("ksFile"),
            "system_image": attributes.get("sysFile"),
            "last_boot": _serialize_datetime(_parse_datetime(attributes.get("ts"))),
        }

    interface_map: Dict[str, Dict[str, Any]] = {}
    for item in datasets.get("l1PhysIf", []):
        attributes = item.get("l1PhysIf", {}).get("attributes")
        if not attributes:
            continue
        dn = attributes.get("dn")
        node_path = _extract_node_path(dn)
        if node_path not in snapshots:
            continue
        entry = interface_map.setdefault(dn, {"node_path": node_path})
        entry["l1"] = attributes

    for item in datasets.get("ethpmPhysIf", []):
        attributes = item.get("ethpmPhysIf", {}).get("attributes")
        if not attributes:
            continue
        dn = _normalize_interface_dn(attributes.get("dn"))
        node_path = _extract_node_path(dn)
        if node_path not in snapshots or not dn:
            continue
        entry = interface_map.setdefault(dn, {"node_path": node_path})
        entry["ethpm"] = attributes

    for item in datasets.get("ethpmFcot", []):
        attributes = item.get("ethpmFcot", {}).get("attributes")
        if not attributes:
            continue
        dn = _normalize_interface_dn(attributes.get("dn"))
        node_path = _extract_node_path(dn)
        if node_path not in snapshots or not dn:
            continue
        entry = interface_map.setdefault(dn, {"node_path": node_path})
        entry["fcot"] = attributes

    port_channels_by_node: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(dict)
    for item in datasets.get("pcAggrIf", []):
        attributes = item.get("pcAggrIf", {}).get("attributes")
        if not attributes:
            continue
        dn = attributes.get("dn")
        node_path = _extract_node_path(dn)
        if node_path not in snapshots:
            continue
        pc_id = _normalize_port_channel_id(attributes.get("pcId") or attributes.get("id"))
        if not pc_id:
            continue
        port_channels_by_node[node_path][pc_id] = {
            "port_channel_id": pc_id,
            "name": attributes.get("name") or pc_id,
            "admin_state": attributes.get("adminSt"),
            "oper_state": attributes.get("switchingSt"),
            "usage": attributes.get("usage"),
            "speed": attributes.get("speed"),
            "active_ports": _safe_int(attributes.get("activePorts")),
            "members": [],
        }

    for item in datasets.get("pcRsMbrIfs", []):
        attributes = item.get("pcRsMbrIfs", {}).get("attributes")
        if not attributes:
            continue
        t_dn = attributes.get("tDn")
        dn = _normalize_interface_dn(t_dn)
        node_path = _extract_node_path(dn)
        if node_path not in snapshots or not dn:
            continue
        pc_id = _normalize_port_channel_id(attributes.get("parentSKey"))
        if not pc_id:
            continue
        entry = interface_map.setdefault(dn, {"node_path": node_path})
        entry["port_channel"] = {"id": pc_id}
        member_name = attributes.get("tSKey") or _extract_interface_name(dn) or dn
        port_channel = port_channels_by_node[node_path].get(pc_id)
        if port_channel is not None:
            member_record = {"name": member_name, "distinguished_name": dn}
            if member_record not in port_channel["members"]:
                port_channel["members"].append(member_record)

    interface_epg_bindings: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    port_epg_bindings: Dict[Tuple[str | None, str], List[Dict[str, Any]]] = defaultdict(list)
    interface_l3out_bindings: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    port_l3out_bindings: Dict[Tuple[str | None, str], List[Dict[str, Any]]] = defaultdict(list)

    for item in datasets.get("fvRsPathAtt", []):
        attributes = item.get("fvRsPathAtt", {}).get("attributes")
        if not attributes:
            continue
        binding_name = _parse_epg_binding(attributes.get("dn"))
        if not binding_name:
            continue
        path_dn = attributes.get("tDn") or attributes.get("dn")
        interface_dn, port_channel_id, pod_path = _parse_path_binding_target(path_dn)
        if not interface_dn and not port_channel_id:
            continue
        record = _binding_record(
            binding_name,
            encap=_clean_string(attributes.get("encap")),
            mode=_clean_string(attributes.get("mode")),
            immediacy=_clean_string(attributes.get("instrImedcy")),
            path=_clean_string(path_dn),
        )
        if interface_dn:
            interface_epg_bindings[interface_dn].append(record)
        if port_channel_id:
            port_epg_bindings[(pod_path, port_channel_id)].append(record)

    for item in datasets.get("l3extRsPathL3OutAtt", []):
        attributes = item.get("l3extRsPathL3OutAtt", {}).get("attributes")
        if not attributes:
            continue
        binding_name = _parse_l3out_binding(attributes.get("dn"))
        if not binding_name:
            continue
        path_dn = attributes.get("tDn") or attributes.get("dn")
        interface_dn, port_channel_id, pod_path = _parse_path_binding_target(path_dn)
        if not interface_dn and not port_channel_id:
            continue
        record = _binding_record(
            binding_name,
            encap=_clean_string(attributes.get("encap")),
            mode=_clean_string(attributes.get("mode")),
            immediacy=_clean_string(attributes.get("instrImedcy")),
            path=_clean_string(path_dn),
        )
        if interface_dn:
            interface_l3out_bindings[interface_dn].append(record)
        if port_channel_id:
            port_l3out_bindings[(pod_path, port_channel_id)].append(record)

    for node_path, channel_map in port_channels_by_node.items():
        node_pod_path = None
        parts = node_path.split("/") if node_path else []
        if len(parts) >= 2:
            node_pod_path = "/".join(parts[:2])
        for channel in channel_map.values():
            key = (node_pod_path, channel.get("port_channel_id"))
            channel["epg_bindings"] = _deduplicate_binding_records(port_epg_bindings.get(key, []))
            channel["l3out_bindings"] = _deduplicate_binding_records(port_l3out_bindings.get(key, []))
        if node_path in snapshots:
            snapshots[node_path]["port_channels"] = sorted(
                channel_map.values(),
                key=lambda item: item["port_channel_id"],
            )

    for dn, payload in interface_map.items():
        node_path = payload.get("node_path")
        if node_path not in snapshots:
            continue
        l1 = payload.get("l1", {})
        ethpm = payload.get("ethpm", {})
        fcot = payload.get("fcot", {})
        port_channel_info = payload.get("port_channel", {})
        name = l1.get("id") or _extract_interface_name(dn) or dn
        port_channel_id = port_channel_info.get("id") if isinstance(port_channel_info, dict) else None
        port_channel_id = _normalize_port_channel_id(port_channel_id)
        port_channel_name = None
        if port_channel_id:
            channel = port_channels_by_node[node_path].get(port_channel_id)
            if channel:
                port_channel_name = channel.get("name")

        pod_path = None
        dn_parts = dn.split("/") if dn else []
        if len(dn_parts) >= 2:
            pod_path = "/".join(dn_parts[:2])

        transceiver = {}
        if fcot:
            transceiver = {
                "product_id": _clean_string(fcot.get("guiCiscoPID")),
                "serial": _clean_string(fcot.get("guiSN")),
                "type": fcot.get("typeName") or fcot.get("type"),
                "vendor": _clean_string(fcot.get("guiName")),
                "state": fcot.get("state"),
                "is_present": fcot.get("isFcotPresent"),
            }

        interface_entry = {
            "name": name,
            "distinguished_name": dn,
            "description": l1.get("descr") or _clean_string(l1.get("name")),
            "admin_state": l1.get("adminSt"),
            "oper_state": ethpm.get("operSt") or l1.get("adminSt"),
            "oper_speed": ethpm.get("operSpeed") or l1.get("speed"),
            "usage": ethpm.get("usage") or l1.get("usage"),
            "last_link_change_at": _parse_datetime(ethpm.get("lastLinkStChg")),
            "mtu": _safe_int(l1.get("mtu")),
            "fec_mode": ethpm.get("operFecMode") or l1.get("fecMode"),
            "duplex": ethpm.get("operDuplex"),
            "mac": ethpm.get("backplaneMac"),
            "port_type": l1.get("portT") or ethpm.get("intfT"),
            "bundle_id": ethpm.get("bundleBupId"),
            "port_channel_id": port_channel_id,
            "port_channel_name": port_channel_name,
            "vlan_list": ethpm.get("operVlans") or ethpm.get("allowedVlans"),
            "attributes": {
                "mode": l1.get("mode"),
                "layer": l1.get("layer"),
                "auto_negotiation": l1.get("autoNeg"),
            },
            "transceiver": transceiver,
            "stats": {
                "reset_count": _safe_int(ethpm.get("resetCtr")),
                "err_disable_reason": ethpm.get("operErrDisQual"),
                "last_errors": ethpm.get("lastErrors"),
            },
        }
        epg_records = []
        epg_records.extend(interface_epg_bindings.get(dn, []))
        if port_channel_id:
            epg_records.extend(port_epg_bindings.get((pod_path, port_channel_id), []))
        l3out_records = []
        l3out_records.extend(interface_l3out_bindings.get(dn, []))
        if port_channel_id:
            l3out_records.extend(port_l3out_bindings.get((pod_path, port_channel_id), []))

        interface_entry["epg_bindings"] = _deduplicate_binding_records(epg_records)
        interface_entry["l3out_bindings"] = _deduplicate_binding_records(l3out_records)
        snapshots[node_path]["interfaces"].append(interface_entry)

    for snapshot in snapshots.values():
        snapshot["interfaces"].sort(key=lambda item: item["name"])

    return snapshots


async def _upsert_node_detail_records(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    node_map: Dict[str, AciFabricNode],
    snapshots: Dict[str, Dict[str, Any]],
) -> Tuple[int, datetime]:
    node_ids = [node.id for node in node_map.values()]
    if not node_ids:
        return 0, datetime.now(timezone.utc)
    result = await session.execute(
        select(AciFabricNodeDetail).where(AciFabricNodeDetail.node_id.in_(node_ids))
    )
    existing = {detail.node_id: detail for detail in result.scalars()}
    collected_at = datetime.now(timezone.utc)
    updated = 0

    for node_path, snapshot in snapshots.items():
        node = node_map.get(node_path)
        if node is None:
            continue
        detail = existing.get(node.id)
        if detail is None:
            detail = AciFabricNodeDetail(node_id=node.id, fabric_job_id=job.id)
            session.add(detail)
        detail.fabric_job_id = job.id
        detail.general = snapshot.get("general", {})
        detail.health = snapshot.get("health", {})
        detail.resources = snapshot.get("resources", {})
        detail.environment = snapshot.get("environment", {})
        detail.firmware = snapshot.get("firmware", {})
        detail.port_channels = snapshot.get("port_channels", [])
        detail.connected_endpoints = snapshot.get("connected_endpoints", [])
        detail.collected_at = collected_at
        updated += 1

    return updated, collected_at


async def _replace_node_interfaces(
    session: AsyncSession,
    job: TelcoFabricOnboardingJob,
    node_map: Dict[str, AciFabricNode],
    snapshots: Dict[str, Dict[str, Any]],
) -> int:
    node_ids = [node.id for node in node_map.values()]
    if not node_ids:
        return 0
    await session.execute(delete(AciFabricNodeInterface).where(AciFabricNodeInterface.node_id.in_(node_ids)))

    interface_models: List[AciFabricNodeInterface] = []
    for node_path, snapshot in snapshots.items():
        node = node_map.get(node_path)
        if node is None:
            continue
        for entry in snapshot.get("interfaces", []):
            dn_value = entry.get("distinguished_name")
            if not dn_value:
                continue
            name_value = entry.get("name") or "interface"
            interface_models.append(
                AciFabricNodeInterface(
                    node_id=node.id,
                    fabric_job_id=job.id,
                    name=name_value,
                    distinguished_name=dn_value,
                    description=entry.get("description"),
                    admin_state=entry.get("admin_state"),
                    oper_state=entry.get("oper_state"),
                    oper_speed=entry.get("oper_speed"),
                    usage=entry.get("usage"),
                    last_link_change_at=entry.get("last_link_change_at"),
                    mtu=entry.get("mtu"),
                    fec_mode=entry.get("fec_mode"),
                    duplex=entry.get("duplex"),
                    mac=entry.get("mac"),
                    port_type=entry.get("port_type"),
                    bundle_id=entry.get("bundle_id"),
                    port_channel_id=entry.get("port_channel_id"),
                    port_channel_name=entry.get("port_channel_name"),
                    vlan_list=entry.get("vlan_list"),
                    attributes=entry.get("attributes") or {},
                    transceiver=entry.get("transceiver") or {},
                    stats=entry.get("stats") or {},
                    epg_bindings=entry.get("epg_bindings") or [],
                    l3out_bindings=entry.get("l3out_bindings") or [],
                )
            )

    if interface_models:
        session.add_all(interface_models)
    return len(interface_models)


def _parse_nxos_inventory(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    outputs = data.get("ins_api", {}).get("outputs", {}).get("output")
    if outputs is None:
        return []
    if isinstance(outputs, dict):
        outputs = [outputs]

    modules: List[Dict[str, Any]] = []
    for output in outputs:
        body = output.get("body") if isinstance(output, dict) else None
        if not body:
            continue
        table = body.get("TABLE_inv")
        if not table:
            continue
        rows = table.get("ROW_inv")
        if rows is None:
            continue
        if isinstance(rows, dict):
            rows = [rows]
        for row in rows:
            if not isinstance(row, dict):
                continue
            modules.append(
                {
                    "name": row.get("name"),
                    "description": row.get("descr") or row.get("description"),
                    "serial": row.get("serialnum"),
                    "pid": row.get("productid") or row.get("pid"),
                }
            )
    return modules


def _build_base_url(job: TelcoFabricOnboardingJob, default_scheme: str) -> str:
    scheme = (default_scheme or "https").lower()
    host = job.target_host.strip()
    port = job.port

    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return f"{scheme}://{host}"
    return f"{scheme}://{host}:{port}"


class TelcoFabricPoller:
    """Periodic poller responsible for refreshing Telco fabric data."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession], tick_seconds: int = 60) -> None:
        self._session_factory = session_factory
        self._tick_seconds = tick_seconds
        self._shutdown = False
        self._task: Optional[asyncio.Task[None]] = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._shutdown = False
        self._task = asyncio.create_task(self._run(), name="telco-fabric-poller")
        logger.info("Telco fabric poller started (tick=%ss)", self._tick_seconds)

    async def stop(self) -> None:
        self._shutdown = True
        if self._task:
            await self._task
            logger.info("Telco fabric poller stopped")

    async def _run(self) -> None:
        try:
            while not self._shutdown:
                await self._tick()
                await asyncio.sleep(self._tick_seconds)
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Telco fabric poller encountered an unexpected error")

    async def _tick(self) -> None:
        async with self._session() as session:
            result = await session.execute(select(TelcoFabricOnboardingJob))
            jobs = result.scalars().all()
            for job in jobs:
                if not self._should_poll(job):
                    continue
                job.start_validation()
                collection = await run_collection_for_job(session, job)
                if collection.success:
                    job.mark_validation_success()
                    job.last_snapshot = collection.snapshot
                    job.last_polled_at = collection.timestamp
                else:
                    job.mark_validation_failure(collection.message)
                    job.last_snapshot = None
                await session.commit()

    def _should_poll(self, job: TelcoFabricOnboardingJob) -> bool:
        if job.poll_interval_seconds <= 0:
            return False
        if job.status == TelcoOnboardingStatus.VALIDATING:
            return False
        if job.last_polled_at is None:
            return True
        last_polled = job.last_polled_at
        if last_polled.tzinfo is None:
            # Legacy records stored without timezone; treat as UTC to avoid crashes.
            last_polled = last_polled.replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - last_polled
        return delta.total_seconds() >= job.poll_interval_seconds

    @asynccontextmanager
    async def _session(self) -> AsyncGenerator[AsyncSession, None]:
        session = self._session_factory()
        try:
            yield session
        finally:
            await session.close()


def build_telco_poller(
    session_factory: async_sessionmaker[AsyncSession],
    tick_seconds: int,
) -> TelcoFabricPoller:
    return TelcoFabricPoller(session_factory=session_factory, tick_seconds=tick_seconds)
