# SDD: CGNAT Inventory Module (A10 + F5)

- **Status:** Draft / proposed (Phase 0 done; open questions in §11 need answers before build)
- **Owner:** naba
- **Date:** 2026-07-15
- **Module:** NetVerse AI → new "CGNAT Inventory" section (`/cgnat/*`)
- **Type:** New inventory module (multi-vendor, REST-based)

---

## 1. Summary

Add a **CGNAT (Carrier-Grade NAT) inventory** module covering **A10 Thunder (ACOS)** and
**F5 BIG-IP** devices. Unlike the router modules (IP-MPLS/NX-OS, which use SSH + Genie), CGNAT
devices are collected over their **vendor REST APIs** (A10 **aXAPI v3**, F5 **iControl REST**).
It follows the same shape as the other modules: onboard devices, a resilient poller, `/cgnat/*`
API, and dedicated pages — surfacing device facts, interfaces, and the **NAT/LSN pools** plus
aggregate CGNAT stats.

## 2. Motivation

CGNAT gateways translate huge subscriber populations and are operationally critical, but have no
inventory today. Teams need one view of **which CGNAT devices exist, their NAT/LSN pools and
public-IP ranges, port-block settings, and utilization** — across both vendors — without logging
into each ACOS/BIG-IP box.

## 3. Phase 0 findings (confirmed live 2026-07-15)

Probed with `backend/scripts/probe_cgnat_device.py`.

### A10 Thunder / ACOS — aXAPI v3 (device `10.88.19.37`, `A10-VNF-BAN-01`)
- **Auth:** `POST /axapi/v3/auth {credentials:{username,password}}` → `authresponse.signature`;
  send header `Authorization: A10 <signature>`; `POST /axapi/v3/logoff` to end.
- **Device facts:** `GET /axapi/v3/version/oper` → `version.oper.{hw-platform (vThunder),
  sw-version, serial-number, up-time, virtualization-type}`; hostname `GET /axapi/v3/hostname`.
- **Interfaces / VLANs:** `/axapi/v3/interface`, `/axapi/v3/interface/ethernet/oper`,
  `/axapi/v3/network/vlan`.
- **CGNAT (`cgnv6`)**: `GET /axapi/v3/cgnv6/nat/pool` → `pool-list[]` (pool-name, start-address,
  end-address, netmask, shared, port-batch, usable-nat-ports); `GET /axapi/v3/cgnv6/nat/pool-group`
  → `pool-group-list[]` (name + member pools); `GET /axapi/v3/cgnv6/lsn` → LSN global config
  (hairpinning, ip-selection, logging template, port-batching, ALG); `GET
  /axapi/v3/cgnv6/lsn/global/stats` → 121 counters; `GET /axapi/v3/cgnv6/nat64`.
  (Note: `cgnv6/lsn/pool` 404s — this ACOS uses NAT pools + lsn-lid, not an `lsn/pool` object.)

### F5 BIG-IP — iControl REST (device `10.64.41.9`, `app2.lab.jio.com`, v17.5.1.3)
- **Auth:** `POST /mgmt/shared/authn/login {username,password,loginProviderName:"tmos"}` →
  `token.token`; send header `X-F5-Auth-Token`. (Basic auth also works.)
- **Device facts:** `GET /mgmt/tm/cm/device` → item `{name (hostname), version, platform,
  marketingName, chassisId/edition, managementIp, activeModules}`; `GET /mgmt/tm/sys/hardware`,
  `GET /mgmt/tm/sys/version`. **`GET /mgmt/tm/sys/provision`** shows enabled modules
  (**`cgnat` + `ltm` = nominal** on this box).
- **Interfaces / L2-L3:** `/mgmt/tm/net/interface` (42), `/mgmt/tm/net/self` (37),
  `/mgmt/tm/net/vlan` (34), `/mgmt/tm/net/route-domain` (8).
