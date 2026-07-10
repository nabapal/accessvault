from __future__ import annotations

import asyncio
import logging
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
    NxosBgpNeighbor,
    NxosDevice,
    NxosDeviceStatus,
    NxosInterface,
    NxosModule,
    NxosNeighbor,
    NxosPlatform,
    NxosVrf,
)
from app.services.crypto import decrypt_secret
from app.services.nautobot import fetch_nautobot_device_facts_by_name

logger = logging.getLogger(__name__)


@dataclass
class NxosCollectionResult:
    success: bool
    timestamp: datetime
    snapshot: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("not set", "<not set>", "none", "--", "n/a"):
        return None
    return text


def _int(value: Any) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _collect_device_blocking(
    host: str,
    port: int,
    username: str,
    password: str,
    enable: str | None,
) -> Dict[str, Any]:
    """Netmiko (cisco_nxos) transport + Genie offline parsing — run in a worker thread."""
    params: Dict[str, Any] = {
        "device_type": "cisco_nxos",
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "conn_timeout": 20,
        "fast_cli": False,
    }
    if enable:
        params["secret"] = enable

    gdev = GenieDevice(name="nxos", os="nxos")
    gdev.custom.setdefault("abstraction", {})["order"] = ["os"]

    conn = ConnectHandler(**params)
    try:
        if enable:
            try:
                conn.enable()
            except Exception:  # pragma: no cover - not all devices need enable
                pass

        prompt = conn.find_prompt().strip()
        hostname = prompt.rstrip("#>").strip() or None

        def parse(cmd: str) -> Dict[str, Any]:
            try:
                raw = conn.send_command(cmd, read_timeout=90) or ""
            except Exception as exc:  # pragma: no cover - transport robustness
                logger.warning("Command %r failed on %s: %s", cmd, host, exc)
                return {}
            try:
                return gdev.parse(cmd, output=raw)
            except Exception as exc:  # pragma: no cover - parser robustness
                logger.warning("Genie parse of %r failed on %s: %s", cmd, host, str(exc)[:120])
                return {}

        return {
            "hostname": hostname,
            "version": parse("show version"),
            "inventory": parse("show inventory"),
            "module": parse("show module"),
            "interfaces": parse("show interface"),
            "vrf": parse("show vrf"),
            "cdp": parse("show cdp neighbors detail"),
            "lldp": parse("show lldp neighbors detail"),
            "bgp": parse("show bgp vrf all all summary"),
        }
    finally:
        conn.disconnect()


def _chassis_from_inventory(raw: Dict[str, Any]) -> tuple[str | None, str | None]:
    inv = raw.get("inventory") if isinstance(raw.get("inventory"), dict) else {}
    names = inv.get("name") if isinstance(inv.get("name"), dict) else {}
    chosen = None
    for comp, data in names.items():
        if isinstance(data, dict) and "chassis" in str(comp).lower():
            chosen = data
            break
    if chosen is None and names:
        chosen = next(iter(names.values()))
    if not isinstance(chosen, dict):
        return None, None
    return _clean(chosen.get("pid")), _clean(chosen.get("serial_number"))


def _facts(raw: Dict[str, Any]) -> Dict[str, Any]:
    version = raw.get("version") if isinstance(raw.get("version"), dict) else {}
    platform = version.get("platform") if isinstance(version.get("platform"), dict) else {}
    hardware = platform.get("hardware") if isinstance(platform.get("hardware"), dict) else {}
    software = platform.get("software") if isinstance(platform.get("software"), dict) else {}
    uptime = platform.get("kernel_uptime") if isinstance(platform.get("kernel_uptime"), dict) else {}

    inv_model, inv_serial = _chassis_from_inventory(raw)
    uptime_seconds = None
    if uptime:
        uptime_seconds = (
            (uptime.get("days") or 0) * 86400
            + (uptime.get("hours") or 0) * 3600
            + (uptime.get("minutes") or 0) * 60
            + (uptime.get("seconds") or 0)
        ) or None
    uptime_text = None
    if uptime:
        uptime_text = " ".join(
            f"{uptime.get(u)}{u[0]}" for u in ("days", "hours", "minutes", "seconds") if uptime.get(u)
        ) or None

    return {
        "hostname": raw.get("hostname") or _clean(platform.get("name")),
        "model": inv_model or _clean(hardware.get("model") or hardware.get("chassis")),
        "serial": inv_serial or _clean(hardware.get("processor_board_id")),
        "os_version": _clean(software.get("system_version") or version.get("os")),
        "uptime_text": uptime_text,
        "uptime_seconds": uptime_seconds,
        "raw": {"model": hardware.get("model"), "software": software.get("system_version")},
    }


