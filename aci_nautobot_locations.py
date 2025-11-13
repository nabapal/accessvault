"""Fetch Cisco ACI device location metadata from Nautobot.

Usage:
    python aci_nautobot_locations.py

Outputs a simple table of device name, inferred location (tenant or site),
rack name, and rack position. Credentials and URL are defined below.
"""

from __future__ import annotations

import sys
from typing import Dict, Iterable, Iterator, List, Optional

import requests
NAUTOBOT_BASE_URL = "http://10.64.46.241:8080/api"
API_TOKEN = "4bd529c8e5cf86c11a5d1b42809dbc5020b63e8e"

SESSION = requests.Session()
SESSION.headers.update({
    "Accept": "application/json",
    "User-Agent": "InfraPulse-ACI-Location-Script/1.0",
    "Authorization": f"Token {API_TOKEN}",
})


def paginate(url: str, *, params: Optional[Dict[str, str]] = None) -> Iterator[Dict[str, any]]:
    """Yield items from a Nautobot paginated endpoint."""

    next_url = url
    query = params or {}
    while next_url:
        response = SESSION.get(next_url, params=query if next_url == url else None, timeout=30)
        response.raise_for_status()
        payload = response.json()
        for item in payload.get("results", []):
            yield item
        next_url = payload.get("next")
        query = None


def looks_like_aci(device: Dict[str, any]) -> bool:
    """Return True if the device appears to be part of the Cisco ACI fabric."""

    name = (device.get("name") or "").lower()
    role = (device.get("device_role") or {}).get("name", "").lower()
    platform = (device.get("platform") or {}).get("name", "").lower()
    manufacturer = (device.get("device_type") or {}).get("manufacturer", {}).get("name", "").lower()

    markers = (name, role, platform, manufacturer)
    return any("aci" in marker for marker in markers)


def derive_site(device: Dict[str, any]) -> str:
    tenant = (device.get("tenant") or {}).get("name")
    site = (device.get("site") or {}).get("name")
    return tenant or site or "--"


def format_row(device: Dict[str, any]) -> str:
    name = device.get("name") or device.get("display") or "Unnamed"
    site = derive_site(device)
    rack = (device.get("rack") or {}).get("name")
    position = device.get("position")

    if rack and position is not None:
        rack_position = f"{rack}-U{position}"
    elif rack:
        rack_position = rack
    elif position is not None:
        rack_position = f"U{position}"
    else:
        rack_position = "--"

    return f"{name:<30} | {site:<20} | {rack_position:<20}"


def fetch_aci_devices() -> List[Dict[str, any]]:
    url = f"{NAUTOBOT_BASE_URL}/dcim/devices/"
    devices = [device for device in paginate(url, params={"limit": "100"}) if looks_like_aci(device)]
    return devices


def main() -> int:
    try:
        devices = fetch_aci_devices()
    except requests.HTTPError as exc:
        print(f"Failed to fetch devices from Nautobot: {exc}", file=sys.stderr)
        return 1

    if not devices:
        print("No ACI devices found in Nautobot API response.")
        return 0

    print("Cisco ACI Devices from Nautobot")
    print("Name                          | Site                | Location            ")
    print("-" * 76)
    for device in devices:
        print(format_row(device))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
