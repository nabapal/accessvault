#!/usr/bin/env python3
"""Bulk-onboard CPNR VMs into the NetVerse inventory from a JSON file.

Input JSON: an object keyed by "<site>-<service>-<role>" (role in
primary|secondary|local), each value:
  {"base": "https://<ip>:<port>", "username": "...", "password": "...", "verify_ssl": false}

Derives: name, site, service, role, pair_id (primary+secondary share
"<site>-<service>"; local has none). Idempotent upsert keyed on mgmt_ip:
existing VMs are updated (credentials refreshed) rather than duplicated.

Usage (from backend/, venv active):
  python scripts/import_cpnr_vms.py --file cpnr_vms.json           # import + first sync
  python scripts/import_cpnr_vms.py --file cpnr_vms.json --no-sync # import only
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any, Dict, Tuple
from urllib.parse import urlparse

# Allow running as a script from anywhere: put the backend dir on the path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models import CpnrRole, CpnrVm
from app.services.cpnr_collector import run_collection_for_vm
from app.services.crypto import encrypt_secret

_ROLES = {"primary": CpnrRole.PRIMARY, "secondary": CpnrRole.SECONDARY, "local": CpnrRole.LOCAL}


def _parse_key(key: str) -> Tuple[str, str, str]:
    """'bangalore-utility-primary' -> (site, service, role)."""
    parts = key.split("-")
    if len(parts) < 2:
        raise ValueError(f"Cannot parse key '{key}' (expected <site>-<service>-<role>)")
    site = parts[0]
    role = parts[-1] if parts[-1] in _ROLES else "local"
    middle = parts[1:-1] if parts[-1] in _ROLES else parts[1:]
    service = "-".join(middle) or "default"
    return site, service, role


def _host_port(base: str) -> Tuple[str, int]:
    u = urlparse(base)
    return u.hostname or base, (u.port or 8443)


def _derive(key: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    site, service, role = _parse_key(key)
    host, port = _host_port(entry["base"])
    pair_id = f"{site}-{service}" if role in ("primary", "secondary") else None
    name = f"{site.title()}_CPNR_{service.upper()} - {role.title()}"
    return {
        "name": name,
        "site": site.title(),
        "service": service.upper(),
        "role": _ROLES[role],
        "pair_id": pair_id,
        "mgmt_ip": host,
        "port": port,
        "verify_ssl": 1 if entry.get("verify_ssl") else 0,
        "username": entry.get("username"),
        "password": entry.get("password"),
    }


async def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Bulk-onboard CPNR VMs from JSON.")
    ap.add_argument("--file", required=True, help="Path to the CPNR VMs JSON file")
    ap.add_argument("--no-sync", action="store_true", help="Skip the first inventory sync")
    ap.add_argument("--dry-run", action="store_true", help="Print what would be onboarded, change nothing")
    args = ap.parse_args(argv)

    with open(args.file, encoding="utf-8") as fh:
        raw: Dict[str, Any] = json.load(fh)

    rows = [_derive(k, v) for k, v in raw.items()]
    print(f"Parsed {len(rows)} VMs from {args.file}")
    for r in rows:
        print(f"  {r['mgmt_ip']:15s} {r['role'].value:9s} pair={r['pair_id'] or '-':22s} {r['name']}")
    if args.dry_run:
        return 0

    created = updated = synced = failed = 0
    async with AsyncSessionLocal() as db:
        for r in rows:
            password = r.pop("password", None)
            existing = (await db.execute(select(CpnrVm).where(CpnrVm.mgmt_ip == r["mgmt_ip"]))).scalar_one_or_none()
            if existing is None:
                vm = CpnrVm(**{k: v for k, v in r.items()})
                if password:
                    vm.password_secret = encrypt_secret(password)
                db.add(vm)
                created += 1
            else:
                for k, v in r.items():
                    setattr(existing, k, v)
                if password:
                    existing.password_secret = encrypt_secret(password)
                vm = existing
                updated += 1
        await db.commit()

        if not args.no_sync:
            vms = list((await db.execute(select(CpnrVm))).scalars().all())
            for vm in vms:
                if vm.mgmt_ip not in {r["mgmt_ip"] for r in rows}:
                    continue
                try:
                    res = await run_collection_for_vm(db, vm)
                    await db.commit()
                    if res.success:
                        synced += 1
                        print(f"  synced {vm.mgmt_ip}: {res.counts}")
                    else:
                        failed += 1
                        print(f"  sync FAILED {vm.mgmt_ip}: {res.message}")
                except Exception as exc:  # pragma: no cover
                    await db.rollback()
                    failed += 1
                    print(f"  sync ERROR {vm.mgmt_ip}: {exc}")

    print(f"\nDone. created={created} updated={updated} synced={synced} failed={failed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
