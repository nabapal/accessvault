"""Cross-reference server serials with Nautobot site/location metadata.

This helper script mirrors ``aci_nautobot_locations.py`` but focuses on the
servers that back the Host Utilization view. It reads server serial numbers
from the application's SQLite database, queries Nautobot for matching devices,
and prints the inferred site and rack location for manual verification before
wiring the enrichment into the application layer.

Usage:
    python server_nautobot_locations.py

Configuration:
    Update ``NAUTOBOT_BASE_URL`` and ``API_TOKEN`` below if needed. The script
    expects to find the application database at ``backend/accessvault.db``.
"""

from __future__ import annotations

import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
import os

try:
    # Optional live vCenter lookup when serial is missing in DB. If pyVmomi
    # isn't installed or VCENTER_* env vars are not set, this feature is skipped.
    from pyVim.connect import SmartConnect, Disconnect
    from pyVmomi import vim
    import ssl
    PYVMOMI_AVAILABLE = True
except Exception:
    PYVMOMI_AVAILABLE = False

import requests

NAUTOBOT_BASE_URL = "http://10.64.46.241:8080/api"
API_TOKEN = "4bd529c8e5cf86c11a5d1b42809dbc5020b63e8e"
DB_PATH = Path(__file__).resolve().parent / "backend" / "accessvault.db"

# Optional vCenter credentials (set via env VCENTER_HOST, VCENTER_USER, VCENTER_PASS)
VCENTER_HOST = os.getenv("VCENTER_HOST")
VCENTER_USER = os.getenv("VCENTER_USER")
VCENTER_PASS = os.getenv("VCENTER_PASS")

SESSION = requests.Session()
SESSION.headers.update(
    {
        "Accept": "application/json",
        "User-Agent": "InfraPulse-Server-Location-Script/1.0",
        "Authorization": f"Token {API_TOKEN}",
    }
)


@dataclass
class HostRecord:
    id: str
    name: str
    serial: str
    model: Optional[str]


@dataclass
class LocationRecord:
    site: Optional[str]
    rack: Optional[str]
    status: str
    detail: Optional[str] = None


def derive_site(device: Dict[str, object]) -> Optional[str]:
    tenant = device.get("tenant")
    site = device.get("site")
    tenant_name = tenant.get("name") if isinstance(tenant, dict) else None
    site_name = site.get("name") if isinstance(site, dict) else None
    return tenant_name or site_name


def derive_rack_location(device: Dict[str, object]) -> Optional[str]:
    rack = device.get("rack")
    rack_name = rack.get("name") if isinstance(rack, dict) else None
    position = device.get("position")

    if rack_name and position not in (None, ""):
        return f"{rack_name}-U{position}"
    if rack_name:
        return rack_name
    if position not in (None, ""):
        return f"U{position}"
    return None


def ensure_serial_column(connection: sqlite3.Connection) -> None:
    cursor = connection.execute("PRAGMA table_info('inventory_hosts')")
    columns = {row[1] for row in cursor.fetchall()}
    if "serial" not in columns:
        raise SystemExit(
            "inventory_hosts table does not contain a 'serial' column. "
            "Add the column before running this script."
        )


def load_hosts(connection: sqlite3.Connection) -> List[HostRecord]:
    connection.row_factory = sqlite3.Row
    rows = connection.execute(
        "SELECT id, name, serial, hardware_model FROM inventory_hosts ORDER BY name"
    )
    records: List[HostRecord] = []
    for row in rows:
        records.append(
            HostRecord(
                id=str(row["id"]),
                name=row["name"],
                serial=(row["serial"] or "").strip(),
                model=row["hardware_model"],
            )
        )
    return records


