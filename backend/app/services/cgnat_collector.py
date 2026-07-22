from __future__ import annotations

import ipaddress
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    CgnatDevice,
    CgnatDeviceStatus,
    CgnatInterface,
    CgnatNatPool,
    CgnatStaticRoute,
    CgnatVendor,
)
from app.services.crypto import decrypt_secret
from app.services.nautobot import fetch_nautobot_device_facts_by_name

logger = logging.getLogger(__name__)

_UPTIME_UNITS = {"year": 31536000, "week": 604800, "day": 86400, "hour": 3600, "minute": 60, "second": 1}


@dataclass
class CgnatCollectionResult:
    success: bool
    timestamp: datetime
    snapshot: Optional[Dict[str, Any]] = None
    message: Optional[str] = None


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _uptime_seconds(text: str | None) -> int | None:
    if not text:
        return None
    total = 0
    found = False
    for num, unit in re.findall(r"(\d+)\s*(year|week|day|hour|minute|second)s?", text.lower()):
        total += int(num) * _UPTIME_UNITS[unit]
        found = True
    return total if found else None


def _v4_cidr(addr: Any, netmask: Any) -> str | None:
    """Combine an IPv4 address + dotted-quad netmask into CIDR (e.g. 10.0.0.1/29)."""
    a = _clean(addr)
    if not a:
        return None
    m = _clean(netmask)
    if m:
        try:
            return f"{a}/{ipaddress.IPv4Network(f'0.0.0.0/{m}').prefixlen}"
        except (ValueError, ipaddress.AddressValueError):
            pass
    return a


def _short_vlan(value: Any) -> str | None:
    """F5 vlan/interface path '/Common/vl_x' -> 'vl_x'."""
    if not isinstance(value, str):
        return None
    return value.rstrip("/").split("/")[-1] or None


def _rd_from(value: Any) -> str | None:
    """Extract the F5 route-domain id from an address like '10.0.0.1%302/29' -> '302'."""
    if isinstance(value, str) and "%" in value:
        return value.split("%", 1)[1].split("/")[0].strip() or None
    return None


def _to_network(addr: str) -> "ipaddress._BaseNetwork | None":
    """Parse an interface address string into an ip_network, dropping any %rd token.
    Accepts '10.0.0.1%302/29', '10.0.0.1/29', '2405::1/125'."""
    if not addr:
        return None
    a = addr
    if "%" in a:
        left, right = a.split("%", 1)
        a = left + ("/" + right.split("/", 1)[1] if "/" in right else "")
    try:
        return ipaddress.ip_network(a, strict=False)
    except (ValueError, ipaddress.AddressValueError):
        return None


def _resolve_route_egress(routes: List[Dict[str, Any]], ifaces: List[Dict[str, Any]], scope_field: str) -> None:
    """Resolve each route's next_hop to the egress interface + VLAN by longest-prefix
    match against interface subnets, within the same tenancy scope (R7). Mutates routes."""
    candidates: List[tuple] = []  # (network, iface_name, vlan, scope)
    for i in ifaces:
        for a in (i.get("addresses") or []):
            net = _to_network(a)
            if net is not None:
                candidates.append((net, i.get("name"), i.get("vlan"), i.get(scope_field)))
    for r in routes:
        r["egress_interface"] = None
        r["egress_vlan"] = None
        nh = r.get("next_hop")
        if not nh:
            continue
        bare = nh.split("%")[0].split("/")[0].strip()
        try:
            ip = ipaddress.ip_address(bare)
        except ValueError:
            continue
        rscope = r.get(scope_field)
        best: tuple | None = None  # (prefixlen, name, vlan)
        for net, name, vlan, iscope in candidates:
            if iscope != rscope or ip.version != net.version:
                continue
            if ip in net and (best is None or net.prefixlen > best[0]):
                best = (net.prefixlen, name, vlan)
        if best is not None:
            r["egress_interface"] = best[1]
            r["egress_vlan"] = best[2]


# --------------------------------------------------------------------------- A10