def _build_modules(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    modules: List[Dict[str, Any]] = []
    module = raw.get("module") if isinstance(raw.get("module"), dict) else {}
    slots = module.get("slot") if isinstance(module.get("slot"), dict) else {}
    for slot_type, entries in slots.items():
        if not isinstance(entries, dict):
            continue
        for slot_num, descs in entries.items():
            if not isinstance(descs, dict):
                continue
            for desc, data in descs.items():
                if not isinstance(data, dict):
                    continue
                modules.append(
                    {
                        "name": f"{slot_type}{slot_num}",
                        "description": _clean(desc),
                        "pid": _clean(data.get("model")),
                        "vid": _clean(data.get("hardware")),
                        "serial": _clean(data.get("serial_number")),
                        "slot": _clean(str(data.get("slot") or slot_num)),
                    }
                )
    return modules


def _build_interfaces(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    if_dict = raw.get("interfaces") if isinstance(raw.get("interfaces"), dict) else {}
    for name, row in if_dict.items():
        if not isinstance(row, dict):
            continue
        ip_address = prefix_len = None
        ipv4 = row.get("ipv4")
        if isinstance(ipv4, dict) and ipv4:
            first = next(iter(ipv4.values()))
            if isinstance(first, dict):
                ip_address = _clean(first.get("ip"))
                prefix_len = _int(first.get("prefix_length"))
        speed = None
        if row.get("port_speed"):
            speed = f"{row.get('port_speed')} {row.get('port_speed_unit') or ''}".strip()
        pc = row.get("port_channel") if isinstance(row.get("port_channel"), dict) else {}
        result.append(
            {
                "name": str(name),
                "description": _clean(row.get("description")),
                "admin_state": _clean(row.get("admin_state") or row.get("enabled")),
                "oper_state": _clean(row.get("oper_status") or row.get("link_state")),
                "ip_address": ip_address,
                "prefix_len": prefix_len,
                "vrf": _clean(row.get("vrf")),
                "speed": _clean(speed),
                "mtu": _int(row.get("mtu")),
                "mac": _clean(row.get("mac_address") or row.get("phys_address")),
                "mode": _clean(row.get("port_mode")),
                "access_vlan": _clean(row.get("access_vlan")),
                "trunk_vlans": _clean(row.get("trunk_vlans")),
                "port_channel": _clean(pc.get("port_channel_int")),
                "attributes": {},
            }
        )
    return result


def _build_vrfs(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    vrf = raw.get("vrf") if isinstance(raw.get("vrf"), dict) else {}
    for name, data in (vrf.get("vrfs") or {}).items():
        if not isinstance(data, dict):
            continue
        result.append(
            {
                "name": str(name),
                "rd": _clean(data.get("vrf_rd") or data.get("rd")),
                "state": _clean(data.get("vrf_state")),
                "interfaces": [],
                "attributes": {k: data.get(k) for k in ("vrf_id", "reason") if data.get(k) is not None},
            }
        )
    return result


def _build_neighbors(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []

    cdp = raw.get("cdp") if isinstance(raw.get("cdp"), dict) else {}
    for _idx, data in (cdp.get("index") or {}).items():
        if not isinstance(data, dict):
            continue
        mgmt = data.get("management_addresses") or data.get("interface_addresses") or {}
        mgmt_ip = next(iter(mgmt.keys()), None) if isinstance(mgmt, dict) else None
        result.append(
            {
                "protocol": "cdp",
                "local_interface": _clean(data.get("local_interface")),
                "remote_device": _clean(data.get("system_name") or data.get("device_id")),
                "remote_interface": _clean(data.get("port_id")),
                "remote_platform": _clean(data.get("platform")),
                "remote_mgmt_ip": _clean(mgmt_ip),
                "attributes": {
                    k: data.get(k) for k in ("capabilities", "native_vlan") if data.get(k)
                },
            }
        )

    lldp = raw.get("lldp") if isinstance(raw.get("lldp"), dict) else {}
    for local_if, ldata in (lldp.get("interfaces") or {}).items():
        if not isinstance(ldata, dict):
            continue
        for remote_port, pdata in (ldata.get("port_id") or {}).items():
            if not isinstance(pdata, dict):
                continue
            for nbr_name, nd in (pdata.get("neighbors") or {}).items():
                if not isinstance(nd, dict):
                    continue
                result.append(
                    {
                        "protocol": "lldp",
                        "local_interface": _clean(local_if),
                        "remote_device": _clean(nd.get("system_name") or nbr_name),
                        "remote_interface": _clean(remote_port),
                        "remote_platform": None,
                        "remote_mgmt_ip": _clean(nd.get("management_address_v4")),
                        "attributes": {
                            k: nd.get(k)
                            for k in ("capabilities", "vlan_id", "system_description")
                            if nd.get(k)
                        },
                    }
                )
    return result


def _build_bgp(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    bgp = raw.get("bgp") if isinstance(raw.get("bgp"), dict) else {}
    for vrf_name, vdata in (bgp.get("vrf") or {}).items():
        for neighbor, nd in (vdata.get("neighbor") or {}).items():
            if not isinstance(nd, dict):
                continue
            for af, ad in (nd.get("address_family") or {}).items():
                if not isinstance(ad, dict):
                    continue
                pfx = ad.get("state_pfxrcd")
                prefixes_received = None
                if isinstance(pfx, int) or (isinstance(pfx, str) and pfx.strip().isdigit()):
                    prefixes_received = int(pfx)
                    state = "established"
                else:
                    state = _clean(ad.get("state") or pfx)
                if prefixes_received is None:
                    total = (ad.get("prefixes") or {}).get("total_entries") if isinstance(ad.get("prefixes"), dict) else None
                    prefixes_received = total if isinstance(total, int) else None
                result.append(
                    {
                        "vrf": str(vrf_name),
                        "address_family": str(af),
                        "neighbor_ip": str(neighbor),
                        "remote_as": _clean(ad.get("as")),
                        "local_as": _clean(ad.get("local_as")),
                        "state": state,
                        "prefixes_received": prefixes_received,
                        "prefixes_sent": None,
                        "uptime": _clean(ad.get("up_down")),
                        "description": None,
                        "attributes": {
                            k: ad.get(k) for k in ("msg_rcvd", "msg_sent", "tbl_ver") if ad.get(k) is not None
                        },
                    }
                )
    return result


def _build_snapshot(raw: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "facts": _facts(raw),
        "interfaces": _build_interfaces(raw),
        "modules": _build_modules(raw),
        "vrfs": _build_vrfs(raw),
        "neighbors": _build_neighbors(raw),
        "bgp": _build_bgp(raw),
    }


async def _apply_snapshot(session: AsyncSession, device: NxosDevice, snapshot: Dict[str, Any]) -> None:
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

    await session.execute(delete(NxosInterface).where(NxosInterface.device_id == device.id))
    for entry in snapshot["interfaces"]:
        session.add(NxosInterface(device_id=device.id, **entry))

    await session.execute(delete(NxosModule).where(NxosModule.device_id == device.id))
    for entry in snapshot["modules"]:
        session.add(NxosModule(device_id=device.id, **entry))

    await session.execute(delete(NxosVrf).where(NxosVrf.device_id == device.id))
    for entry in snapshot["vrfs"]:
        session.add(NxosVrf(device_id=device.id, **entry))

    await session.execute(delete(NxosNeighbor).where(NxosNeighbor.device_id == device.id))
    for entry in snapshot["neighbors"]:
        session.add(NxosNeighbor(device_id=device.id, **entry))

    await session.execute(delete(NxosBgpNeighbor).where(NxosBgpNeighbor.device_id == device.id))
    for entry in snapshot["bgp"]:
        session.add(NxosBgpNeighbor(device_id=device.id, **entry))


async def _enrich_from_nautobot(device: NxosDevice) -> None:
    settings = get_settings()
    base_url = settings.nautobot_base_url
    token = settings.nautobot_token
    if not base_url or not token:
        return
    candidates = [name for name in (device.hostname, device.name) if name]
    facts = None
    for candidate in dict.fromkeys(candidates):
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


def _test_connection_blocking(
    host: str,
    port: int,
    username: str,
    password: str,
    enable: str | None,
) -> str | None:
    """Open an SSH session far enough to prove reachability + auth; return the prompt hostname."""
    params: Dict[str, Any] = {
        "device_type": "cisco_nxos",
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "conn_timeout": 20,
        "fast_cli": False,
    }
    if enable:
        params["secret"] = enable
    conn = ConnectHandler(**params)
    try:
        prompt = conn.find_prompt().strip().rstrip("#>").strip()
        return (prompt.split(":")[-1] if prompt else None) or None
    finally:
        conn.disconnect()


async def test_connection_for_device(
    device: NxosDevice,
    password_override: Optional[str] = None,
) -> Dict[str, Any]:
    """Lightweight connectivity/auth check. Does not persist device state or collect inventory."""
    timestamp = datetime.now(timezone.utc)
    password = password_override
    if password is None and device.password_secret is not None:
        password = decrypt_secret(device.password_secret)
    if not device.username or not password:
        return {"reachable": False, "message": "Missing username or password for device.", "hostname": None, "checked_at": timestamp}

    enable = decrypt_secret(device.enable_secret) if device.enable_secret else None
    try:
        hostname = await asyncio.to_thread(
            _test_connection_blocking,
            device.mgmt_ip,
            device.port or 22,
            device.username,
            password,
            enable,
        )
    except Exception as exc:  # pragma: no cover - network/runtime safety
        logger.warning("NX-OS connectivity test failed for %s: %s", device.mgmt_ip, exc)
        return {"reachable": False, "message": str(exc)[:500], "hostname": None, "checked_at": timestamp}
    return {"reachable": True, "message": "Connection successful.", "hostname": hostname, "checked_at": timestamp}


async def run_collection_for_device(
    session: AsyncSession,
    device: NxosDevice,
    password_override: Optional[str] = None,
) -> NxosCollectionResult:
    timestamp = datetime.now(timezone.utc)

    password = password_override
    if password is None and device.password_secret is not None:
        password = decrypt_secret(device.password_secret)
    if not device.username or not password:
        device.last_polled_at = timestamp
        device.status = NxosDeviceStatus.ERROR
        device.last_error = "Missing username or password for device."
        return NxosCollectionResult(success=False, timestamp=timestamp, message=device.last_error)

    enable = decrypt_secret(device.enable_secret) if device.enable_secret else None

    try:
        raw = await asyncio.to_thread(
            _collect_device_blocking,
            device.mgmt_ip,
            device.port or 22,
            device.username,
            password,
            enable,
        )
    except Exception as exc:  # pragma: no cover - network/runtime safety
        logger.warning("NX-OS collection failed for %s: %s", device.mgmt_ip, exc)
        device.last_polled_at = timestamp
        device.status = NxosDeviceStatus.ERROR
        device.last_error = str(exc)[:500]
        return NxosCollectionResult(success=False, timestamp=timestamp, message=device.last_error)

    snapshot = _build_snapshot(raw)
    await _apply_snapshot(session, device, snapshot)
    try:
        await _enrich_from_nautobot(device)
    except Exception:  # pragma: no cover - enrichment must not break collection
        logger.debug("Nautobot enrichment error for %s", device.mgmt_ip, exc_info=True)
    device.last_polled_at = timestamp
    device.status = NxosDeviceStatus.OK
    device.last_error = None
    return NxosCollectionResult(
        success=True,
        timestamp=timestamp,
        snapshot={
            "interfaces": len(snapshot["interfaces"]),
            "modules": len(snapshot["modules"]),
            "vrfs": len(snapshot["vrfs"]),
            "neighbors": len(snapshot["neighbors"]),
            "bgp": len(snapshot["bgp"]),
        },
    )
