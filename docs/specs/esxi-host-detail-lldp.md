# SDD: ESXi Host Detail + LLDP/CDP uplink neighbors

- **Status:** Implemented — verified live on ESXi 10.64.46.21 (host facts + CDP neighbors, clickable detail)
- **Owner:** naba
- **Date:** 2026-07-15
- **Module:** NetVerse AI → VM Inventory (Host Utilization → Host detail)
- **Type:** Feature — clickable host + per-host uplink neighbor (LLDP/CDP) discovery

---

## 1. Summary

Make each host in **VM Inventory → Host Utilization** clickable (the IP/name → a **Host detail
page**), and on that page show full host details plus, for every physical uplink, the
**connected switch** discovered via **LLDP/CDP** (remote switch name, port, platform, mgmt
address). This tells operators exactly which leaf/switch port each ESXi uplink lands on.

## 2. Motivation

Today Host Utilization is a flat table with no drill‑in, and there is no record of how each
ESXi host is cabled to the fabric. Uplink→switch/port mapping is needed for troubleshooting,
audits, and correlating ESXi hosts with the ACI/NX‑OS switch inventory we already have.

## 3. Phase 0 findings (confirmed live 2026-07-15)

Probed with `backend/scripts/probe_esxi_lldp.py --endpoint 10.64.46.21` (ESXi 6.5, HP DL380p Gen8).

