from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

DeviceLocation = Tuple[Optional[str], Optional[str]]


@dataclass
class NautobotLocationIndex:
    exact: Dict[str, DeviceLocation]
    lower: Dict[str, DeviceLocation]

    def lookup(self, name: str | None) -> DeviceLocation | None:
        if not name:
            return None
        if name in self.exact:
            return self.exact[name]
        return self.lower.get(name.lower())


def _derive_site(device: Dict[str, object]) -> Optional[str]:
    tenant = device.get("tenant")
    site = device.get("site")
    tenant_name = tenant.get("name") if isinstance(tenant, dict) else None
    site_name = site.get("name") if isinstance(site, dict) else None
    return tenant_name or site_name


def _derive_rack_location(device: Dict[str, object]) -> Optional[str]:
    rack = device.get("rack")
    rack_name = rack.get("name") if isinstance(rack, dict) else None
    position = _normalize_position(device.get("position"))

    if rack_name and position:
        return f"{rack_name}-U{position}"
    if rack_name:
        return rack_name
    if position:
        return f"U{position}"
    return None


def _normalize_position(value: object) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            return str(value)
        return str(int(value))
    text = str(value).strip()
    return text or None


def compute_device_location(device: Dict[str, object]) -> DeviceLocation:
    """Return (site, rack_location) tuple for the given Nautobot device payload."""

    site_name = _derive_site(device)
    rack_location = _derive_rack_location(device)
    return site_name, rack_location


async def fetch_nautobot_device_locations(
    base_url: str,
    token: str,
    *,
    timeout: float = 30.0,
    page_size: int = 100,
) -> NautobotLocationIndex:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Token {token}",
        "User-Agent": "InfraPulse-Collector/1.0",
    }
    exact: Dict[str, DeviceLocation] = {}
    lower: Dict[str, DeviceLocation] = {}

    timeout_config = httpx.Timeout(timeout, read=timeout)
    async with httpx.AsyncClient(base_url=base_url.rstrip("/"), headers=headers, timeout=timeout_config) as client:
        next_url: Optional[str] = "/dcim/devices/"
        params = {"limit": str(page_size)}

        while next_url:
            url = next_url
            request_params = params if next_url == "/dcim/devices/" else None
            response = await client.get(url, params=request_params)
            response.raise_for_status()
            payload = response.json()

            for device in payload.get("results", []):
                if not isinstance(device, dict):
                    continue
                name = device.get("name") or device.get("display")
                if not isinstance(name, str) or not name.strip():
                    continue
                record = compute_device_location(device)
                exact[name] = record
                lower[name.lower()] = record

            next_url = payload.get("next")

    logger.debug(
        "Fetched %d Nautobot device location entries", len(exact)
    )
    return NautobotLocationIndex(exact=exact, lower=lower)
