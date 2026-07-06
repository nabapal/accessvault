# SDD: Cisco NX-OS (Nexus) Device Inventory Module

- **Status:** Approved — decisions resolved (§11); ready for Phase 0 + implementation
- **Owner:** naba
- **Date:** 2026-07-06
- **Module:** NetVerse AI → new "NX-OS Inventory" section (`/nxos/...`)
- **Type:** New inventory module (mirrors the IP-MPLS module)

---

## 1. Summary

Add a Cisco **NX-OS (Nexus)** device-inventory module built the same way as the existing
**IP-MPLS** module: per-device onboarding (by Nautobot role) with SSH + pyATS/Genie
collection, dedicated pages (Devices / Device detail / Topology / Summary / Admin), and a
resilient background poller. Differences from IP-MPLS:
- **Topology** is built from **CDP + LLDP** neighbor discovery (not ISIS).
- **BGP details** (neighbors, ASN, state, prefixes) are collected and shown.

## 2. Motivation

NX-OS switches are a large part of the estate but have no dedicated inventory today (only
a minimal NX-API "inventory modules" pull inside the telco fabric-onboarding path — see
§3). Operators need the same depth for NX-OS that IP-MPLS has: interfaces, VRFs, hardware,
neighbor topology, and BGP — onboarded by role from Nautobot and refreshed by a poller.

## 3. Current state

- **IP-MPLS module (the template to mirror):**
  - Models `IpMplsDevice/Interface/Module/Vrf/Neighbor` (`app/models/ipmpls.py`).
  - Collector (`app/services/ipmpls_collector.py`): Netmiko transport + **Genie offline
    parse** (`GenieDevice(os=...).parse(cmd, output=raw)`); commands include show
    version/inventory/interfaces brief/vrf/isis/ldp/bgp/mpls interfaces.
  - Poller `IpMplsPoller`, gated by `ipmpls_poller_enabled` in `app/core/config.py`.
  - Router `/ipmpls/*` (devices CRUD + `/interfaces|modules|vrfs|neighbors`, `/topology`,
    `/summary`, `/devices/{id}/sync`).
  - Onboarding script `backend/scripts/import_ipmpls_devices.py` (by Nautobot role,
    `--status active` default, upsert by mgmt IP, Nautobot role/site/rack enrichment).
  - Frontend pages `IpMpls{Devices,DeviceDetail,Admin,Topology,Summary}Page.tsx`;
    topology uses Cytoscape.
- **Existing NX-OS bits (do not conflate):** `telco_collector._collect_nxos_fabric` uses
  **NX-API JSON-RPC** under the telco fabric-onboarding job and only parses `show
  inventory`. This module is **separate** — per-device SSH/Genie, its own tables and
  pages. (Future cleanup could migrate the telco NX-OS path onto this module; out of scope.)

## 4. Goals / Non-goals

**Goals**
- Dedicated NX-OS module mirroring IP-MPLS: onboarding-by-role, SSH+Genie collection,
  poller, `/nxos/*` API, and pages.
- **CDP + LLDP** driven topology (merged, de-duplicated).
- **BGP** neighbor detail (per VRF / address-family).
- Reuse cross-cutting infra: crypto, Nautobot enrichment, resilient poller, IST display,
  UTC storage, the shared UI components (StatTile, charts, PageHeader, skeletons, toasts).

**Non-goals**
- No config changes / writes to devices (read-only collection).
- Not replacing the telco NX-API path in this change.
- No routing-table/MAC-table/flow collection (future).

## 5. Design (per `docs/DEVELOPMENT.md` order)

### 5.1 Data model — `app/models/nxos.py`
- `NxosPlatform(str, Enum)`: `NXOS`, `UNKNOWN` (+ `from_raw()` + `netmiko_device_type` =
  `cisco_nxos`). (Kept as an enum for parity/future variants.)
