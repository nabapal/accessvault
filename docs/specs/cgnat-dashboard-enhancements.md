# CGNAT Dashboard Enhancements

- **Feature:** Nine CGNAT dashboard/device-detail enhancements across F5 BIG-IP and A10 Thunder.
- **Status:** Approved for Phase 1 — Phase 0 validated live; decisions §10 (D1/D2 resolved, D3/D4 pending user verification, both in later phases)
- **Module:** CGNAT Inventory
- **Date:** 2026-07-17
- **Probed live:** F5 `10.64.41.9` (BIG-IP 17.5.1), A10 `10.88.19.37` (vThunder 6.0.4)

## 1. Summary
Enhance the CGNAT device-detail and dashboard views with license info, IPv6 +
NAT-role + VLAN interface details, colour-coded admin status, sortable static
routes with next-hop-derived VLAN/interface, and full route-domain/partition
coverage with a selector. Delivered in phases.

## 2. Phase 0 — live validation (what each vendor's REST API actually exposes)
Probes: `backend/scripts/probe_cgnat_device.py` + deep field probes (read-only).

### Feasibility matrix
| # | Requirement | F5 BIG-IP | A10 Thunder | Notes |
|---|---|---|---|---|
| 1 | License info | ✅ full — `/mgmt/tm/sys/license`: registrationKey, licensedOnDate, serviceCheckDate, licensedVersion, platformId, appliance/chassis serial, active-modules | ⚠️ partial — `/axapi/v3/glm`: token, enterprise host, uuid, allocate-bandwidth; `/version/oper`: serial, platform, sw-version. **No expiry/feature-entitlement object via aXAPI on vThunder** | Asymmetric — model a flexible license blob + normalized fields where present |
| 2 | Translations & Exhaustion — needed? | ✅ meaningful — `lsn-pool/stats`: activeTranslations, translationRequests, pba.portBlockAllocationFailures, pba.percentFreePortBlocks, clientsReachedLimit | ✅ meaningful — `cgnv6/lsn/global/stats`: total_tcp/udp/icmp_allocated, data_session_created, nat_port_unavailable_*, *_user_quota_exceeded, nat_pool_unusable | **Core CGNAT health signal — recommend KEEP + sharpen definitions (§10-D2)** |
| 3 | IPv6 interface addresses | ✅ self-IPs already return IPv6 (`2405:…%rd/prefix`) | ✅ `interface/ve` has separate `ipv6.address-list[]` alongside `ip.address-list[]` | Model currently stores a single `ip_address`; must hold v4 + v6 |
| 4a | Per-interface NAT inside/outside | ✅ derivable — **inside** = VLAN in a virtual-server's `vlans` list; **outside** = VLAN in an LSN pool's `egressInterfaces` list (verified live: `lsnpool_ibr_pub.egressInterfaces = [vl_ibr40g_cross_out, vl_ibr40g_out]`); else mgmt/logging | ✅ native — `ve.ip.inside/outside` and `ve.ipv6.inside/outside` (0/1) | §10-D3 resolved |
| 4b | Per-interface VLAN | ✅ self-IP already carries `vlan` | ✅ derive via `network/vlan.ve == interface ifnum` (VLAN endpoint currently fetched but unused) | |
| 5 | Enable/Disable + colour | ✅ interface `enabled/disabled` | ✅ `action: enable/disable` | Mostly frontend; collector must set a real admin_state (F5 self-IP currently mis-maps `floating`) |
| 6 | Sortable static-route columns | ✅ frontend-only | ✅ frontend-only | No device/backend dependency |
| 7 | VLAN + interface per route (by next-hop) | ✅ derive — match `gw` against self-IP subnets → self-IP.vlan | ✅ derive — match `ip-next-hop` against `ve` subnets → ve → vlan | Longest-prefix match at collect time; store resolved egress iface+vlan |
| 8 | All route-domains / partitions | Tenancy = **route-domain** (8 present: 0/861/301/302/250/101/201/1). Routes/self-IPs already carry `%rd`; also iterate partitions if >1 (device has 1 = Common) | Tenancy = **partition** (L3V). Confirmed on `10.60.139.94`: `partition-all/oper` lists CGNv6 L3V partitions IPDR-FTTX-WL(4,Active), IPDR-5G-AF(5,Active), IPDR-FTTX-UBR(6,Not-Active), `active-partition-count:2`. Iterate via `POST /axapi/v3/active-partition/{name}` then query cgnv6/interfaces/routes per partition | Tag every interface/pool/route with partition + route_domain |
| 9 | Route-domain/partition dropdown | ✅ frontend selector filtering by §8 data | ✅ same | Depends on §8 |