- **CGNAT:** `GET /mgmt/tm/ltm/lsn-pool` → **13 LSN pools**, each with `{name, partition,
  fullPath, mode (napt/deterministic/pba), hairpinMode, inboundConnections, persistence,
  portBlockAllocation{blockSize,blockIdleTimeout,clientBlockLimit}, logProfile, logPublisher,
  members/egress}`; `GET /mgmt/tm/ltm/lsn-pool/stats` → per-pool stats. (Also `/mgmt/tm/ltm/virtual`
  = 68 virtual servers — context, optional.)

**Both devices support HTTPS REST (443) and SSH (22); REST is the collection path.** F5 mgmt is
`10.64.41.9` (the earlier `10.88.19.36` was unreachable).

## 4. Goals / Non-goals

**Goals**
- Multi-vendor CGNAT inventory (A10 + F5) over REST; onboard, poll, view.
- Device facts, interfaces, and a **unified NAT/LSN pool** view (public-IP ranges + port-block
  settings) with vendor-specific detail preserved.
- Aggregate CGNAT **stats/health** per device (utilization, sessions, ports) where available.
- Reuse cross-cutting infra: encrypted creds, resilient poller, Nautobot enrichment, IST display,
  shared UI (StatTile/charts/PageHeader/skeletons/toasts).