- `NxosDeviceStatus(str, Enum)`: `PENDING`/`OK`/`ERROR`.
- `NxosDevice` — mirror `IpMplsDevice`: name, hostname, mgmt_ip (unique), port, platform,
  role, model, serial, os_version, uptime, credentials (encrypted), connection_params,
  site_name, rack_location, poll_interval_seconds, status, last_polled_at, last_error,
  raw_facts, timestamps.
- `NxosInterface` — name, description, admin/oper state, ip, speed, mtu, mode
  (access/trunk), vlan(s), duplex, mac, port_channel, counters (JSON) — the NX-OS-relevant
  subset of the IP-MPLS interface shape.
- `NxosModule` — name/description/serial/pid/slot (from show inventory/module).
- `NxosVrf` — name, route-distinguisher, protocols/attributes.
- `NxosNeighbor` — **discovery** adjacency for topology. Fields: `protocol` (`cdp`|`lldp`),
  `local_interface`, `remote_device`, `remote_interface`, `remote_platform`,
  `remote_mgmt_ip`, `attributes` (JSON). Unique on
  `(device_id, protocol, local_interface, remote_device, remote_interface)`.
- `NxosBgpNeighbor` — **BGP** detail. Fields: `neighbor_ip`, `remote_as`, `local_as`,
  `vrf`, `address_family`, `state`, `prefixes_received`, `prefixes_sent`, `uptime`,
  `description`, `attributes` (JSON).

> **Alternative considered:** a single neighbor table with `protocol` in
> `cdp|lldp|bgp` (as IP-MPLS does for isis/ldp/bgp). Rejected: BGP has enough
> first-class fields (ASN, AFI/SAFI, prefix counts) that a dedicated table is cleaner and
> the topology query stays simple (`protocol in (cdp,lldp)`).

### 5.2 Migration
`backend/migrations/versions/<date>_add_nxos_inventory.py`, `down_revision` = current head;
creates all NX-OS tables. Auto-applies at startup.

### 5.3 Collector — `app/services/nxos_collector.py`
Netmiko (`cisco_nxos`) in a worker thread + Genie `os="nxos"` offline parse, mirroring
`ipmpls_collector`. Per-command fault isolation (one parse failure never aborts the device).
Planned commands (confirm parsers in Phase 0):
- `show version`, `show inventory` (or `show module`) → device facts + modules
- `show interface` (+ `show interface status`) → interfaces
- `show vrf` (+ `show vrf detail`) → VRFs
- `show cdp neighbors detail` → CDP adjacencies
- `show lldp neighbors detail` → LLDP adjacencies
- `show ip bgp summary` / `show bgp all summary` / `show bgp sessions vrf all` → BGP
  neighbors (per VRF / AF)
Upsert with delete-not-seen / replace-per-item, as IP-MPLS does. Enrich role/site/rack
from Nautobot (`app/services/nautobot.py`).

### 5.4 Topology (CDP + LLDP)
- Nodes = onboarded NX-OS devices; a neighbor not in inventory becomes an **external**
  node (as IP-MPLS does for non-onboarded ISIS neighbors).
- Links = union of CDP and LLDP adjacencies, **de-duplicated** by the unordered pair
  `(local_device+local_intf, remote_device+remote_intf)`; record which protocol(s)
  discovered each link. Match neighbors to devices by remote_device (hostname/sysname) and
  remote_mgmt_ip.
- `GET /nxos/topology` returns `{ nodes[], links[] }`; each link carries
  `endpoint_interfaces` (local interfaces per node) and `discovered_by` (`["cdp","lldp"]`).

### 5.5 Poller
`NxosPoller` mirroring `IpMplsPoller` (tick-guarded, per-device isolation); wire into
`app/main.py` lifespan behind `nxos_poller_enabled` in `app/core/config.py`.