### Key raw evidence
- F5 self-IP: `{name: self_a10_302_IN_v6, address: 2405:200:1410:2da::273%302/125, vlan: /Common/vl_A10_IN_XLAT_302, partition: Common}` — IPv6 + RD(302) + vlan all present.
- F5 route: `{name: A10_UE_Pool_FTTX, network: 10.64.8.32%302/27, gw: 10.64.190.249%302, partition: Common}` — next-hop `gw` + RD.
- F5 route-domains: 8, each with a `vlans[]` list → RD↔VLAN map.
- F5 NAT role: VS `vs_cgnat_rd_ibr_tcp.vlans=[vl_ibr40g_cross_in, vl_ibr40g_in]`
  (inside) + `lsnpool_ibr_pub.egressInterfaces=[vl_ibr40g_cross_out,
  vl_ibr40g_out]` (outside) — both fields present in `ltm/virtual` + `ltm/lsn-pool`.
- A10 ve: `{ifnum: 650, name: A10_1_ACI_5G_DPI_IPV4_IN, action: enable, ip:{address-list:[{ipv4-address:10.60.146.210, ipv4-netmask:255.255.255.248}], inside:1, outside:0}}` — inside/outside native.
- A10 ve651: `ipv6.address-list:[{ipv6-addr: 2405:200:1410:2d0::3ca/125}], inside:1`.
- A10 vlan: `{vlan-num:650, ve:650, name:…, tagged-trunk-list:[…]}` → VLAN↔ve join.
- A10 route: `{ip-dest-addr:10.0.0.0, ip-mask:/8, ip-nexthop-ipv4:[{ip-next-hop:10.60.151.177, distance-nexthop-ip:1, description-nexthop-ip:Default_IPv4_IN2}]}`.
- A10 exhaustion: `nat_port_unavailable_tcp:2963, nat_port_unavailable_udp:1318, user_quota_failure:0`.

## 3. Current-state gaps (from code map)
- No license fields anywhere (model/schema/collector/UI).
- `CgnatInterface.ip_address` is a single string — no v4/v6 split; no `nat_role`; A10 VLAN endpoint fetched but never joined to interfaces.
- `admin_state`: A10 ve→`action` (ok); F5 self-IP→`floating` (wrong — not an admin state).
- Static routes: no resolved egress interface/vlan; `partition` only on pools; RD only string-parsed from `%rd`.
- Collector never enumerates partitions/route-domains — implicit default context only.
- Frontend: no table sorting; no RD/partition selector; Translations/Exhaustion shown in KPI row + per-pool.

## 4. Design (per requirement)
### R1 License
- Collect:
  - F5 — REST `/mgmt/tm/sys/license` (registrationKey, licensedOnDate,
    serviceCheckDate, licensedVersion, platformId, serials, active-modules).
  - A10 — **aXAPI CLI-passthrough** (D4): `POST /axapi/v3/clideploy` with body
    `{"commandlist": ["show license-info"]}` returns the full `show license-info`
    **text over REST** (validated live on `10.60.139.94`, HTTP 200). No SSH
    needed — CGNAT stays REST-only, same auth session. Output = a header block
    (Host ID, Billing Serials, Product, Platform, Burst, Product-description=
    notes, GLM Ping Interval) + an "Enabled Licenses" table with columns
    `Name | Expiry Date (UTC) | Notes`. The **bandwidth allocation row** is
    exactly what R1 wants, e.g.:
    `1000 Mbps Bandwidth   01-July-2026   Bandwidth license - Grace period days remaining 10.`
    Parse: bandwidth (Mbps), expiry date, notes; plus per-feature rows
    (SLB/CGN/…) with their expiry/notes; header key-values.
- Model: add `CgnatDevice.license` JSON (raw per-vendor parse) + normalized
  columns `license_product`, `license_expiry` (nullable date),
  `license_bandwidth_mbps` (nullable int), `license_notes`, `license_modules`
  JSON. Populate what each vendor exposes; leave rest null.
- Collector: A10 license uses the aXAPI CLI-passthrough (`/axapi/v3/clideploy`)
  within the existing signed REST session — no SSH, no Netmiko. Best-effort: if
  the call fails/parse misses, license fields stay null and the sync still
  succeeds.
