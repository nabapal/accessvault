#!/usr/bin/env python3
"""Import IP-MPLS devices (Cisco IOS-XE/XR) into the inventory from Nautobot, by role.

For every Nautobot device whose role matches one of the requested roles and which
has a primary management IP, this upserts an ip_mpls_devices row (keyed by mgmt IP),
pre-populating role / site / rack-location from Nautobot. SSH credentials are taken
from --username/--password (or NET_USERNAME/NET_PASSWORD in the environment). With
--collect it also SSH-collects reachable devices immediately; otherwise the normal
background poller will collect them.

Examples:
  python scripts/import_ipmpls_devices.py --role SAR --role AG2 --role AG3
  python scripts/import_ipmpls_devices.py --role SAR --collect --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import os
import socket
import sys
from pathlib import Path
from typing import Any, Dict, List

import httpx
from dotenv import load_dotenv
from sqlalchemy import select

# Make the backend package importable regardless of the working directory.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(BACKEND_ROOT / ".env")

from app.core.config import get_settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models import IpMplsDevice, IpMplsPlatform  # noqa: E402
from app.services.crypto import encrypt_secret  # noqa: E402
from app.services.ipmpls_collector import run_collection_for_device  # noqa: E402
from app.services.nautobot import compute_device_facts  # noqa: E402


def parse_args(argv: List[str]) -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Bulk-import IP-MPLS devices from Nautobot by role.")
    parser.add_argument("--role", action="append", default=[], metavar="ROLE",
                        help="Nautobot device role to import (repeatable), e.g. --role SAR --role AG2")
    parser.add_argument("--nautobot-url", default=settings.nautobot_base_url,
                        help="Nautobot API base URL incl. /api (default: NAUTOBOT_BASE_URL)")
    parser.add_argument("--nautobot-token", default=settings.nautobot_token,
                        help="Nautobot API token (default: NAUTOBOT_TOKEN)")
    parser.add_argument("--username", default=settings.net_username, help="SSH username (default: NET_USERNAME)")
    parser.add_argument("--password", default=settings.net_password, help="SSH password (default: NET_PASSWORD)")
    parser.add_argument("--enable", default=settings.net_enable, help="Enable secret (default: NET_ENABLE)")
    parser.add_argument("--poll-interval", type=int, default=900, help="Per-device poll interval seconds (default 900)")
    parser.add_argument("--collect", action="store_true", help="SSH-collect reachable devices now (else leave to poller)")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be imported without writing")
    args = parser.parse_args(argv)

    missing = [n for n, v in (("--role", args.role), ("--nautobot-url", args.nautobot_url),
                              ("--nautobot-token", args.nautobot_token)) if not v]
    if missing:
        parser.error(f"Missing required value(s): {', '.join(missing)}")
    if not args.dry_run and (not args.username or not args.password):
        parser.error("SSH --username/--password (or NET_USERNAME/NET_PASSWORD) required unless --dry-run")
    return args


def _node_name(value: Any) -> Any:
    return value.get("name") if isinstance(value, dict) else value


def fetch_devices_by_roles(base_url: str, token: str, roles: List[str]) -> List[Dict[str, Any]]:
    headers = {"Accept": "application/json", "Authorization": f"Token {token}", "User-Agent": "NetVerse-Import/1.0"}
    devices: List[Dict[str, Any]] = []
    with httpx.Client(base_url=base_url.rstrip("/"), headers=headers, verify=False, timeout=30.0) as client:
        for role in roles:
            found: List[Dict[str, Any]] = []
            # Nautobot's role filter accepts the name or the slug depending on version.
            for value in (role, role.lower()):
                next_url: str | None = "/dcim/devices/"
                params: Dict[str, str] | None = {"role": value, "limit": "200"}
                page_hits: List[Dict[str, Any]] = []
                while next_url:
                    resp = client.get(next_url, params=params if next_url == "/dcim/devices/" else None)
                    if resp.status_code != 200:
                        break
                    payload = resp.json()
                    page_hits.extend(payload.get("results", []))
                    next_url = payload.get("next")
                    params = None
                if page_hits:
                    found = page_hits
                    break
            print(f"[nautobot] role {role}: {len(found)} device(s)")
            devices.extend(found)
    return devices


def is_reachable(ip: str, port: int = 22, timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except Exception:
        return False


async def run(args: argparse.Namespace) -> int:
    devices = fetch_devices_by_roles(args.nautobot_url, args.nautobot_token, args.role)

    registered = 0
    skipped_no_ip: List[str] = []
    to_collect: List[str] = []  # mgmt IPs

    async with AsyncSessionLocal() as session:
        for device in devices:
            name = device.get("name") or device.get("display")
            primary = device.get("primary_ip4") or device.get("primary_ip")
            address = primary.get("address") if isinstance(primary, dict) else primary
            if not name or not address:
                if name:
                    skipped_no_ip.append(name)
                continue
            mgmt_ip = address.split("/")[0]
            platform = IpMplsPlatform.from_raw(_node_name(device.get("platform")))
            facts = compute_device_facts(device)

            if args.dry_run:
                print(f"  would import {name:20} {mgmt_ip:16} {platform.value:6} role={facts.role} site={facts.site} rack={facts.rack}")
                registered += 1
                continue

            existing = (
                await session.execute(select(IpMplsDevice).where(IpMplsDevice.mgmt_ip == mgmt_ip))
            ).scalar_one_or_none()
            device_row = existing or IpMplsDevice(mgmt_ip=mgmt_ip)
            device_row.name = name
            device_row.platform = platform
            device_row.role = facts.role
            device_row.site_name = facts.site
            device_row.rack_location = facts.rack
            device_row.poll_interval_seconds = args.poll_interval
            if existing is None:
                device_row.username = args.username
                device_row.password_secret = encrypt_secret(args.password)
                device_row.enable_secret = encrypt_secret(args.enable) if args.enable else None
                session.add(device_row)
            registered += 1
            to_collect.append(mgmt_ip)

        if not args.dry_run:
            await session.commit()

        collected = failed = unreachable = 0
        if args.collect and not args.dry_run:
            rows = (await session.execute(select(IpMplsDevice).where(IpMplsDevice.mgmt_ip.in_(to_collect)))).scalars().all()
            for row in rows:
                if not is_reachable(row.mgmt_ip):
                    unreachable += 1
                    continue
                result = await run_collection_for_device(session, row, password_override=args.password)
                await session.commit()
                collected += int(result.success)
                failed += int(not result.success)

    print(f"\n{'[dry-run] ' if args.dry_run else ''}registered/updated: {registered}")
    if skipped_no_ip:
        print(f"skipped (no primary IP in Nautobot): {len(skipped_no_ip)} -> {', '.join(skipped_no_ip)}")
    if args.collect and not args.dry_run:
        print(f"SSH-collected: {collected} | failed: {failed} | unreachable (left to poller): {unreachable}")
    elif not args.dry_run:
        print("Devices will be collected by the background IP-MPLS poller.")
    return 0


def main(argv: List[str]) -> int:
    return asyncio.run(run(parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