async def _collect_a10(client: httpx.AsyncClient, user: str, pwd: str) -> Dict[str, Any]:
    r = await client.post("/axapi/v3/auth", json={"credentials": {"username": user, "password": pwd}})
    r.raise_for_status()
    signature = r.json().get("authresponse", {}).get("signature")
    if not signature:
        raise RuntimeError("A10 auth returned no signature")
    client.headers["Authorization"] = f"A10 {signature}"

    async def get(path: str) -> Dict[str, Any]:
        try:
            resp = await client.get(path)
            if resp.status_code == 200:
                return resp.json()
        except httpx.HTTPError as exc:
            logger.debug("A10 GET %s failed: %s", path, exc)
        return {}

    async def switch(scope: str) -> None:
        try:
            await client.post(f"/axapi/v3/active-partition/{scope}")
        except httpx.HTTPError:
            pass

    def build_ves(ve_list: List[Dict[str, Any]], vlans_raw: List[Dict[str, Any]], scope: str) -> List[Dict[str, Any]]:
        # VLAN <-> ve (SVI) mapping: network/vlan carries `ve` = the ve ifnum it backs.
        ve_to_vlan: Dict[Any, str] = {}
        for vl in vlans_raw:
            ve_num = vl.get("ve")
            if ve_num is not None:
                ve_to_vlan[ve_num] = _clean(vl.get("vlan-num")) or _clean(vl.get("name"))
        out: List[Dict[str, Any]] = []
        for ve in ve_list:
            ip_blk = ve.get("ip") or {}
            ip6_blk = ve.get("ipv6") or {}
            v4_addrs = ip_blk.get("address-list") or []
            v6_addrs = ip6_blk.get("address-list") or []
            addresses: List[str] = []
            for a in v4_addrs:
                cidr = _v4_cidr(a.get("ipv4-address"), a.get("ipv4-netmask"))
                if cidr:
                    addresses.append(cidr)
            for a in v6_addrs:
                v6 = _clean(a.get("ipv6-addr"))
                if v6:
                    addresses.append(v6)
            first_v4 = _clean(v4_addrs[0].get("ipv4-address")) if v4_addrs else None
            inside = bool(ip_blk.get("inside")) or bool(ip6_blk.get("inside"))
            outside = bool(ip_blk.get("outside")) or bool(ip6_blk.get("outside"))
            nat_role = "inside" if inside else ("outside" if outside else "other")
            out.append(
                {
                    "name": f"ve{ve.get('ifnum')}",
                    "description": _clean(ve.get("name")),
                    "admin_state": _clean(ve.get("action")),
                    "oper_state": None,
                    "ip_address": first_v4,
                    "addresses": addresses,
                    "nat_role": nat_role,
                    "partition": scope,
                    "route_domain": None,
                    "vlan": ve_to_vlan.get(ve.get("ifnum")),
                    "mtu": _int(ve.get("mtu")),
                    "mac": None,
                    "attributes": {"kind": "ve"},
                }
            )
        return out

    def build_pools(pools: List[Dict[str, Any]], groups: List[Dict[str, Any]], scope: str) -> List[Dict[str, Any]]:
        pool_group: Dict[str, str] = {}
        for g in groups:
            gname = g.get("pool-group-name")
            for m in g.get("member-list", []) or []:
                if m.get("pool-name"):
                    pool_group[m["pool-name"]] = gname
        out: List[Dict[str, Any]] = []
        for p in pools:
            name = p.get("pool-name")
            if not name:
                continue
            out.append(
                {
                    "pool_name": name,
                    "kind": "nat",
                    "mode": None,
                    "partition": scope,
                    "route_domain": None,
                    "start_address": _clean(p.get("start-address")),
                    "end_address": _clean(p.get("end-address")),
                    "prefix": _clean(p.get("netmask")),
                    "port_block_size": _int(p.get("port-batch-v2-size")),
                    "log_profile": None,
                    "pool_group": pool_group.get(name),
                    "active_translations": None,
                    "translation_requests": None,
                    "translation_failures": None,
                    "port_util_pct": None,
                    "attributes": {k: v for k, v in p.items() if k not in ("uuid", "a10-url")},
                }
            )
        return out

    def build_routes(routes_v4: List[Dict[str, Any]], routes_v6: List[Dict[str, Any]], scope: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for r in routes_v4:
            dest = f"{r.get('ip-dest-addr')}{r.get('ip-mask') or ''}"
            for nh in (r.get("ip-nexthop-ipv4") or [{}]):
                out.append(
                    {
                        "name": None,
                        "destination": dest,
                        "next_hop": _clean(nh.get("ip-next-hop")),
                        "distance": _int(nh.get("distance-nexthop-ip")),
                        "route_domain": None,
                        "partition": scope,
                        "family": "ipv4",
                        "description": _clean(nh.get("description-nexthop-ip")),
                        "attributes": {},
                    }
                )
        for r in routes_v6:
            dest = _clean(r.get("ipv6-address"))
            for nh in (r.get("ipv6-nexthop-ipv6") or [{}]):
                out.append(
                    {
                        "name": None,
                        "destination": dest,
                        "next_hop": _clean(nh.get("ipv6-nexthop")),
                        "distance": _int(nh.get("distance")),
                        "route_domain": None,
                        "partition": scope,
                        "family": "ipv6",
                        "description": _clean(nh.get("description")),
                        "attributes": {},
                    }
                )
        return out

    ifaces: List[Dict[str, Any]] = []
    pool_rows: List[Dict[str, Any]] = []
    routes: List[Dict[str, Any]] = []
    try:
        # Global / shared-context facts + device-wide CGNAT stats.
        version = (await get("/axapi/v3/version/oper")).get("version", {}).get("oper", {})
        hostname = (await get("/axapi/v3/hostname")).get("hostname", {}).get("value")
        interfaces_raw = (await get("/axapi/v3/interface")).get("interface", {})
        stats = (await get("/axapi/v3/cgnv6/lsn/global/stats")).get("global", {}).get("stats", {})

        # Enumerate L3V partitions; iterate shared + each active partition (R8).
        part_list = (
            (await get("/axapi/v3/partition-all/oper")).get("partition-all", {}).get("oper", {}).get("partition-list", [])
        )
        active_parts = [p.get("partition-name") for p in part_list if p.get("status") == "Active" and p.get("partition-name")]
        scopes = ["shared"] + active_parts

        # Physical (ethernet) interfaces are global -> tag as shared.
        for eth in (interfaces_raw.get("ethernet-list") or []):
            ifaces.append(
                {
                    "name": f"ethernet{eth.get('ifnum')}",
                    "description": _clean(eth.get("name")),
                    "admin_state": _clean(eth.get("action")),
                    "oper_state": None,
                    "ip_address": None,
                    "addresses": [],
                    "nat_role": None,
                    "partition": "shared",
                    "route_domain": None,
                    "vlan": None,
                    "mtu": _int(eth.get("mtu")),
                    "mac": None,
                    "attributes": {"kind": "ethernet"},
                }
            )

        for scope in scopes:
            await switch(scope)
            ve_list = (await get("/axapi/v3/interface/ve")).get("ve-list", [])
            vlans_raw = (await get("/axapi/v3/network/vlan")).get("vlan-list", [])
            pools = (await get("/axapi/v3/cgnv6/nat/pool")).get("pool-list", [])
            groups = (await get("/axapi/v3/cgnv6/nat/pool-group")).get("pool-group-list", [])
            routes_v4 = (await get("/axapi/v3/ip/route/rib")).get("rib-list", [])
            routes_v6 = (await get("/axapi/v3/ipv6/route/rib")).get("rib-list", [])
            ifaces.extend(build_ves(ve_list, vlans_raw, scope))
            pool_rows.extend(build_pools(pools, groups, scope))
            routes.extend(build_routes(routes_v4, routes_v6, scope))
    finally:
        await switch("shared")
        try:
            await client.post("/axapi/v3/logoff")
        except httpx.HTTPError:
            pass

    facts = {
        "hostname": _clean(hostname),
        "model": _clean(version.get("hw-platform") or version.get("series-name")),
        "serial": _clean(version.get("serial-number")),
        "os_version": _clean(version.get("sw-version")),
        "uptime_text": _clean(version.get("up-time")),
        "uptime_seconds": _uptime_seconds(version.get("up-time")),
    }

    def s(key: str) -> int:
        return _int(stats.get(key)) or 0

    metrics = {
        "active_sessions": s("data_session_created") - s("data_session_freed"),
        "active_subscribers": s("user_quota_created") - s("user_quota_put_in_del_q"),
        "total_translations": s("total_tcp_allocated") + s("total_udp_allocated") + s("total_icmp_allocated"),
        "port_util_pct": None,
        "exhaustion_events": (
            s("nat_port_unavailable_tcp") + s("nat_port_unavailable_udp") + s("nat_port_unavailable_icmp")
            + s("user_quota_failure") + s("new_user_resource_unavailable")
            + s("tcp_user_quota_exceeded") + s("udp_user_quota_exceeded") + s("icmp_user_quota_exceeded")
        ),
        "virtual_server_count": None,
    }

    _resolve_route_egress(routes, ifaces, "partition")
    return {"facts": facts, "interfaces": ifaces, "pools": pool_rows, "routes": routes, "metrics": metrics, "raw_stats": stats}


# --------------------------------------------------------------------------- F5

async def _collect_f5(client: httpx.AsyncClient, user: str, pwd: str) -> Dict[str, Any]:
    r = await client.post(
        "/mgmt/shared/authn/login",
        json={"username": user, "password": pwd, "loginProviderName": "tmos"},
    )
    r.raise_for_status()
    token = r.json().get("token", {}).get("token")
    if token:
        client.headers["X-F5-Auth-Token"] = token
    else:
        client.auth = httpx.BasicAuth(user, pwd)

    async def get(path: str) -> Dict[str, Any]:
        try:
            resp = await client.get(path)
            if resp.status_code == 200:
                return resp.json()
        except httpx.HTTPError as exc:
            logger.debug("F5 GET %s failed: %s", path, exc)
        return {}

    device_items = (await get("/mgmt/tm/cm/device")).get("items", [])
    device = device_items[0] if device_items else {}
    interfaces = (await get("/mgmt/tm/net/interface")).get("items", [])
    self_ips = (await get("/mgmt/tm/net/self")).get("items", [])
    pools = (await get("/mgmt/tm/ltm/lsn-pool")).get("items", [])
    pool_stats = (await get("/mgmt/tm/ltm/lsn-pool/stats")).get("entries", {})
    virtuals = (await get("/mgmt/tm/ltm/virtual")).get("items", [])
    net_routes = (await get("/mgmt/tm/net/route")).get("items", [])

    _f5_ver = _clean(device.get("version"))
    _f5_build = _clean(device.get("build"))
    facts = {
        "hostname": _clean(device.get("name")),
        "model": _clean(device.get("marketingName") or device.get("platformId")),
        "serial": _clean(device.get("chassisId")),
        # include build to match A10's "version, build N" format.
        "os_version": f"{_f5_ver}, build {_f5_build}" if _f5_ver and _f5_build else _f5_ver,
        "uptime_text": None,
        "uptime_seconds": None,
    }

    # NAT role by VLAN (verified §D3): a VLAN is *inside* when a virtual server
    # listens on it (virtual.vlans), *outside* when it is an LSN pool egress
    # interface (lsn-pool.egressInterfaces); else "other". Outside wins on
    # the rare overlap.
    inside_vlans: set[str] = set()
    for v in virtuals:
        for vl in (v.get("vlans") or []):
            short = _short_vlan(vl)
            if short:
                inside_vlans.add(short)
    outside_vlans: set[str] = set()
    for p in pools:
        for vl in (p.get("egressInterfaces") or []):
            short = _short_vlan(vl)
            if short:
                outside_vlans.add(short)

    def _f5_role(vlan_short: str | None) -> str | None:
        if not vlan_short:
            return None
        if vlan_short in outside_vlans:
            return "outside"
        if vlan_short in inside_vlans:
            return "inside"
        return "other"

    ifaces: List[Dict[str, Any]] = []
    for i in interfaces:
        ifaces.append(
            {
                "name": i.get("name"),
                "description": _clean(i.get("description")),
                "admin_state": _clean(i.get("enabled") and "enabled" or i.get("disabled") and "disabled"),
                "oper_state": _clean(i.get("mediaActive")),
                "ip_address": None,
                "addresses": [],
                "nat_role": None,
                "partition": _clean(i.get("partition")),
                "route_domain": None,
                "vlan": None,
                "mtu": _int(i.get("mtu")),
                "mac": _clean(i.get("macAddress")),
                "attributes": {"kind": "physical"},
            }
        )
    # L3 IP addresses live on self-IPs (address carries %<route-domain>/<prefix>).
    for sf in self_ips:
        vlan = _short_vlan(sf.get("vlan")) or _clean(sf.get("vlan"))
        addr = _clean(sf.get("address"))
        ifaces.append(
            {
                "name": sf.get("name"),
                "description": None,
                # self-IPs have no admin enable/disable; report link state as "up".
                "admin_state": "up",
                "oper_state": None,
                "ip_address": addr,
                "addresses": [addr] if addr else [],
                "nat_role": _f5_role(vlan),
                "partition": _clean(sf.get("partition")),
                "route_domain": _rd_from(addr),
                "vlan": vlan,
                "mtu": None,
                "mac": None,
                "attributes": {"kind": "self-ip", "trafficGroup": sf.get("trafficGroup"), "floating": sf.get("floating")},
            }
        )

    # index per-pool stats by pool fullPath/name
    def _stat_map() -> Dict[str, Dict[str, Any]]:
        out: Dict[str, Dict[str, Any]] = {}
        for _url, entry in pool_stats.items():
            nested = (entry.get("nestedStats", {}) or {}).get("entries", {})
            name = (nested.get("tmName", {}) or {}).get("description")
            if not name:
                continue
            flat: Dict[str, Any] = {}
            for k, v in nested.items():
                flat[k] = v.get("value", v.get("description"))
            out[name] = flat
        return out

    stat_by_pool = _stat_map()

    pool_rows: List[Dict[str, Any]] = []
    dev_sessions = dev_trans = dev_fail = 0
    worst_util: float | None = None
    for p in pools:
        full = p.get("fullPath") or p.get("name")
        st = stat_by_pool.get(full, {})
        active = _int(st.get("common.activeTranslations"))
        requests = _int(st.get("common.translationRequests"))
        fails = (_int(st.get("common.translationRequestFailures")) or 0) + (_int(st.get("pba.portBlockAllocationFailures")) or 0)
        util = None
        total_blocks = _int(st.get("pba.totalPortBlocks")) or 0
        free_pct = st.get("pba.percentFreePortBlocks")
        if total_blocks > 0 and free_pct is not None:
            util = round(100.0 - float(free_pct), 1)
            worst_util = util if worst_util is None else max(worst_util, util)
        dev_sessions += active or 0
        dev_trans += requests or 0
        dev_fail += fails
        pba = p.get("portBlockAllocation") or {}
        members = p.get("members", []) or []
        pool_rows.append(
            {
                "pool_name": p.get("name"),
                "kind": "lsn",
                "mode": _clean(p.get("mode")),
                "partition": _clean(p.get("partition")),
                "route_domain": _rd_from(members[0]) if members else None,
                "start_address": None,
                "end_address": None,
                "prefix": ", ".join(p.get("members", []) or []) or None,
                "port_block_size": _int(pba.get("blockSize")),
                "log_profile": _clean(p.get("logProfile")),
                "pool_group": None,
                "active_translations": active,
                "translation_requests": requests,
                "translation_failures": fails,
                "port_util_pct": util,
                "attributes": {"members": p.get("members", []), "hairpinMode": p.get("hairpinMode"), "persistence": p.get("persistence")},
            }
        )

    metrics = {
        "active_sessions": dev_sessions,
        "active_subscribers": None,
        "total_translations": dev_trans,
        "port_util_pct": worst_util,
        "exhaustion_events": dev_fail,
        "virtual_server_count": len(virtuals),
    }

    routes: List[Dict[str, Any]] = []
    for r in net_routes:
        net = r.get("network")
        rd = None
        if isinstance(net, str) and "%" in net:
            rd = net.split("%", 1)[1].split("/")[0]
        routes.append(
            {
                "name": _clean(r.get("name")),
                "destination": _clean(net),
                "next_hop": _clean(r.get("gw") or r.get("tmInterface")),
                "distance": None,
                "route_domain": rd,
                "partition": _clean(r.get("partition")),
                "family": "ipv6" if (net and ":" in net) else "ipv4",
                "description": _clean(r.get("description")),
                "attributes": {"tmInterface": r.get("tmInterface"), "partition": r.get("partition")},
            }
        )

    _resolve_route_egress(routes, ifaces, "route_domain")
    return {"facts": facts, "interfaces": ifaces, "pools": pool_rows, "routes": routes, "metrics": metrics, "raw_stats": {}}


# --------------------------------------------------------------------------- shared

def _base_url(device: CgnatDevice) -> str:
    port = device.port or 443
    return f"https://{device.mgmt_ip}" if port == 443 else f"https://{device.mgmt_ip}:{port}"


async def _run_vendor(device: CgnatDevice, password: str) -> Dict[str, Any]:
    vendor = device.vendor if isinstance(device.vendor, CgnatVendor) else CgnatVendor.from_raw(device.vendor)
    async with httpx.AsyncClient(base_url=_base_url(device), verify=bool(device.verify_ssl), timeout=30.0) as client:
        if vendor == CgnatVendor.A10:
            return await _collect_a10(client, device.username, password)
        if vendor == CgnatVendor.F5:
            return await _collect_f5(client, device.username, password)
        raise RuntimeError(f"Unsupported CGNAT vendor: {device.vendor}")


async def _apply(session: AsyncSession, device: CgnatDevice, snap: Dict[str, Any]) -> None:
    facts = snap["facts"]
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
    m = snap["metrics"]
    device.active_sessions = m.get("active_sessions")
    device.active_subscribers = m.get("active_subscribers")
    device.total_translations = m.get("total_translations")
    device.port_util_pct = m.get("port_util_pct")
    device.exhaustion_events = m.get("exhaustion_events")
    device.virtual_server_count = m.get("virtual_server_count")
    device.raw_facts = {"stats": snap.get("raw_stats", {})}

    await session.execute(delete(CgnatInterface).where(CgnatInterface.device_id == device.id))
    for entry in snap["interfaces"]:
        if entry.get("name"):
            session.add(CgnatInterface(device_id=device.id, **entry))

    await session.execute(delete(CgnatNatPool).where(CgnatNatPool.device_id == device.id))
    for entry in snap["pools"]:
        if entry.get("pool_name"):
            session.add(CgnatNatPool(device_id=device.id, **entry))

    await session.execute(delete(CgnatStaticRoute).where(CgnatStaticRoute.device_id == device.id))
    for entry in snap.get("routes", []):
        session.add(CgnatStaticRoute(device_id=device.id, **entry))


async def _enrich_from_nautobot(device: CgnatDevice) -> None:
    settings = get_settings()
    if not settings.nautobot_base_url or not settings.nautobot_token:
        return
    for candidate in dict.fromkeys([n for n in (device.hostname, device.name) if n]):
        try:
            facts = await fetch_nautobot_device_facts_by_name(settings.nautobot_base_url, settings.nautobot_token, candidate)
        except httpx.HTTPError:
            return
        if facts is not None:
            if facts.role:
                device.role = facts.role
            if facts.site:
                device.site_name = facts.site
            if facts.rack:
                device.rack_location = facts.rack
            return


def _password(device: CgnatDevice, override: Optional[str]) -> Optional[str]:
    if override is not None:
        return override
    if device.password_secret is not None:
        return decrypt_secret(device.password_secret)
    return None


async def run_collection_for_device(
    session: AsyncSession,
    device: CgnatDevice,
    password_override: Optional[str] = None,
) -> CgnatCollectionResult:
    ts = datetime.now(timezone.utc)
    password = _password(device, password_override)
    if not device.username or not password:
        device.last_polled_at = ts
        device.status = CgnatDeviceStatus.ERROR
        device.last_error = "Missing username or password for device."
        return CgnatCollectionResult(success=False, timestamp=ts, message=device.last_error)

    try:
        snap = await _run_vendor(device, password)
    except Exception as exc:  # pragma: no cover - network/runtime safety
        logger.warning("CGNAT collection failed for %s: %s", device.mgmt_ip, exc)
        device.last_polled_at = ts
        device.status = CgnatDeviceStatus.ERROR
        device.last_error = str(exc)[:500]
        return CgnatCollectionResult(success=False, timestamp=ts, message=device.last_error)

    await _apply(session, device, snap)
    try:
        await _enrich_from_nautobot(device)
    except Exception:  # pragma: no cover
        logger.debug("Nautobot enrichment error for %s", device.mgmt_ip, exc_info=True)
    device.last_polled_at = ts
    device.status = CgnatDeviceStatus.OK
    device.last_error = None
    return CgnatCollectionResult(
        success=True,
        timestamp=ts,
        snapshot={"interfaces": len(snap["interfaces"]), "pools": len(snap["pools"]), "routes": len(snap.get("routes", []))},
    )


@dataclass
class CgnatConnectivityResult:
    reachable: bool
    checked_at: datetime
    hostname: Optional[str] = None
    message: Optional[str] = None


async def test_connection_for_device(
    device: CgnatDevice, password_override: Optional[str] = None
) -> CgnatConnectivityResult:
    ts = datetime.now(timezone.utc)
    password = _password(device, password_override)
    if not device.username or not password:
        return CgnatConnectivityResult(reachable=False, checked_at=ts, message="Missing username or password.")
    try:
        snap = await _run_vendor(device, password)
        return CgnatConnectivityResult(reachable=True, checked_at=ts, hostname=snap["facts"].get("hostname"))
    except Exception as exc:  # pragma: no cover
        return CgnatConnectivityResult(reachable=False, checked_at=ts, message=str(exc)[:300])
