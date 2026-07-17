#!/usr/bin/env python3
"""Phase-0 probe: ESXi host details + LLDP/CDP neighbor info per physical NIC.

Read-only. Connects to an ESXi host or vCenter (pyVmomi) and prints, per host:
hardware/BIOS/version facts, management IPs, physical NICs, and the LLDP (and CDP)
switch-neighbor info discovered on each uplink via QueryNetworkHint.

Run standalone with --host/--user/--password, or via the inventory endpoint with
--endpoint <address> (pulls the stored, encrypted credentials).
"""
from __future__ import annotations

import argparse
import ssl
import sys
from pathlib import Path
from typing import Any, List, Optional

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from pyVim.connect import Disconnect, SmartConnect  # noqa: E402
from pyVmomi import vim  # noqa: E402


def _lldp_params(lldp: Any) -> dict:
    out = {}
    for kv in getattr(lldp, "parameter", []) or []:
        key = getattr(kv, "key", None)
        val = getattr(kv, "value", None)
        if key is not None:
            out[str(key)] = str(val)
    return out


def _probe(host: str, port: int, user: str, password: str) -> None:
    ctx = ssl._create_unverified_context()
    si = SmartConnect(host=host, user=user, pwd=password, port=port, sslContext=ctx)
    try:
        content = si.RetrieveContent()
        about = content.about
        print(f"connected: apiType={about.apiType} version={about.version} build={about.build}\n")
        for dc in content.rootFolder.childEntity:
            hf = getattr(dc, "hostFolder", None)
            if hf is None:
                continue
            for cr in hf.childEntity:
                for h in getattr(cr, "host", []) or []:
                    _dump_host(h)
    finally:
        Disconnect(si)


def _dump_host(h: vim.HostSystem) -> None:
    summary = h.summary
    hw = summary.hardware
    cfg = getattr(h, "config", None)
    prod = getattr(getattr(cfg, "product", None), "fullName", None) if cfg else None
    print("=" * 70)
    print(f"HOST: {summary.config.name}")
    print(f"  vendor/model : {getattr(hw,'vendor',None)} {getattr(hw,'model',None)}")
    print(f"  cpu          : {getattr(hw,'cpuModel',None)} ({getattr(hw,'numCpuPkgs',None)} pkg / {getattr(hw,'numCpuCores',None)} cores)")
    print(f"  memory GB    : {round((getattr(hw,'memorySize',0) or 0)/(1024**3),1)}")
    print(f"  bios         : {getattr(getattr(hw,'biosInfo',None),'biosVersion',None)}")
    print(f"  esxi         : {prod}")
    print(f"  uptime s     : {getattr(summary.quickStats,'uptime',None)}")
    # management / vmk IPs
    net = getattr(cfg, "network", None) if cfg else None
    if net:
        for vnic in getattr(net, "vnic", []) or []:
            ip = getattr(getattr(vnic, "spec", None), "ip", None)
            print(f"  vmk {vnic.device:6} portgroup={getattr(vnic,'portgroup',None)} ip={getattr(ip,'ipAddress',None)}")

    # physical NICs + LLDP/CDP
    ns = h.configManager.networkSystem
    pnics = {p.device: p for p in (getattr(net, "pnic", []) or [])} if net else {}
    try:
        hints = ns.QueryNetworkHint()
    except Exception as exc:  # noqa: BLE001
        print(f"  QueryNetworkHint error: {exc}")
        hints = []
    print(f"  --- physical NICs ({len(pnics)}), LLDP/CDP per uplink ---")
    for hint in hints:
        dev = getattr(hint, "device", None)
        p = pnics.get(dev)
        speed = getattr(getattr(p, "linkSpeed", None), "speedMb", None) if p else None
        mac = getattr(p, "mac", None) if p else None
        line = f"  {dev} mac={mac} speed={speed}Mb"
        lldp = getattr(hint, "lldpInfo", None)
        cdp = getattr(hint, "connectedSwitchPort", None)
        print(line)
        if lldp:
            params = _lldp_params(lldp)
            print(f"     LLDP: chassisId={getattr(lldp,'chassisId',None)} portId={getattr(lldp,'portId',None)} ttl={getattr(lldp,'timeToLive',None)}")
            for k in ("System Name", "System Description", "Port Description", "Management Address", "Port VLAN"):
                if k in params:
                    print(f"        {k}: {params[k][:80]}")
        if cdp:
            print(f"     CDP : devId={getattr(cdp,'devId',None)} portId={getattr(cdp,'portId',None)} mgmt={getattr(cdp,'address',None)} platform={getattr(cdp,'hardwarePlatform',None)}")
        if not lldp and not cdp:
            print("     (no LLDP/CDP neighbor advertised on this uplink)")


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description="Probe ESXi/vCenter for host details + LLDP/CDP.")
    p.add_argument("--host")
    p.add_argument("--user")
    p.add_argument("--password")
    p.add_argument("--port", type=int, default=443)
    p.add_argument("--endpoint", help="Use a stored inventory endpoint by address (pulls creds)")
    args = p.parse_args(argv)

    host, user, password, port = args.host, args.user, args.password, args.port
    if args.endpoint:
        import asyncio
        from sqlalchemy import select
        from app.core.database import AsyncSessionLocal
        from app.models import InventoryEndpoint
        from app.services.crypto import decrypt_secret

        async def _load() -> Optional[tuple]:
            async with AsyncSessionLocal() as s:
                ep = (await s.execute(select(InventoryEndpoint).where(InventoryEndpoint.address == args.endpoint))).scalars().first()
                if not ep:
                    return None
                return ep.address, ep.username, decrypt_secret(ep.password_secret), ep.port or 443

        loaded = asyncio.run(_load())
        if not loaded:
            print(f"endpoint {args.endpoint} not found")
            return 1
        host, user, password, port = loaded

    if not host or not user or not password:
        p.error("provide --host/--user/--password or --endpoint")
    print(f"Probing {host}:{port} as {user}\n")
    _probe(host, port, user, password)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
