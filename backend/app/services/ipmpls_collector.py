from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from netmiko import ConnectHandler
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import IpMplsDevice, IpMplsDeviceStatus, IpMplsInterface, IpMplsModule, IpMplsPlatform
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


def _pick_chassis(inventory: List[Dict[str, Any]]) -> tuple[str | None, str | None]:
    """Model + serial from the chassis/rack row of `show inventory`."""
    def is_chassis(row: Dict[str, Any]) -> bool:
        name = (row.get("name") or "").strip().lower()
        return "chassis" in name or name.startswith("rack ") or name == "0"

    chosen = next((row for row in inventory if is_chassis(row)), None) or (inventory[0] if inventory else None)
    if not chosen:
        return None, None
    return (
        _first(chosen, ["pid", "productid"]),
        _first(chosen, ["sn", "serial"]),
    )


def _collect_device_blocking(
    device_type: str,
    host: str,
    port: int,
    username: str,
    password: str,
    enable: str | None,
) -> Dict[str, Any]:
    """Synchronous Netmiko collection — must run in a worker thread."""
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

        def safe(cmd: str):
            # Parse each command independently: a TextFSM template error on one
            # command (e.g. odd interface-description output) must not abort the
            # whole device collection.
            try:
                return conn.send_command(cmd, use_textfsm=True)
            except Exception as exc:  # pragma: no cover - parser/template robustness
                logger.warning("Command %r failed to parse on %s: %s", cmd, host, exc)
                return []

        is_xr = device_type == "cisco_xr"
        if_cmd = "show ipv4 interface brief" if is_xr else "show ip interface brief"
        return {
            "hostname": hostname or None,
            "version": safe("show version"),
            "inventory": safe("show inventory"),
            "interfaces": safe(if_cmd),
            "descriptions": safe("show interfaces description"),
        }
    finally:
        conn.disconnect()


def _build_snapshot(raw: Dict[str, Any]) -> Dict[str, Any]:
    version = raw.get("version")
    vrow: Dict[str, Any] = version[0] if isinstance(version, list) and version else (version if isinstance(version, dict) else {})
    inventory = raw.get("inventory") if isinstance(raw.get("inventory"), list) else []
    model, serial = _pick_chassis(inventory)
    uptime_text = _first(vrow, ["uptime"])

    facts = {
        "hostname": raw.get("hostname") or _first(vrow, ["hostname"]),
        "model": model,
        "serial": serial,
        "os_version": _first(vrow, ["version"]),
        "uptime_text": uptime_text,
        "uptime_seconds": _parse_uptime_to_seconds(uptime_text),
        "raw": {"version": vrow},
    }

    descr_map: Dict[str, str] = {}
    for row in raw.get("descriptions") if isinstance(raw.get("descriptions"), list) else []:
        name = _first(row, ["port", "interface", "intf"])
        description = _first(row, ["description", "descrip"])
        if name and description:
            descr_map[name] = description

    interfaces: List[Dict[str, Any]] = []
    seen_if: set[str] = set()
    for row in raw.get("interfaces") if isinstance(raw.get("interfaces"), list) else []:
        name = _first(row, ["interface", "intf"])
        if not name or name in seen_if:
            continue
        seen_if.add(name)
        ip_address = _first(row, ["ip_address", "ipaddr"])
        if ip_address and ip_address.lower() == "unassigned":
            ip_address = None
        interfaces.append(
            {
                "name": name,
                "description": descr_map.get(name),
                "admin_state": row.get("status"),
                "oper_state": _first(row, ["proto", "protocol"]),
                "ip_address": ip_address,
                "prefix_len": None,
                "vrf": row.get("vrf"),
                "speed": None,
                "mtu": None,
                "mac": None,
                "mpls_enabled": None,
                "attributes": {},
            }
        )

    modules: List[Dict[str, Any]] = []
    for row in inventory:
        modules.append(
            {
                "name": row.get("name"),
                "description": _first(row, ["descr", "description"]),
                "pid": _first(row, ["pid", "productid"]),
                "vid": row.get("vid"),
                "serial": _first(row, ["sn", "serial"]),
            }
        )

    return {"facts": facts, "interfaces": interfaces, "modules": modules}


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
        snapshot={"interfaces": len(snapshot["interfaces"]), "modules": len(snapshot["modules"])},
    )