def fetch_devices_by_serial(serial: str) -> List[Dict[str, object]]:
    url = f"{NAUTOBOT_BASE_URL}/dcim/devices/"
    response = SESSION.get(url, params={"serial": serial, "limit": "50"}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results", [])
    return [item for item in results if isinstance(item, dict)]


def resolve_location(serial: str) -> LocationRecord:
    if not serial:
        # Try live vCenter lookup if configured and pyVmomi present
        if PYVMOMI_AVAILABLE and VCENTER_HOST and VCENTER_USER and VCENTER_PASS:
            live = _fetch_serial_from_vcenter_by_serialless_host()
            if live:
                serial = live
            else:
                return LocationRecord(site=None, rack=None, status="MISSING_SERIAL", detail="Host serial not populated")
        else:
            return LocationRecord(site=None, rack=None, status="MISSING_SERIAL", detail="Host serial not populated")

    try:
        devices = fetch_devices_by_serial(serial)
    except requests.HTTPError as exc:  # pragma: no cover - runtime guard
        return LocationRecord(site=None, rack=None, status="ERROR", detail=str(exc))

    if not devices:
        return LocationRecord(site=None, rack=None, status="NOT_FOUND")

    site = derive_site(devices[0])
    rack = derive_rack_location(devices[0])
    status = "MATCH"
    detail = None

    if len(devices) > 1:
        status = "MULTIPLE"
        detail = f"{len(devices)} devices share serial"

    return LocationRecord(site=site, rack=rack, status=status, detail=detail)


def _fetch_serial_from_vcenter_by_serialless_host() -> Optional[str]:
    """Attempt to fetch a serial from vCenter for a host name provided by
    environment variable YC_HOSTNAME_FOR_LOOKUP. This is a convenience used
    when running interactively; the main loop below will call
    `_fetch_serial_from_vcenter(hostname)` directly when needed.
    """
    return None


def _fetch_serial_from_vcenter(hostname: str) -> Optional[str]:
    """Connect to vCenter and return serial for the given host name.

    Uses the same dual-strategy as other helpers: check
    hardware.systemInfo.serialNumber, then summary.hardware.otherIdentifyingInfo.
    """
    if not PYVMOMI_AVAILABLE or not VCENTER_HOST or not VCENTER_USER or not VCENTER_PASS:
        return None

    try:
        ctx = ssl._create_unverified_context()
        si = SmartConnect(host=VCENTER_HOST, user=VCENTER_USER, pwd=VCENTER_PASS, sslContext=ctx)
    except Exception:
        return None

    try:
        content = si.RetrieveContent()
        # Create a container view for HostSystem objects for robust traversal
        obj_view = content.viewManager.CreateContainerView(container=content.rootFolder, type=[vim.HostSystem], recursive=True)
        try:
            for host in obj_view.view:
                hname = getattr(host, "name", None)
                if not hname:
                    try:
                        hname = host.summary.config.name
                    except Exception:
                        hname = None
                if hname and hname.lower() == hostname.lower():
                    # primary
                    try:
                        serial = getattr(host.hardware.systemInfo, "serialNumber", None)
                    except Exception:
                        serial = None
                    # fallback
                    if not serial:
                        other = getattr(host.summary.hardware, "otherIdentifyingInfo", None)
                        if other:
                            for info in other:
                                id_type = getattr(info, "identifierType", None)
                                label = getattr(id_type, "label", None) or getattr(id_type, "key", None) or ""
                                if "serial" in str(label).lower() or "service" in str(label).lower():
                                    serial = getattr(info, "identifierValue", None)
                                    break
                    return serial
        finally:
            try:
                obj_view.Destroy()
            except Exception:
                pass
    finally:
        try:
            Disconnect(si)
        except Exception:
            pass

    return None


def format_table(rows: Iterable[Tuple[str, str, str, str, str]]) -> str:
    rows_list = list(rows)
    if not rows_list:
        return "No host records found."

    headers = ("Host", "Serial", "Site", "Location", "Status")
    all_rows = [headers, *rows_list]
    widths = [max(len(value) for value in column) for column in zip(*all_rows)]

    def render(values: Tuple[str, str, str, str, str]) -> str:
        return " | ".join(value.ljust(widths[idx]) for idx, value in enumerate(values))

    lines = [render(headers), "-+-".join("-" * width for width in widths)]
    lines.extend(render(row) for row in rows_list)
    return "\n".join(lines)


def main() -> int:
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}", file=sys.stderr)
        return 1

    connection = sqlite3.connect(DB_PATH)
    try:
        ensure_serial_column(connection)
        hosts = load_hosts(connection)
    finally:
        connection.close()

    if not hosts:
        print("No hosts present in inventory_hosts table.")
        return 0

    output_rows: List[Tuple[str, str, str, str, str]] = []
    summary_counts = {
        "MATCH": 0,
        "MULTIPLE": 0,
        "NOT_FOUND": 0,
        "MISSING_SERIAL": 0,
        "ERROR": 0,
    }

    for host in hosts:
        serial_to_use = host.serial
        if not serial_to_use and PYVMOMI_AVAILABLE and VCENTER_HOST and VCENTER_USER and VCENTER_PASS:
            live = _fetch_serial_from_vcenter(host.name)
            if live:
                serial_to_use = live
                print(f"Note: looked up serial from vCenter for {host.name}: {live}")

        location = resolve_location(serial_to_use)
        summary_counts.setdefault(location.status, 0)
        summary_counts[location.status] += 1
        site = location.site or "--"
        rack = location.rack or "--"
        status = location.status if location.detail is None else f"{location.status} ({location.detail})"
        output_rows.append((host.name or "--", serial_to_use or "--", site, rack, status))

    print("Server-to-Nautobot Location Mapping")
    print(format_table(output_rows))
    print()
    print(
        "Summary: "
        + ", ".join(f"{status}={count}" for status, count in summary_counts.items() if count)
        + f" (Total hosts: {len(hosts)})"
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - script entry point guard
    raise SystemExit(main())