- UI: License card on Overview tab showing product, bandwidth + expiry (amber
  when near/!expiry), notes, and the per-feature module table.

### R2 Translations & Exhaustion — **keep + sharpen** (pending §10-D2)
- Define **Translations** = active translations (gauge) + total allocated (counter).
- Define **Exhaustion** = port-unavailable + quota-exceeded events (+ % free port
  blocks / clients-reached-limit on F5). Relabel tiles for clarity; keep on
  dashboard + device KPI row. No data removal.

### R3 IPv6 interface addresses
- Model: replace single `ip_address` usage with `addresses` JSON (list of
  `{family, address, prefix}`) OR add `ipv4_addresses`/`ipv6_addresses`. Keep
  `ip_address` as primary-v4 for back-compat.
- Collector: F5 self-IP (detect `:` → v6); A10 ve `ip.address-list` +
  `ipv6.address-list`.
- UI: interface table shows all addresses (v4 + v6).

### R4 NAT inside/outside + VLAN per interface
- `nat_role`:
  - A10 — from `ve.ip.inside/outside` (and `ipv6.inside/outside`) → "inside"/
    "outside"/null.
  - F5 — derive per interface's VLAN (verified §10-D3):
    - **outside** if the VLAN is in any LSN pool's `egressInterfaces`;
    - else **inside** if the VLAN is in any virtual-server's `vlans` list;
    - else **mgmt/logging**.
    Precedence = outside > inside (a VLAN in both an `egressInterfaces` list and
    a VS `vlans` list is treated as outside; observed for `vl_ibr40g_cross_out`).
    Collector must fetch `ltm/virtual` (name, vlans) + `ltm/lsn-pool`
    (egressInterfaces) and build VLAN→role maps.
- `vlan`: A10 join `network/vlan.ve == ifnum`; F5 already from self-IP.
- UI: two columns (NAT role, VLAN); NAT role badge.

### R5 Enable/Disable colour coding
- Collector: set `admin_state` to a real enabled/disabled on both (fix F5).
- UI: green badge = enabled/up, red = disabled/down, amber = admin-up/oper-down.

### R6 Sortable static-route columns (frontend-only)
- Client-side sort on every column header (toggle asc/desc), like a reusable
  sortable-table helper; default by destination.

### R7 Route VLAN + interface via next-hop
- At collect time, longest-prefix-match `next_hop` against collected interface
  subnets; store `egress_interface` + `egress_vlan` on `CgnatStaticRoute`.
- UI: two columns on the routes table.

### R8 All route-domains / partitions
- Collector enumerates tenancy scopes and tags every interface/pool/route with
  `partition` + `route_domain`:
  - F5: list `/mgmt/tm/auth/partition`; for each, query in partition context;
    map RD via `/net/route-domain` (id ↔ name ↔ vlans). Continue parsing `%rd`.
  - A10: read `partition-all/oper`; if `active-partition-count > 0`, iterate
    partitions via `curr_part_name` header; else single "shared" scope.
- Model: add `partition` + `route_domain` to `CgnatInterface`; ensure both on
  pools + routes.

### R9 Route-domain/partition dropdown (frontend)
- Device Details gains a selector listing the device's partitions/route-domains
  (from collected data). Selecting one filters interfaces/pools/routes tabs.
  Default "All".

## 5. Acceptance criteria
- Per requirement, the field/behaviour appears for both vendors (or is clearly
  marked N/A where the vendor cannot supply it — e.g. F5 NAT role per §10-D3).
- Interface table shows v4 + v6, NAT role, VLAN, colour-coded status.
- Static-route table sorts on all columns and shows egress VLAN + interface.
- RD/partition selector filters the three tabs; "All" shows everything.
- License card renders available fields per vendor.
- Verified against the two probed devices' real data.

## 6. Test / verification
- Re-onboard both probed devices; sync; verify collected fields match probe.
- `npx tsc --noEmit` + `npm run build`; backend migration applies at head.
- Spot-check: F5 RD 302 self-IP shows IPv6; A10 ve650 shows inside + vlan 650;
  A10 route 10.0.0.0/8 resolves egress via 10.60.151.177 next-hop.

## 7. Proposed phases
- **Phase 1 (frontend-only, ship first):** R6 sortable routes, R5 colour-coded
  status. No schema/device change. — ✅ IMPLEMENTED (tsc+build clean).
