from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from genie.conf.base import Device as GenieDevice
from netmiko import ConnectHandler
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    IpMplsDevice,
    IpMplsDeviceStatus,
    IpMplsInterface,
    IpMplsModule,
    IpMplsNeighbor,
    IpMplsPlatform,
    IpMplsVrf,
)
from app.services.crypto import decrypt_secret
from app.services.nautobot import fetch_nautobot_device_facts_by_name

logger = logging.getLogger(__name__)

_UPTIME_UNITS = {
    "year": 31536000,
    "week": 604800,
    "day": 86400,
    "hour": 3600,
    "minute": 60,
    "second": 1,
}


@dataclass
class IpMplsCollectionResult:
    success: bool
    timestamp: datetime
    snapshot: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


def _first(row: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        value = row.get(key)
        if value:
            return value
    return None


def _parse_uptime_to_seconds(text: str | None) -> int | None:
    if not text:
        return None
    total = 0
    found = False
    for num, unit in re.findall(r"(\d+)\s*(year|week|day|hour|minute|second)s?", text.lower()):
        total += int(num) * _UPTIME_UNITS[unit]
        found = True
    return total if found else None


def _iter_modules(obj: Any, key: str | None = None):
    """Recursively yield inventory module dicts (any node carrying pid + sn)."""
    if isinstance(obj, dict):
        if "pid" in obj and "sn" in obj:
            yield {
                "name": obj.get("name") or key,
                "description": obj.get("descr") or obj.get("description"),
                "pid": obj.get("pid"),
                "vid": obj.get("vid"),
                "serial": obj.get("sn"),
            }
        for child_key, value in obj.items():
            yield from _iter_modules(value, child_key)
    elif isinstance(obj, list):
        for value in obj:
            yield from _iter_modules(value)


def _pick_chassis(modules: List[Dict[str, Any]]) -> tuple[str | None, str | None]:
    def is_chassis(module: Dict[str, Any]) -> bool:
        name = (module.get("name") or "").strip().lower()
        descr = (module.get("description") or "").lower()
        return name in ("rack 0", "chassis", "0") or "chassis" in name or "chassis" in descr

    chosen = next((m for m in modules if is_chassis(m)), None) or (modules[0] if modules else None)
    if not chosen:
        return None, None
    return chosen.get("pid"), chosen.get("serial")


def _collect_device_blocking(
    device_type: str,
    host: str,
    port: int,
    username: str,
    password: str,
    enable: str | None,
) -> Dict[str, Any]:
    """Netmiko transport + Genie offline parsing — must run in a worker thread."""
    params: Dict[str, Any] = {
        "device_type": device_type,
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "conn_timeout": 20,
        "fast_cli": False,
    }
    if enable:
        params["secret"] = enable

    is_xr = device_type == "cisco_xr"
    genie_os = "iosxr" if is_xr else "iosxe"
    gdev = GenieDevice(name="ipmpls", os=genie_os)
    gdev.custom.setdefault("abstraction", {})["order"] = ["os"]

    conn = ConnectHandler(**params)
    try:
        if enable:
            try:
                conn.enable()
            except Exception:  # pragma: no cover - not all devices need enable
                pass

        prompt = conn.find_prompt().strip().rstrip("#>").strip()
        # XR prompt looks like "RP/0/RSP0/CPU0:HOSTNAME"; take the segment after the last ':'.
        hostname = prompt.split(":")[-1] if prompt else None

        def parse(cmd: str) -> Dict[str, Any]:
            # Netmiko fetches the text; Genie parses it offline. A parser miss on one
            # command must never abort the whole device collection.
            try:
                raw = conn.send_command(cmd) or ""
            except Exception as exc:  # pragma: no cover - transport robustness
                logger.warning("Command %r failed on %s: %s", cmd, host, exc)
                return {}
            try:
                return gdev.parse(cmd, output=raw)
            except Exception as exc:  # pragma: no cover - parser robustness
                logger.warning("Genie parse of %r failed on %s: %s", cmd, host, str(exc)[:120])
                return {}

        if_cmd = "show ipv4 interface brief" if is_xr else "show ip interface brief"
        bgp_cmd = "show bgp vpnv4 unicast summary" if is_xr else "show ip bgp vpnv4 all summary"
        return {
            "is_xr": is_xr,
            "hostname": hostname or None,
            "version": parse("show version"),
            "inventory": parse("show inventory"),
            "interfaces": parse(if_cmd),
            "vrf": parse("show vrf all detail" if is_xr else "show vrf"),
            "isis": parse("show isis neighbors"),
            "ldp": parse("show mpls ldp neighbor"),
            "bgp": parse(bgp_cmd),
            "mpls_if": parse("show mpls interfaces"),
        }
    finally:
        conn.disconnect()


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("not set", "<not set>", "none"):
        return None
    return text


def _as_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    cleaned = _clean(value)
    return [cleaned] if cleaned else []


def _version_dict(raw_version: Any) -> Dict[str, Any]:
    if not isinstance(raw_version, dict):
        return {}
    inner = raw_version.get("version")
    return inner if isinstance(inner, dict) else raw_version  # XE nests under 'version'; XR is flat


def _vrf_items(raw_vrf: Any) -> Dict[str, Any]:
    if not isinstance(raw_vrf, dict):
        return {}
    inner = raw_vrf.get("vrf")
    return inner if isinstance(inner, dict) else raw_vrf  # XE nests under 'vrf'; XR keys are vrf names


def _build_vrfs(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for name, entry in _vrf_items(raw.get("vrf")).items():
        if not isinstance(entry, dict):
            continue
        rt_import: List[str] = []
        rt_export: List[str] = []
        address_family = entry.get("address_family") or {}
        for af in address_family.values():
            for rt_key, rt in (af.get("route_target") or {}).items():
                value = (rt.get("route_target") if isinstance(rt, dict) else None) or rt_key
                rt_type = rt.get("rt_type") if isinstance(rt, dict) else None
                if rt_type == "export":
                    rt_export.append(value)
                elif rt_type in ("both", "import_export"):
                    rt_import.append(value)
                    rt_export.append(value)
                else:
                    rt_import.append(value)
        protocols = entry.get("protocols")
        if isinstance(protocols, list):
            protocols = ", ".join(protocols)
        elif address_family:
            protocols = ", ".join(address_family.keys())
        results.append(
            {
                "name": str(name),
                "rd": _clean(entry.get("route_distinguisher")),
                "rt_import": sorted(set(rt_import)),
                "rt_export": sorted(set(rt_export)),
                "interfaces": _as_list(entry.get("interfaces")),
                "protocols": _clean(protocols),
                "description": _clean(entry.get("description")),
            }
        )
    return results


def _vrf_label(name: str) -> str | None:
    return None if not name or name == "default" else name


def _build_neighbors(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []

    def _isis_neighbor(system_id, intf, nd, vrf_name=None, level=None):
        attrs = {k: nd.get(k) for k in ("type", "holdtime", "snpa", "circuit_id", "ietf_nsf") if nd.get(k)}
        if level and "type" not in attrs:
            attrs["type"] = level
        results.append(
            {
                "protocol": "isis",
                "neighbor_id": str(system_id),
                "address": _clean(nd.get("ip_address")),
                "interface": intf,
                "state": _clean(nd.get("state")),
                "uptime": None,
                "vrf": _vrf_label(vrf_name),
                "attributes": attrs,
            }
        )

    isis = raw.get("isis") if isinstance(raw.get("isis"), dict) else {}
    for tag_data in (isis.get("isis") or {}).values():
        if "vrf" in tag_data:  # IOS-XR: tag -> vrf -> interfaces -> neighbors -> <system_id>
            for vrf_name, vrf_data in (tag_data.get("vrf") or {}).items():
                for intf, intf_data in (vrf_data.get("interfaces") or {}).items():
                    for system_id, nd in (intf_data.get("neighbors") or {}).items():
                        _isis_neighbor(system_id, intf, nd, vrf_name=vrf_name)
        elif "neighbors" in tag_data:  # IOS-XE: tag -> neighbors -> <sysid> -> type -> <level> -> interfaces -> <intf>
            for system_id, sdata in tag_data["neighbors"].items():
                for level, ldata in (sdata.get("type") or {}).items():
                    for intf, nd in (ldata.get("interfaces") or {}).items():
                        _isis_neighbor(system_id, intf, nd, level=level)

    # LDP: vrf.<vrf>.peers.<peer>.label_space_id.<id>
    ldp = raw.get("ldp") if isinstance(raw.get("ldp"), dict) else {}
    for vrf_name, vrf_data in (ldp.get("vrf") or {}).items():
        for peer, peer_data in (vrf_data.get("peers") or {}).items():
            for lsid, ld in (peer_data.get("label_space_id") or {}).items():
                results.append(
                    {
                        "protocol": "ldp",
                        "neighbor_id": f"{peer}:{lsid}",
                        "address": str(peer),
                        "interface": None,
                        "state": _clean(ld.get("state")),
                        "uptime": _clean(ld.get("uptime")),
                        "vrf": _vrf_label(vrf_name),
                        "attributes": {
                            k: ld.get(k) for k in ("session_holdtime", "graceful_restart") if ld.get(k)
                        },
                    }
                )

    # BGP: XR instance.<inst>.vrf.<vrf>.neighbor.<n>; XE vrf.<vrf>.neighbor.<n>
    bgp = raw.get("bgp") if isinstance(raw.get("bgp"), dict) else {}
    bgp_vrfs: Dict[str, Any] = {}
    if "instance" in bgp:
        for inst in bgp["instance"].values():
            bgp_vrfs.update(inst.get("vrf") or {})
    elif "vrf" in bgp:
        bgp_vrfs = bgp["vrf"]
    for vrf_name, vrf_data in bgp_vrfs.items():
        for nbr, nd in (vrf_data.get("neighbor") or {}).items():
            state = up_down = None
            remote_as = nd.get("remote_as")
            for af in (nd.get("address_family") or {}).values():
                state = af.get("state_pfxrcd") or state
                up_down = af.get("up_down") or up_down
                remote_as = remote_as or af.get("as") or af.get("remote_as")
            results.append(
                {
                    "protocol": "bgp",
                    "neighbor_id": str(nbr),
                    "address": str(nbr),
                    "interface": None,
                    "state": _clean(state),
                    "uptime": _clean(up_down),
                    "vrf": _vrf_label(vrf_name),
                    "attributes": {"remote_as": remote_as} if remote_as else {},
                }
            )

    return results


def _mpls_enabled_set(raw: Dict[str, Any]) -> set[str]:
    mpls = raw.get("mpls_if") if isinstance(raw.get("mpls_if"), dict) else {}
    ifaces: Dict[str, Any] = {}
    if "interfaces" in mpls:  # XR
        ifaces = mpls["interfaces"]
    elif "vrf" in mpls:  # XE
        for vrf_data in mpls["vrf"].values():
            ifaces.update(vrf_data.get("interfaces") or {})
    enabled: set[str] = set()
    for name, data in ifaces.items():
        flags = {str(data.get(k, "")).lower() for k in ("enabled", "operational", "ldp", "ip")}
        if "yes" in flags:
            enabled.add(name)
    return enabled


def _build_snapshot(raw: Dict[str, Any]) -> Dict[str, Any]:
    version = _version_dict(raw.get("version"))
    modules = list({(m["name"], m["serial"]): m for m in _iter_modules(raw.get("inventory"))}.values())
    model, serial = _pick_chassis(modules)
    uptime_text = version.get("uptime")

    facts = {
        "hostname": raw.get("hostname") or _clean(version.get("hostname")),
        "model": model or _clean(version.get("device_family") or version.get("platform")),
        "serial": serial,
        "os_version": _clean(version.get("software_version") or version.get("version")),
        "uptime_text": uptime_text,
        "uptime_seconds": _parse_uptime_to_seconds(uptime_text),
        "raw": {"version": version},
    }

    mpls_enabled = _mpls_enabled_set(raw)
    interfaces: List[Dict[str, Any]] = []
    if_dict = raw.get("interfaces", {}).get("interface", {}) if isinstance(raw.get("interfaces"), dict) else {}
    for name, row in if_dict.items():
        ip_address = row.get("ip_address")
        if ip_address and ip_address.lower() == "unassigned":
            ip_address = None
        interfaces.append(
            {
                "name": str(name),
                "description": None,
                "admin_state": row.get("interface_status") or row.get("status"),
                "oper_state": row.get("protocol_status") or row.get("protocol"),
                "ip_address": ip_address,
                "prefix_len": None,
                "vrf": _clean(row.get("vrf_name")),
                "speed": None,
                "mtu": None,
                "mac": None,
                "mpls_enabled": name in mpls_enabled,
                "attributes": {},
            }
        )

    return {
        "facts": facts,
        "interfaces": interfaces,
        "modules": modules,
        "vrfs": _build_vrfs(raw),
        "neighbors": _build_neighbors(raw),
    }


async def _apply_snapshot(session: AsyncSession, device: IpMplsDevice, snapshot: Dict[str, Any]) -> None:
    facts = snapshot["facts"]
    if facts.get("hostname"):
        device.hostname = facts["hostname"]
    if facts.get("model"):
        device.model = facts["model"]
    if facts.get("serial"):
        device.serial = facts["serial"]
    if facts.get("os_version"):
        device.os_version = facts["os_version"]
    device.uptime_text = facts.get("uptime_text")
    device.uptime_seconds = facts.get("uptime_seconds")
    device.raw_facts = facts.get("raw", {})

    # Full replace of the child rows so removed interfaces/modules disappear.
    await session.execute(delete(IpMplsInterface).where(IpMplsInterface.device_id == device.id))
    for entry in snapshot["interfaces"]:
        session.add(IpMplsInterface(device_id=device.id, **entry))

    await session.execute(delete(IpMplsModule).where(IpMplsModule.device_id == device.id))
    for entry in snapshot["modules"]:
        session.add(IpMplsModule(device_id=device.id, **entry))

    await session.execute(delete(IpMplsVrf).where(IpMplsVrf.device_id == device.id))
    for entry in snapshot.get("vrfs", []):
        session.add(IpMplsVrf(device_id=device.id, **entry))

    await session.execute(delete(IpMplsNeighbor).where(IpMplsNeighbor.device_id == device.id))
    for entry in snapshot.get("neighbors", []):
        session.add(IpMplsNeighbor(device_id=device.id, **entry))


async def _enrich_from_nautobot(device: IpMplsDevice) -> None:
    """Populate role / site / rack from Nautobot, matched by device name (hostname first)."""
    settings = get_settings()
    base_url = settings.nautobot_base_url
    token = settings.nautobot_token
    if not base_url or not token:
        return

    candidates = [name for name in (device.hostname, device.name) if name]
    facts = None
    for candidate in dict.fromkeys(candidates):  # de-dup, preserve order
        try:
            facts = await fetch_nautobot_device_facts_by_name(base_url, token, candidate)
        except httpx.HTTPError as exc:
            logger.debug("Nautobot lookup failed for %s: %s", candidate, exc)
            return
        if facts is not None:
            break

    if facts is None:
        return
    if facts.role:
        device.role = facts.role
    if facts.site:
        device.site_name = facts.site
    if facts.rack:
        device.rack_location = facts.rack


async def run_collection_for_device(
    session: AsyncSession,
    device: IpMplsDevice,
    password_override: Optional[str] = None,
) -> IpMplsCollectionResult:
    timestamp = datetime.now(timezone.utc)

    password = password_override
    if password is None and device.password_secret is not None:
        password = decrypt_secret(device.password_secret)
    if not device.username or not password:
        device.last_polled_at = timestamp
        device.status = IpMplsDeviceStatus.ERROR
        device.last_error = "Missing username or password for device."
        return IpMplsCollectionResult(success=False, timestamp=timestamp, message=device.last_error)

    enable = decrypt_secret(device.enable_secret) if device.enable_secret else None
    platform = device.platform if isinstance(device.platform, IpMplsPlatform) else IpMplsPlatform.from_raw(device.platform)
    device_type = platform.netmiko_device_type

    try:
        raw = await asyncio.to_thread(
            _collect_device_blocking,
            device_type,
            device.mgmt_ip,
            device.port or 22,
            device.username,
            password,
            enable,
        )
    except Exception as exc:  # pragma: no cover - network/runtime safety
        logger.warning("IP-MPLS collection failed for %s: %s", device.mgmt_ip, exc)
        device.last_polled_at = timestamp
        device.status = IpMplsDeviceStatus.ERROR
        device.last_error = str(exc)[:500]
        return IpMplsCollectionResult(success=False, timestamp=timestamp, message=device.last_error)

    snapshot = _build_snapshot(raw)
    await _apply_snapshot(session, device, snapshot)
    # Best-effort enrichment; never fail the poll because Nautobot is unavailable.
    try:
        await _enrich_from_nautobot(device)
    except Exception:  # pragma: no cover - enrichment must not break collection
        logger.debug("Nautobot enrichment error for %s", device.mgmt_ip, exc_info=True)
    device.last_polled_at = timestamp
    device.status = IpMplsDeviceStatus.OK
    device.last_error = None
    return IpMplsCollectionResult(
        success=True,
        timestamp=timestamp,
        snapshot={
            "interfaces": len(snapshot["interfaces"]),
            "modules": len(snapshot["modules"]),
            "vrfs": len(snapshot.get("vrfs", [])),
            "neighbors": len(snapshot.get("neighbors", [])),
        },
    )
