#!/usr/bin/env python3
"""Quick script for validating Cisco APIC REST endpoints."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

import httpx
import json
from dotenv import load_dotenv

DEFAULT_ENDPOINTS: Sequence[Tuple[str, str]] = (
    ("Tenants", "/api/class/fvTenant.json"),
    ("Application Profiles", "/api/class/fvAp.json"),
    ("Endpoint Groups", "/api/class/fvAEPg.json"),
    ("Fabric Nodes", "/api/class/fabricNode.json"),
)


def str_to_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    lowered = value.strip().lower()
    return lowered in {"1", "true", "yes", "on"}


def load_environment(dotenv_path: Path) -> None:
    if dotenv_path.exists():
        load_dotenv(dotenv_path)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    default_verify = str_to_bool(os.getenv("APIC_VERIFY_SSL"), False)

    parser = argparse.ArgumentParser(
        description="Authenticate against Cisco APIC and probe common inventory endpoints.",
    )
    parser.add_argument(
        "--host",
        default=os.getenv("APIC_HOST"),
        help="APIC hostname or IP (default pulled from APIC_HOST).",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("APIC_USERNAME"),
        help="APIC username (default pulled from APIC_USERNAME).",
    )
    parser.add_argument(
        "--password",
        default=os.getenv("APIC_PASSWORD"),
        help="APIC password (default pulled from APIC_PASSWORD).",
    )
    parser.add_argument(
        "--verify",
        dest="verify",
        action="store_true",
        help="Enable TLS certificate verification.",
    )
    parser.add_argument(
        "--no-verify",
        dest="verify",
        action="store_false",
        help="Disable TLS certificate verification (default unless APIC_VERIFY_SSL=true).",
    )
    parser.add_argument(
        "--endpoint",
        action="append",
        default=[],
        metavar="LABEL=PATH",
        help="Additional endpoint to query (format: label=/api/endpoint.json).",
    )
    parser.add_argument(
        "--sample-dir",
        default=os.getenv("ACI_SAMPLE_DIR", "data/samples/aci"),
        help="Directory to store JSON samples (relative to repo root).",
    )
    parser.set_defaults(verify=default_verify)

    args = parser.parse_args(argv)

    required_fields = [
        ("host", args.host),
        ("username", args.username),
        ("password", args.password),
    ]
    missing = [name for name, value in required_fields if not value]
    if missing:
        parser.error(f"Missing required connection parameter(s): {', '.join(missing)}")

    return args


def build_endpoint_list(extra: Iterable[str]) -> List[Tuple[str, str]]:
    endpoints = list(DEFAULT_ENDPOINTS)
    for item in extra:
        label, _, path = item.partition("=")
        label = (label or path).strip()
        path = (path or label).strip()
        if not path.startswith("/"):
            path = f"/{path}"
        endpoints.append((label or path, path))
    return endpoints


def authenticate(client: httpx.Client, username: str, password: str) -> str:
    payload = {"aaaUser": {"attributes": {"name": username, "pwd": password}}}
    response = client.post("/api/aaaLogin.json", json=payload)
    response.raise_for_status()
    data = response.json()
    try:
        token = data["imdata"][0]["aaaLogin"]["attributes"]["token"]
    except (KeyError, IndexError) as exc:  # pragma: no cover - defensive
        raise RuntimeError("Unexpected login response from APIC.") from exc

    client.cookies.set("APIC-cookie", token)
    return token


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def save_sample(sample_dir: Path, path: str, payload: dict, limit: int = 50) -> None:
    filename = path.strip("/").replace("/", "_") or "root"
    target = sample_dir / f"{filename}.json"
    subset = payload.copy()
    if "imdata" in subset:
        subset["imdata"] = subset["imdata"][:limit]
    target.write_text(json.dumps(subset, indent=2), encoding="utf-8")
    print(f"    Saved sample payload to {target}")


def probe_endpoints(
    client: httpx.Client,
    endpoints: Sequence[Tuple[str, str]],
    sample_dir: Path | None,
) -> None:
    for label, path in endpoints:
        response = client.get(path)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            print(f"[error] {label}: {exc}")
            continue

        payload = response.json()
        items = payload.get("imdata", [])
        count = len(items)
        print(f"[ok] {label}: {count} objects returned ({path})")

        if sample_dir is not None:
            save_sample(sample_dir, path, payload)

        lowered_label = label.lower()

        if lowered_label.startswith("fvcep") or path.endswith("/api/class/fvCEp.json"):
            sample = items[:5]
            print("    First 5 records (truncated):")
            for idx, item in enumerate(sample, start=1):
                dn = item.get("fvCEp", {}).get("attributes", {}).get("dn", "<missing dn>")
                addr = item.get("fvCEp", {}).get("attributes", {}).get("ip", "<missing ip>")
                mac = item.get("fvCEp", {}).get("attributes", {}).get("mac", "<missing mac>")
                print(f"      {idx}. dn={dn} ip={addr} mac={mac}")
            if count > 5:
                print("      ...")

        if "epmipep" in lowered_label or path.endswith("/api/node/class/epmIpEp.json"):
            sample = items[:5]
            print("    First 5 IP endpoint records (truncated):")
            for idx, item in enumerate(sample, start=1):
                attrs = item.get("epmIpEp", {}).get("attributes", {})
                dn = attrs.get("dn", "<missing dn>")
                addr = attrs.get("addr", "<missing addr>")
                mac = attrs.get("mac", "<missing mac>")
                vrf = attrs.get("vrfName", "<missing vrf>")
                print(f"      {idx}. dn={dn} addr={addr} mac={mac} vrf={vrf}")
            if count > 5:
                print("      ...")


def main(argv: Sequence[str]) -> int:
    backend_root = Path(__file__).resolve().parents[1]
    load_environment(backend_root / ".env")

    args = parse_args(argv)

    base_url = f"https://{args.host.strip()}"
    timeout = httpx.Timeout(30.0, read=60.0)

    try:
        sample_dir = None
        if args.sample_dir:
            repo_root = backend_root.parent
            sample_dir = (repo_root / args.sample_dir).resolve()
            ensure_directory(sample_dir)

        with httpx.Client(base_url=base_url, verify=args.verify, timeout=timeout) as client:
            print("[info] Logging into APIC...")
            authenticate(client, args.username, args.password)
            print("[info] Login succeeded. Querying endpoints...")
            endpoints = build_endpoint_list(args.endpoint)
            probe_endpoints(client, endpoints, sample_dir)
    except httpx.HTTPError as exc:
        print(f"[fatal] HTTP error while communicating with APIC: {exc}")
        return 1
    except RuntimeError as exc:
        print(f"[fatal] {exc}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