- **Phase 2 (interfaces):** R3 IPv6, R4 NAT role + VLAN. Model+collector+UI.
  — ✅ IMPLEMENTED. `cgnat_interfaces` gains `addresses` (JSON, v4+v6 CIDRs) +
  `nat_role`; A10 ve collects v4+v6 address-lists, native inside/outside, and
  `vlan.ve` join; F5 self-IPs get NAT role via VS `vlans` (inside) / LSN
  `egressInterfaces` (outside), else mgmt/logging. UI: interface table shows all
  addresses (IPv6 highlighted) + NAT-role badge. Verified live on F5 + 2× A10
  (incl. dual-stack ve686/ve2421, inside ve650, outside ve2422). tsc+build clean.
- **Phase 3 (tenancy):** R8 all partitions/RDs, R9 selector.
- **Phase 4 (routes):** R7 next-hop → egress VLAN/interface.
- **Phase 5 (license):** R1 license model + collect + UI.
- **R2** resolved as a decision (§10-D2); no dedicated code phase beyond relabel.

## 8. Rollout
- Phases 2–5 add nullable columns + a migration (additive, non-destructive).
- Each phase: own commit(s), tsc+build, live re-verify, deploy with the batch.

## 9. Edge cases
- vThunder with no partitions → single "shared" scope (don't fabricate).
- Next-hop with no matching interface subnet → egress iface/vlan null (show —).
- Dual-stack interfaces → multiple address rows.
- F5 multi-partition devices (not in lab) → partition iteration must be safe if
  only Common exists.
- License fields absent (A10 expiry/modules) → render "—", never error.

## 10. Decisions
- **D1 — Phasing order:** ✅ RESOLVED — frontend quick-wins first
  (Phase 1 = R6 + R5), then Phase 2→5 as in §7.
- **D2 — R2 Translations/Exhaustion:** ✅ RESOLVED — **keep + sharpen labels**
  (Translations = active + total allocated; Exhaustion = port-unavailable +
  quota-exceeded). No data removal.
- **D3 — F5 NAT inside/outside:** ✅ RESOLVED — F5 role IS API-derivable
  (verified live on `10.64.41.9`): **outside** = VLAN in an LSN pool's
  `egressInterfaces` (e.g. `lsnpool_ibr_pub → [vl_ibr40g_cross_out,
  vl_ibr40g_out]`); **inside** = VLAN in a virtual-server's `vlans` list (e.g.
  `vs_cgnat_rd_ibr_* → [vl_ibr40g_in, vl_ibr40g_cross_in]`); else mgmt/logging.
  Precedence outside > inside on the rare overlap. No naming heuristic needed.
  Matches the user-supplied rule exactly (initial miss: first probe didn't read
  the `egressInterfaces` field).
- **D4 — R1 A10 license fidelity:** ✅ RESOLVED — **A10 aXAPI CLI-passthrough
  `POST /axapi/v3/clideploy {"commandlist":["show license-info"]}`** returns the
  license text over REST (validated live, HTTP 200). No SSH — CGNAT stays
  REST-only. (Supersedes the earlier SSH plan.) F5 stays REST. **Phase-0 finding
  (probed `10.60.139.94`, vThunder 6.0.4 GLM VNF):** license notes + bandwidth
  allocation expiry are **NOT exposed via aXAPI**. `/glm`, `/glm/oper`,
  `/license-manager`, `/license-manager/oper` all return **204 (empty)**;
  entitlement/flexpool/instance oper endpoints 404; `/system/bandwidth` gives
  only warning/critical thresholds (75/95), not allocated bandwidth or expiry.
  (Earlier device `10.88.19.37` did return `/glm` config: token/enterprise/
  allocate-bandwidth=1000 — but still no expiry/notes.) **SSH validated:**
  `show license-info` on `10.60.139.94` returns the bandwidth allocation with
  expiry + notes (`1000 Mbps Bandwidth | 01-July-2026 | Bandwidth license -
  Grace period days remaining 10`) plus product-description and per-feature
  license rows. `show license` alone only prints Host ID; `show glm` is not a
  valid command. **Better: the same output is reachable over REST** via
  `POST /axapi/v3/clideploy {"commandlist":["show license-info"]}` (HTTP 200,
  full text) — so no SSH is required. → **Decision: aXAPI clideploy passthrough
  for A10 license (Phase 5).**