### 5.6 Schemas + Router
- Schemas `app/schemas/nxos.py` (`Config.from_attributes=True`).
- Router `app/routers/nxos.py` (`get_current_user` reads / `require_admin` writes),
  registered in `app/routers/__init__.py` + `app/api/api_v1.py`:
  - `GET /nxos/devices` (paginated + search across name/host/ip/model/serial/role/site/rack/
    platform/status/OS), `POST /nxos/devices`, `GET/PATCH/DELETE /nxos/devices/{id}`,
    `POST /nxos/devices/{id}/sync`
  - `GET /nxos/devices/{id}/interfaces|modules|vrfs|neighbors|bgp`
  - `GET /nxos/topology`, `GET /nxos/summary`

### 5.7 Onboarding script
`backend/scripts/import_nxos_devices.py` — clone of the IP-MPLS importer: `--role`
(repeatable, **default `Nexus`**), `--status active` default, `--collect`, `--dry-run`,
credential/Nautobot flags; upsert by mgmt IP; skip devices with no primary IP. Nautobot
platform `cisco_NXOS` → `NxosPlatform.NXOS`.

### 5.8 Frontend
- Types in `frontend/src/types/index.ts`; service `frontend/src/services/nxos.ts`.
- Pages under `frontend/src/pages/`: `NxosDevicesPage`, `NxosDeviceDetailPage`
  (compact KPI header + tabs: Overview / Interfaces / VRFs / Neighbors (CDP+LLDP) / BGP /
  Hardware), `NxosDevicesAdminPage`, `NxosTopologyPage` (Cytoscape, CDP/LLDP links, role +
  location filters, fullscreen, link detail), `NxosSummaryPage` (StatTile KPIs + donut/gauge
  charts + breakdowns). Routes in `App.tsx`; nav group **"NX-OS Inventory"** (Summary /
  Devices / Topology) + Admin entry, using the shared UI components.

### 5.9 MCP
Read endpoints auto-appear in `/openapi.json`; add the `/nxos/*` list/detail/summary/
topology tools to the NetVerse AI MCP spec once shipped.

## 6. Acceptance criteria

1. Onboard NX-OS devices by Nautobot role (Active only by default); they appear at
   `/nxos/devices` with role/site/rack from Nautobot.
2. After a poll, each device shows interfaces, VRFs, modules, CDP+LLDP neighbors, and BGP
   neighbors; model/serial/OS populate from the device.
3. `/nxos/topology` renders nodes + links from CDP/LLDP (merged/de-duplicated), with
   external nodes for non-onboarded neighbors and per-link discovered-by protocol(s).
4. BGP tab lists neighbors with remote/local AS, VRF, AF, state, and prefix counts.
5. Summary page shows fleet KPIs + breakdowns (by role/location/platform/model/OS/status),
   with error/stale device signals (poller health).
6. Search covers all device columns; list is paginated.
7. All data reachable via authenticated `/api/v1/nxos/*` JSON (OpenAPI/MCP-ready).

## 7. Test plan

- **Unit:** feed captured Genie JSON (show cdp/lldp neighbors detail, show ip bgp summary,
  show interface, show vrf) to the parse/normalize helpers; assert neighbor/BGP/interface
  shapes and topology de-duplication (a link seen by both CDP and LLDP collapses to one
  with `discovered_by=["cdp","lldp"]`).
- **Integration (live NX-OS device):** run the collector against a real Nexus; verify
  interfaces/VRFs/neighbors/BGP populate and topology links resolve to onboarded peers.
- **API:** exercise `/nxos/*` endpoints + search/pagination.
- **Frontend:** `npx tsc --noEmit` + `npm run build`; verify pages, tabs, topology, charts.

## 8. Phase 0 — discovery (do first)

1. Pick a reachable NX-OS device (via Nautobot role) and confirm **Netmiko `cisco_nxos`**
   connectivity + `enable`/no-enable behavior.
2. Confirm **Genie `nxos` parsers** exist and match for: `show version`, `show inventory`/
   `show module`, `show interface`, `show vrf`, `show cdp neighbors detail`, `show lldp
   neighbors detail`, `show ip bgp summary`/`show bgp all summary`. Capture sample parsed
   JSON to `data/samples/nxos/` (git-ignored). Record exact commands chosen here.