- **Neighbor discovery** comes from `HostSystem.configManager.networkSystem.QueryNetworkHint()`
  → one `PhysicalNicHintInfo` per uplink, each carrying:
  - `connectedSwitchPort` (**CDP**): `devId`, `portId`, `address` (mgmt), `hardwarePlatform`.
  - `lldpInfo` (**LLDP**): `chassisId`, `portId`, `timeToLive`, `parameter[]` (KeyValue: "System
    Name", "System Description", "Port Description", "Management Address", "Port VLAN", …).
- On this host **only CDP is populated** (standard vSwitch defaults to CDP; LLDP typically
  requires a vDS). Example: `vmnic0 → Leaf108(FDO2103204A) Ethernet105/1/5 platform N9K-C93180YC-EX`.
  **→ We must capture both LLDP and CDP** and show whichever the uplink advertises.
- **Physical NICs**: `host.config.network.pnic` → `device`, `mac`, `linkSpeed.speedMb`.
- **Host facts** (for the detail page, beyond what we store now): vendor/model
  (`summary.hardware.vendor`/`model`), CPU model + pkgs/cores, memory, ESXi
  `config.product.fullName`, uptime, and **management vmk IPs** (`config.network.vnic[].spec.ip`).
- `QueryNetworkHint` is **one call per host** returning all uplinks (bounded cost).

## 4. Goals / Non-goals

**Goals**
- **Host detail page** reachable by clicking the host in Host Utilization.
- Per-host **uplink neighbor table**: uplink (vmnic), speed/MAC, protocol (LLDP|CDP), remote
  switch name, remote port, remote platform, remote mgmt address.
- Richer **host facts** on the detail page (vendor/model, CPU, memory, ESXi build, uptime,
  mgmt IPs) + the host's **VMs** and **datastores** in context.
- Collect over the existing vSphere poller (no new connection path).

**Non-goals**
- No writes to ESXi/vCenter.
- No auto-correlation to ACI/NX-OS switch inventory in v1 (possible later — see §11).
- No historical/trend of neighbor changes (latest state only).

## 5. Design (per `docs/DEVELOPMENT.md` order)

### 5.1 Data model
- **`InventoryHostNic`** (new child of `InventoryHost`): `device` (vmnic), `mac`, `speed_mb`,
  `neighbor_protocol` (`lldp`|`cdp`|null), `remote_device`, `remote_port`, `remote_platform`,
  `remote_mgmt`, `attributes` (JSON — raw LLDP params/CDP fields). Unique `(host_id, device)`.
- **`InventoryHost`** — add the facts we don't store yet if missing: `vendor`, `cpu_model`,
  `bios_version`, `esxi_version`, `management_ip` (primary mgmt vmk). (`hardware_model`,
  `cpu_cores`, `memory_total_mb`, `uptime_seconds`, `serial` already exist.)
- Migration adds the table + columns.

### 5.2 Collector — `app/services/vsphere.py`
- Per host, call `networkSystem.QueryNetworkHint()` and join with `config.network.pnic` to
  build a **nics** list (device/mac/speed + parsed LLDP and/or CDP neighbor). Add `nics` to
  `VsphereHost`, plus the extra facts (vendor, cpu_model, esxi_version, management_ip).
- Fault-isolate the hint call (one host failing must not abort the snapshot).

### 5.3 Poller / persistence
- `apply_snapshot` upserts `InventoryHostNic` per host (replace-per-host) alongside the
  existing host upsert. No poller structural change.

### 5.4 API — `app/routers/inventory.py`
- `GET /inventory/hosts/{host_id}` — host detail (facts).
- `GET /inventory/hosts/{host_id}/nics` — uplink neighbor list.
- (VMs already filterable by `host_id`; reuse for the detail page's VM list.)

### 5.5 Frontend
- **Host Utilization** (host view): make the host **IP/name cell a link** to
  `/inventory/hosts/{id}`.
- **New `HostDetailPage`** — CGNAT-style **multi-tab** detail (KPI header: model, CPU, memory,
  ESXi, uptime, mgmt IP):
  - **Overview** — facts + counts (uplinks, VMs, datastores, networks).
  - **Uplinks & Neighbors** — **per-host topology (default) with a table toggle**: a Cytoscape
    graph with this host as the center node and each discovered remote switch as a node; **one
    edge per protocol per uplink** (LLDP / CDP), edge labelled `vmnic → remote port` with a
    protocol badge. A toggle switches to the detailed table (vmnic, MAC, speed, protocol, remote
    switch/port/platform/mgmt). Uplinks with no neighbor appear as unconnected host ports.
  - **Virtual Machines** — VMs on this host (reuse `/inventory/virtual-machines?host_id=`).
  - **Datastores** and **Networks** — this host's datastores/networks.
  Reuse shared UI (PageHeader, StatTile, tabs, Cytoscape as in NX-OS/IP-MPLS topology).

## 6. Acceptance criteria
1. Clicking a host in Host Utilization opens its detail page.
2. Detail shows host facts + a per-uplink table with remote switch name/port/platform/mgmt and
   a **LLDP/CDP** badge; uplinks with no neighbor show "none advertised".
3. Data collected via the existing poller; refreshes each cycle.
4. Works for direct-ESXi and vCenter-sourced hosts; all data via authenticated
   `/api/v1/inventory/*` JSON (OpenAPI/MCP-ready). Read-only.

## 7. Test plan
- **Unit:** feed captured `QueryNetworkHint` fixtures (CDP-only and LLDP-with-parameters) to the
  parser; assert protocol + remote fields.
- **Live:** run collector against `10.64.46.21` (CDP → Leaf108 ports) and, if available, a
  vDS/LLDP host; verify nics persist and the detail page renders.
- **Frontend:** `tsc` + build; click-through from Host Utilization; empty-neighbor rendering.

## 8. Phase 0 — done (see §3).

## 9. Edge cases
- Uplink with no neighbor (CDP/LLDP disabled or down) → row with protocol null / "none".
- Both LLDP and CDP present on one uplink → keep both (LLDP row + CDP row, or one row with
  both — decide in §11).
- vmnic with `speedMb=None` (link down) → show down.
- Large vCenter (many hosts) → one hint call per host; acceptable, but note the added calls.
- `bios_version` may be null on some versions (seen on 6.5) — tolerate.

## 10. Rollout
Additive: new table/columns + endpoints + page; follows model→migration→collector→poller→
schema→router→frontend→verify order, verified against the live ESXi host.

## 11. Resolved decisions
1. **LLDP + CDP on the same uplink:** **one row/edge per protocol** (LLDP and CDP kept separate).
2. **Neighbor view:** render as a **per-host topology (default) with a table toggle** — not
   table-only. Host node in the center, remote switches as nodes, one edge per protocol per
   uplink (labelled `vmnic → remote port`, protocol badge). Table toggle for the full detail.
3. **Topology scope:** **per-host on the detail page** this phase (small focused graph). A
   fleet-wide ESXi↔switch map is deferred to the switch-correlation phase.
4. **Clickable / primary IP:** link the host **name/IP cell**; also store an explicit
   **`management_ip`** on the host.
5. **Switch correlation (deep-link remote switch → our ACI/NX-OS device):** **next phase.**
6. **Detail tabs:** include **all** — Overview / Uplinks & Neighbors / Virtual Machines /
   Datastores / Networks — CGNAT-style multi-tab.
