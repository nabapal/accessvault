#!/usr/bin/env python3
"""Verify Nautobot site/rack mappings for server serial numbers.

This diagnostic script cross-references a list of server serial numbers with
Nautobot's device inventory to confirm whether location metadata (site and rack)
can be resolved ahead of application integration.

Usage examples:
    # Provide serials inline
    python -m app.scripts.verify_server_nautobot --serial SN123 --serial SN456

    # Read serials from a CSV file (columns: serial, optional name, identifier)
    python -m app.scripts.verify_server_nautobot --input server_serials.csv

The script requires NAUTOBOT_BASE_URL and NAUTOBOT_TOKEN to be configured (e.g.
in backend/.env). Results are printed to stdout and can optionally be written to
CSV via --output.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

import httpx

from app.core.config import get_settings
from app.services.nautobot import compute_device_location


@dataclass(slots=True)
class ServerRecord:
    identifier: str
    serial: str
    name: Optional[str] = None


@dataclass(slots=True)
class MatchResult:
    device_id: str
    device_name: str
    site: Optional[str]
    rack_location: Optional[str]


@dataclass(slots=True)
class VerificationResult:
    record: ServerRecord
    status: str
    matches: Sequence[MatchResult]
    error: Optional[str] = None


STATUS_MATCH = "MATCH"
STATUS_MULTIPLE = "MULTIPLE"
STATUS_NOT_FOUND = "NOT_FOUND"
STATUS_ERROR = "ERROR"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify Nautobot location enrichment for server serials")
    parser.add_argument(
        "--input",
        type=Path,
        help="Optional CSV file containing server records. Must include a 'serial' column.",
    )
    parser.add_argument(
        "--serial",
        dest="serials",
        action="append",
        default=[],
        help="Serial number to verify. Can be supplied multiple times.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path to write verification results as CSV.",
    )
    parser.add_argument(
        "--fallback-name",
        action="store_true",
        help="If enabled, perform a secondary lookup by device name when serial lookup returns no results.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="HTTP timeout in seconds for Nautobot requests (default: 30).",
    )
    return parser.parse_args()


def load_records_from_csv(path: Path) -> List[ServerRecord]:
    if not path.exists():
        raise FileNotFoundError(f"CSV input not found: {path}")
    records: List[ServerRecord] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or "serial" not in reader.fieldnames:
            raise ValueError("CSV must include a 'serial' column")
        for row in reader:
            serial = (row.get("serial") or "").strip()
            if not serial:
                continue
            name = (row.get("name") or row.get("device_name") or "").strip() or None
            identifier = (
                (row.get("identifier") or "").strip()
                or name
                or serial
            )
            records.append(ServerRecord(identifier=identifier, serial=serial, name=name))
    return records


def load_records(args: argparse.Namespace) -> List[ServerRecord]:
    records: List[ServerRecord] = []
    if args.input:
        records.extend(load_records_from_csv(args.input))
    for value in args.serials:
        serial = value.strip()
        if not serial:
            continue
        records.append(ServerRecord(identifier=serial, serial=serial))
    if not records:
        raise SystemExit("No server serials provided. Use --serial or --input to supply data.")
    return records


async def query_devices_by_serial(
    client: httpx.AsyncClient,
    serial: str,
) -> List[dict]:
    response = await client.get("/dcim/devices/", params={"serial": serial})
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results", [])
    return [item for item in results if isinstance(item, dict)]


async def query_devices_by_name(
    client: httpx.AsyncClient,
    name: str,
) -> List[dict]:
    response = await client.get("/dcim/devices/", params={"name": name})
    response.raise_for_status()
    payload = response.json()
    results = payload.get("results", [])
    return [item for item in results if isinstance(item, dict)]


def build_match_results(devices: Iterable[dict]) -> List[MatchResult]:
    matches: List[MatchResult] = []
    for device in devices:
        device_id = str(device.get("id")) if device.get("id") is not None else ""
        device_name = device.get("name") or device.get("display") or "<unnamed>"
        site, rack = compute_device_location(device)
        matches.append(
            MatchResult(
                device_id=device_id,
                device_name=device_name,
                site=site,
                rack_location=rack,
            )
        )
    return matches


async def verify_records(
    records: Sequence[ServerRecord],
    *,
    fallback_by_name: bool,
    timeout: float,
) -> List[VerificationResult]:
    settings = get_settings()
    if not settings.nautobot_base_url or not settings.nautobot_token:
        raise SystemExit(
            "Nautobot credentials missing. Ensure NAUTOBOT_BASE_URL and NAUTOBOT_TOKEN are configured."
        )

    base_url = settings.nautobot_base_url.rstrip("/")
    headers = {
        "Accept": "application/json",
        "Authorization": f"Token {settings.nautobot_token}",
        "User-Agent": "InfraPulse-Verify/1.0",
    }
    timeout_config = httpx.Timeout(timeout, read=timeout)

    results: List[VerificationResult] = []
    async with httpx.AsyncClient(base_url=base_url, headers=headers, timeout=timeout_config) as client:
        for record in records:
            try:
                devices = await query_devices_by_serial(client, record.serial)
                if not devices and fallback_by_name and record.name:
                    devices = await query_devices_by_name(client, record.name)
                matches = build_match_results(devices)
                if not matches:
                    status = STATUS_NOT_FOUND
                elif len(matches) == 1:
                    status = STATUS_MATCH
                else:
                    status = STATUS_MULTIPLE
                results.append(
                    VerificationResult(
                        record=record,
                        status=status,
                        matches=matches,
                    )
                )
            except httpx.HTTPStatusError as exc:  # pragma: no cover - runtime guard
                results.append(
                    VerificationResult(
                        record=record,
                        status=STATUS_ERROR,
                        matches=(),
                        error=f"HTTP {exc.response.status_code}: {exc.response.text[:200]}",
                    )
                )
            except httpx.TimeoutException:  # pragma: no cover - runtime guard
                results.append(
                    VerificationResult(
                        record=record,
                        status=STATUS_ERROR,
                        matches=(),
                        error="Request timed out",
                    )
                )
    return results


def print_results(results: Sequence[VerificationResult]) -> None:
    headers = [
        "Identifier",
        "Serial",
        "Status",
        "Matched Devices",
        "Site",
        "Rack/Location",
    ]
    rows: List[List[str]] = []
    for result in results:
        if result.matches:
            for idx, match in enumerate(result.matches):
                rows.append(
                    [
                        result.record.identifier if idx == 0 else "",
                        result.record.serial if idx == 0 else "",
                        result.status if idx == 0 else "",
                        f"{match.device_name} (ID: {match.device_id})",
                        match.site or "--",
                        match.rack_location or "--",
                    ]
                )
        else:
            rows.append(
                [
                    result.record.identifier,
                    result.record.serial,
                    result.status,
                    result.error or "--",
                    "--",
                    "--",
                ]
            )

    column_widths = [max(len(row[i]) for row in [headers] + rows) for i in range(len(headers))]

    def _format_line(values: Sequence[str]) -> str:
        return " | ".join(value.ljust(column_widths[idx]) for idx, value in enumerate(values))

    print(_format_line(headers))
    print("-+-".join("-" * width for width in column_widths))
    for row in rows:
        print(_format_line(row))

    total = len(results)
    matched = sum(1 for item in results if item.status == STATUS_MATCH)
    multiples = sum(1 for item in results if item.status == STATUS_MULTIPLE)
    not_found = sum(1 for item in results if item.status == STATUS_NOT_FOUND)
    errors = sum(1 for item in results if item.status == STATUS_ERROR)
    print()
    print(
        f"Summary: {matched} matched, {multiples} multiple matches, {not_found} not found, {errors} errors (total {total})."
    )


def write_results_csv(path: Path, results: Sequence[VerificationResult]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "identifier",
            "serial",
            "status",
            "device_id",
            "device_name",
            "site",
            "rack_location",
            "error",
        ])
        for result in results:
            if result.matches:
                for match in result.matches:
                    writer.writerow(
                        [
                            result.record.identifier,
                            result.record.serial,
                            result.status,
                            match.device_id,
                            match.device_name,
                            match.site or "",
                            match.rack_location or "",
                            "",
                        ]
                    )
            else:
                writer.writerow(
                    [
                        result.record.identifier,
                        result.record.serial,
                        result.status,
                        "",
                        "",
                        "",
                        "",
                        result.error or "",
                    ]
                )


def main() -> None:
    args = parse_arguments()
    records = load_records(args)
    results = asyncio.run(
        verify_records(
            records,
            fallback_by_name=args.fallback_name,
            timeout=args.timeout,
        )
    )
    print_results(results)
    if args.output:
        write_results_csv(args.output, results)
        print(f"\nCSV results written to {args.output}")


if __name__ == "__main__":  # pragma: no cover - module entry point guard
    main()