3. Decide BGP command(s) to cover **all VRFs + IPv4/IPv6 unicast** (e.g.
   `show bgp all summary` / `show bgp vrf all all summary`, or per-VRF/AF as the parser
   requires).
4. Nautobot: role **`Nexus`**, platform **`cisco_NXOS`** (confirmed). Verify a device with
   this role has a primary IP and is reachable over SSH (`cisco_nxos`).

### 8.5 Phase 0 findings (confirmed 2026-07-06, device BGLRRLABCAS001 / 10.64.97.40)

Netmiko `cisco_nxos` connects; Genie `os="nxos"` parses these commands (chosen set):
| Purpose | Command | Genie result (top-level) |
|---|---|---|
| Device facts | `show version` | `platform` |
| Chassis/serial | `show inventory` | `name` (per component) |
| Modules | `show module` | `slot`, `xbar` |
| Interfaces | `show interface` | per-interface dict (rich: state/ip/speed/mtu/mac/counters) |
| Interface mode/vlan | `show interface status` | `interfaces` (optional supplement) |
| VRFs | `show vrf` | `vrfs` |
| CDP | `show cdp neighbors detail` | `index.<n>` (device_id, local_interface, port_id, platform, mgmt addr) |
| LLDP | `show lldp neighbors detail` | `interfaces.<localIf>.port_id.<pid>...` |
| **BGP** | **`show bgp vrf all all summary`** | `vrf.<vrf>.neighbor.<ip>.address_family.<af>` |

**Important:** the generic `show ip bgp summary` and `show bgp all summary` have **no Genie
nxos parser** (`ParserNotFound`). Use **`show bgp vrf all all summary`** — it parses and
already covers **all VRFs and all address families** (matches the §11 BGP scope).
`show interface` output is large (~1 MB on this device) but parses; acceptable since the
poller processes one device at a time. Parse each command fault-isolated (per IP-MPLS).

## 9. Edge cases

- Neighbor devices not onboarded → external topology nodes (no detail link).
- CDP vs LLDP naming differences (sysname vs device-id, short vs FQDN) → normalize before
  matching to onboarded devices.
- vPC/port-channel members → represent member links; avoid double-counting the logical PC.
- Genie parser missing/among-versions → fault-isolate per command; leave field null.
- Platform `unknown` (bad/missing Nautobot platform) → Netmiko can't pick a driver →
  collection error surfaced (as IP-MPLS).
- BGP with many neighbors / large tables → paginate device-detail BGP if needed.

## 10. Rollout

- Additive: new tables/endpoints/pages; no change to IP-MPLS/ACI/VMware.
- Follows the playbook order: model → migration → collector → poller → schema → router →
  frontend → verify (live) → commit per step.
- Poller enabled by default via `nxos_poller_enabled`; onboard by role, then the poller
  collects (or `--collect` for immediate).

## 11. Resolved decisions

- **Neighbor table shape:** **two tables** — `NxosNeighbor` (`protocol` in `cdp|lldp`, for
  topology) + dedicated `NxosBgpNeighbor` (BGP detail). Confirmed.
- **Topology dedup preference:** when CDP and LLDP disagree on remote-interface naming,
  **prefer LLDP** for display; list both protocols under `discovered_by`. Confirmed.
- **BGP scope:** collect **all VRFs, IPv4 + IPv6 unicast** address families. Confirmed.
- **Nautobot mapping:** NX-OS devices carry Nautobot **role = `Nexus`** and **platform =
  `cisco_NXOS`**. The importer seeds `--role Nexus` by default; `NxosPlatform.from_raw`
  maps `cisco_nxos` / `cisco_NXOS` / `nxos` → `NXOS` (Netmiko `cisco_nxos`). Confirmed.