**Non-goals**
- No config changes / writes to devices (read-only).
- No per-subscriber / per-session NAT mapping export (too large; aggregate stats only).
- No topology graph (CGNAT gateways aren't a neighbor mesh like routers).

## 5. Design (per `docs/DEVELOPMENT.md` order)

### 5.1 Data model — `app/models/cgnat.py`
- `CgnatVendor(str, Enum)`: `A10`, `F5`, `UNKNOWN` (+ `from_raw()`).
- `CgnatDeviceStatus`: `PENDING`/`OK`/`ERROR`.
- `CgnatDevice` — like the other device models but **REST, not SSH**: name, hostname, mgmt_ip,
  **port (default 443)**, **vendor**, `verify_ssl`, role, model/platform, serial, os_version,
  uptime, encrypted username/password, connection_params, site/rack, poll fields, status,
  last_polled_at/last_error, raw_facts (JSON), timestamps.
- `CgnatInterface` — name, state, ip_address, vlan, mtu, attributes (vendor-neutral subset).
- `CgnatNatPool` — **unified NAT/LSN pool**: pool_name, kind (`nat`|`lsn`), mode (napt/… ),
  partition/route_domain (F5) or shared (A10), start_address, end_address, netmask/prefix,
  port_block_size, port_block_idle_timeout, log_profile, member_of (pool-group), and
  `attributes` (JSON) for the full vendor object. Unique on `(device_id, pool_name)`.
- Aggregate stats: store on the device (`raw_facts`/a `stats` JSON) + a few first-class metrics
  (e.g. total pools, public IPs, sessions, port utilization) surfaced in the summary.

### 5.2 Collector — `app/services/cgnat_collector.py`
- Async HTTPS (httpx) with a **per-vendor client**:
  - **A10**: signature auth → `cgnv6/nat/pool`(+pool-group), `cgnv6/lsn` config, `cgnv6/lsn/global/stats`,
    `version/oper`, `hostname`, `interface`, `network/vlan`; logoff.
  - **F5**: token auth → `cm/device`, `sys/provision`, `net/interface|self|vlan|route-domain`,
    `ltm/lsn-pool`(+`/stats`).
- Normalize both into the common `CgnatDevice` + `CgnatInterface` + `CgnatNatPool` shapes; keep the
  raw vendor object in `attributes`. Per-call fault isolation; bounded concurrency + retry (reuse
  the pattern from [[aci-large-fabric-concurrency]] if a device is slow). Nautobot enrichment.
- **Connectivity test** endpoint (auth only), like NX-OS/IP-MPLS `test`.

### 5.3 Poller — `app/services/cgnat_poller.py`
Mirror the resilient poller; `cgnat_poller_enabled` in `app/core/config.py`; wired into `main.py`.

### 5.4 Schemas + Router — `app/routers/cgnat.py` (`/cgnat/*`)
- Devices: list (paginated + search incl. vendor), CRUD, `POST /{id}/sync`, `POST /{id}/test`.
- Children: `GET /{id}/interfaces`, `GET /{id}/pools`.
- `GET /cgnat/summary` — totals + by_vendor / by_role / by_location / by_status, pool counts,
  public-IP counts, error/stale devices.

### 5.5 Frontend
- Nav group **"CGNAT Inventory"**: Summary, Devices, Device detail (tabs: Overview / Interfaces /
  **NAT Pools** / Stats), Admin (register/sync/test/edit/delete). No topology page.
- Reuse shared components; vendor badge (A10/F5).

### 5.6 Onboarding
- If A10/F5 are in Nautobot: `scripts/import_cgnat_devices.py` by role (mirror the others), mapping
  Nautobot platform → vendor. Else manual via Admin. **Depends on §11 answer.**

## 6. Acceptance criteria
1. Onboard A10 and F5 CGNAT devices (by role or manually); both collect over REST and show `ok`.
2. Device detail shows facts (hostname/model/serial/version/uptime), interfaces, and the unified
   **NAT/LSN pools** with public-IP ranges + port-block settings; vendor badge correct.
3. Summary shows fleet totals + breakdowns (vendor/role/location/status) and pool/public-IP counts,
   with error/stale signals.
4. All data via authenticated `/api/v1/cgnat/*` JSON (OpenAPI/MCP-ready). Read-only.

## 7. Test plan
- **Unit:** feed captured A10 (`cgnv6/nat/pool`, `lsn`) and F5 (`ltm/lsn-pool`, `cm/device`) JSON to
  the normalizers; assert the unified pool/device shapes.
- **Integration (live):** run collector against A10 `10.88.19.37` and F5 `10.64.41.9`; verify pools,
  interfaces, and facts populate; verify the connectivity test.
- **API + Frontend:** exercise `/cgnat/*`; `tsc` + build; visually confirm pages.

## 8. Phase 0 — done
See §3 (both vendors probed live; auth, device, interface, and CGNAT-pool object models confirmed).

## 9. Edge cases
- F5 device where `cgnat` module isn't provisioned → `ltm/lsn-pool` empty; still inventory the box.
- A10 `cgnv6/lsn/pool` absent (uses NAT pools) → drive off `cgnv6/nat/pool` (+ lsn global config/stats).
- REST disabled / unreachable (like F5 `10.88.19.36`) → device flagged error with a clear message.
- Self-signed TLS → `verify_ssl=false` per device (both test boxes need it).
- Multi-partition (F5) / partitions (A10) → capture partition/route-domain on pools.

## 10. Rollout
Additive module; follows model→migration→collector→poller→schema→router→frontend→verify order,
committing per step and verifying against the two live devices.

## 11. Open questions (need answers before build)
1. **Onboarding source:** Are A10/F5 in **Nautobot**? If yes, what **role**(s) and **platform**
   names map to A10 vs F5 (so the importer can seed by role like the other modules)? If not,
   onboarding is manual-only via Admin.
2. **Stats scope:** which CGNAT metrics matter most for the Summary/health — e.g. **port/pool
   utilization %, active sessions/subscribers, translation counts, pool exhaustion**? (Drives which
   of A10's 121 LSN stats and F5's lsn-pool stats we surface as first-class vs raw JSON.)
3. **F5 virtual servers:** include them (context) or keep the module strictly CGNAT (lsn-pool)?
   Proposed: CGNAT-focused; virtual-server count only.
4. **Credentials:** shared service account per vendor, or per-device (as onboarded)? Proposed:
   per-device (encrypted), same as IP-MPLS/NX-OS.
