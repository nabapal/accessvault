#!/usr/bin/env python3
"""Phase-0 probe for CGNAT devices (A10 Thunder / ACOS and F5 BIG-IP).

Connects to a single device over its REST API and prints what inventory + CGNAT
data is reachable, so we can design the CGNAT inventory SDD from real output.
Read-only: only GETs (plus the vendor login/logout). Nothing is written to the device.

Usage:
  python scripts/probe_cgnat_device.py --vendor f5  --host 10.x.x.x --username admin --password '***'
  python scripts/probe_cgnat_device.py --vendor a10 --host 10.x.x.x --username admin --password '***'

Options: --port (default 443), --timeout (default 30).
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

import httpx


def _preview(obj: Any, depth: int = 2, max_items: int = 3) -> Any:
    """Shallow preview of a JSON object so output stays readable."""
    if isinstance(obj, dict):
        if depth == 0:
            return {"…": f"{len(obj)} keys"}
        out = {}
        for i, (k, v) in enumerate(obj.items()):
            if i >= max_items:
                out["…"] = f"+{len(obj) - max_items} more keys"
                break
            out[k] = _preview(v, depth - 1, max_items)
        return out
    if isinstance(obj, list):
        return [_preview(v, depth - 1, max_items) for v in obj[:max_items]] + (
            [f"+{len(obj) - max_items} more"] if len(obj) > max_items else []
        )
    if isinstance(obj, str) and len(obj) > 120:
        return obj[:120] + "…"
    return obj


def _get(client: httpx.Client, path: str, label: str) -> None:
    try:
        r = client.get(path)
    except Exception as exc:  # noqa: BLE001
        print(f"  [{label}] {path}\n     ERROR {type(exc).__name__}: {str(exc)[:120]}")
        return
    if r.status_code != 200:
        print(f"  [{label}] {path} -> HTTP {r.status_code} {r.text[:100]}")
        return
    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        print(f"  [{label}] {path} -> 200 (non-JSON, {len(r.text)} bytes)")
        return
    # count entries if it's a collection
    n = ""
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        n = f" items={len(data['items'])}"
    print(f"  [{label}] {path} -> 200{n}")
    print("     " + json.dumps(_preview(data), default=str)[:700])


F5_ENDPOINTS: List[tuple[str, str]] = [
    ("version", "/mgmt/tm/sys/version"),
    ("hardware", "/mgmt/tm/sys/hardware"),
    ("device", "/mgmt/tm/cm/device"),
    ("global-settings", "/mgmt/tm/sys/global-settings"),
    ("interfaces", "/mgmt/tm/net/interface"),
    ("self-ips", "/mgmt/tm/net/self"),
    ("vlans", "/mgmt/tm/net/vlan"),
    ("route-domains", "/mgmt/tm/net/route-domain"),
    ("virtual-servers", "/mgmt/tm/ltm/virtual"),
    ("lsn-pools (CGNAT)", "/mgmt/tm/ltm/lsn-pool"),
    ("lsn-pool-stats (CGNAT)", "/mgmt/tm/ltm/lsn-pool/stats"),
    ("provision (modules)", "/mgmt/tm/sys/provision"),
]


def probe_f5(host: str, port: int, user: str, pwd: str, timeout: float) -> None:
    base = f"https://{host}:{port}"
    with httpx.Client(base_url=base, verify=False, timeout=timeout) as client:
        # Token auth (falls back to basic auth on the GETs if this fails).
        token = None
        try:
            r = client.post(
                "/mgmt/shared/authn/login",
                json={"username": user, "password": pwd, "loginProviderName": "tmos"},
            )
            if r.status_code == 200:
                token = r.json().get("token", {}).get("token")
                print(f"auth: token acquired ({'yes' if token else 'no'})")
            else:
                print(f"auth: login HTTP {r.status_code}; falling back to basic auth")
        except Exception as exc:  # noqa: BLE001
            print(f"auth: token login failed ({exc}); falling back to basic auth")
        if token:
            client.headers["X-F5-Auth-Token"] = token
        else:
            client.auth = httpx.BasicAuth(user, pwd)

        print("\n== F5 BIG-IP iControl REST ==")
        for label, path in F5_ENDPOINTS:
            _get(client, path, label)


A10_ENDPOINTS: List[tuple[str, str]] = [
    ("version", "/axapi/v3/version/oper"),
    ("hostname", "/axapi/v3/hostname"),
    ("interfaces", "/axapi/v3/interface"),
    ("interfaces-eth-oper", "/axapi/v3/interface/ethernet/oper"),
    ("vlan", "/axapi/v3/network/vlan"),
    ("cgnv6 lsn pool", "/axapi/v3/cgnv6/lsn/pool"),
    ("cgnv6 lsn pool oper", "/axapi/v3/cgnv6/lsn/pool/oper"),
    ("cgnv6 nat pool", "/axapi/v3/cgnv6/nat/pool"),
    ("cgnv6 lsn global stats", "/axapi/v3/cgnv6/lsn/global/stats"),
    ("cgnv6 nat64", "/axapi/v3/cgnv6/nat64"),
    ("partitions", "/axapi/v3/partition-all/oper"),
]


def probe_a10(host: str, port: int, user: str, pwd: str, timeout: float) -> None:
    base = f"https://{host}:{port}"
    with httpx.Client(base_url=base, verify=False, timeout=timeout) as client:
        signature = None
        try:
            r = client.post("/axapi/v3/auth", json={"credentials": {"username": user, "password": pwd}})
            if r.status_code == 200:
                signature = r.json().get("authresponse", {}).get("signature")
                print(f"auth: signature acquired ({'yes' if signature else 'no'})")
            else:
                print(f"auth: HTTP {r.status_code} {r.text[:120]}")
                return
        except Exception as exc:  # noqa: BLE001
            print(f"auth: failed ({exc})")
            return
        client.headers["Authorization"] = f"A10 {signature}"
        client.headers["Content-Type"] = "application/json"

        print("\n== A10 Thunder / ACOS aXAPI v3 ==")
        for label, path in A10_ENDPOINTS:
            _get(client, path, label)

        try:
            client.post("/axapi/v3/logoff")
        except Exception:  # noqa: BLE001
            pass


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description="Probe a CGNAT device (A10 / F5) for reachable inventory + CGNAT data.")
    p.add_argument("--vendor", required=True, choices=["a10", "f5"])
    p.add_argument("--host", required=True)
    p.add_argument("--username", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--port", type=int, default=443)
    p.add_argument("--timeout", type=float, default=30.0)
    args = p.parse_args(argv)

    print(f"Probing {args.vendor.upper()} {args.host}:{args.port} as {args.username}\n")
    if args.vendor == "f5":
        probe_f5(args.host, args.port, args.username, args.password, args.timeout)
    else:
        probe_a10(args.host, args.port, args.username, args.password, args.timeout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
