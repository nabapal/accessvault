# SDD: VM connectivity topology (VM → Network → Uplink → Switch)

- **Status:** Implemented — verified live (VM Arbor_collector → VM Network 2/3 → vmnic1/vmnic0 → Leaf108 CDP)
- **Owner:** naba
- **Date:** 2026-07-15
- **Module:** NetVerse AI → VM Inventory (VM Center → VM detail)
- **Type:** Feature — clickable VM + physical-path connectivity topology

---

## 1. Summary

In **VM Center** (`/inventory/virtual-machines`), replace the details popup with a clickable
**VM detail page** that includes a **connectivity topology**: for each VM, trace
**VM → Network(portgroup) → Host uplink (vmnic) → Switch(port)** using the CDP/LLDP neighbor
data already collected on the host uplinks. Operators see exactly which physical switch/port a
VM's traffic egresses through.

## 2. Motivation

We now capture host uplink → switch neighbors (`InventoryHostNic`). A VM's real network path
runs through its portgroup(s) → the host vSwitch/vDS uplinks → the fabric switch. Surfacing that
per VM answers "where does this VM connect to the network?" without hopping vCenter → switch CLI.

## 3. Phase 0 findings (confirmed live 2026-07-15, ESXi 10.64.46.21)

The full join works on real data:
- **VM → portgroups:** `vm.network[].name` (and `vm.config.hardware.device` vNIC backings).
  Already persisted as `InventoryVirtualMachine.networks` (JSON list of portgroup names).
- **Portgroup → uplinks (standard vSwitch):** `host.config.network.portgroup[].spec` gives
  `name` + `vswitchName`; `host.config.network.vswitch[].pnic` (keys) → `pnic[].device`
  (vmnicN). So portgroup → vSwitch → uplink vmnics.
- **vDS:** `host.config.network.proxySwitch[]` has `.dvsName` + `.pnic`; distributed portgroups
  map via their dvPortgroup → the proxySwitch uplinks. (Test host is standard vSwitch; vDS
  handled best-effort + verified where available.)
- **Uplink → switch:** `InventoryHostNic` (device → remote_device/port + protocol), from
  `QueryNetworkHint`.

Example: VM `Arbor_collector` → `VM Network 2` → `vmnic1` → CDP `Leaf108 Ethernet105/1/2`;
`VM Network 3` → `vmnic0` → `Leaf108 Ethernet105/1/5`.

## 4. Goals / Non-goals

**Goals**
- Clickable VM (name/IP) → **VM detail page** (CGNAT/host-detail style, tabbed).
- **Connectivity topology** (default) + table toggle: 4 tiers VM → Network → Uplink → Switch,
  edges labelled (portgroup, vmnic, protocol/port).
- Reuse existing data: VM `networks`, new host portgroup→uplink map, `InventoryHostNic`.

**Non-goals**
- No per-vNIC MAC/IP-to-switch-MAC correlation (v1 uses portgroup→uplink physical path).
- No deep-link of the switch node to our ACI/NX-OS inventory (shared "next phase" with the
  host-detail spec).
- No writes; no VLAN/trunk validation of whether the portgroup VLAN is actually allowed on the
  uplink (show physical path only).

## 5. Design (per `docs/DEVELOPMENT.md` order)

### 5.1 Data model
- **New `InventoryHostPortgroup`** (child of `InventoryHost`): `name`, `switch_name`,
  `switch_kind` (`standard`|`dvs`), `uplinks` (JSON list of vmnic devices), `vlan_id` (if
  available), `attributes`. Unique `(host_id, name)`.
- Reuse `InventoryVirtualMachine.networks` (portgroup names) and `InventoryHostNic`.
- Migration adds the table.

### 5.2 Collector — `app/services/vsphere.py`
- Per host, build a portgroup→uplinks map: standard (`portgroup.spec.vswitchName` →
  `vswitch.pnic` → device) and vDS (`proxySwitch.dvsName`/`.pnic`; distributed portgroups by
  key). Add `portgroups` to `VsphereHost`.
- No new connection/call beyond data already retrieved (+ the existing `QueryNetworkHint`).

### 5.3 Poller
`_upsert_hosts` also replaces `InventoryHostPortgroup` per host (like nics).

### 5.4 API — `app/routers/inventory.py`
- `GET /inventory/virtual-machines/{vm_id}` — VM detail (existing fields).
- `GET /inventory/virtual-machines/{vm_id}/topology` — builds nodes/links by joining the VM's
  `networks` → its host's portgroups → uplinks → host nics (switch neighbor). Returns
  `{nodes[], links[]}` with node `kind` in `vm|network|uplink|switch`.

### 5.5 Frontend
- **VM Center**: make the VM **name/IP a link** to `/inventory/virtual-machines/{id}` (retire
  the popup, or keep a quick-peek and add "Open detail").
- **New `VmDetailPage`** (tabs): **Overview** (today's popup fields: power, guest OS, CPU/mem/
  storage, tools, host link), **Connectivity** (Cytoscape 4-tier topology + table toggle),
  **Networks** (portgroups + resolved uplinks/switch), **Storage** (datastores). Reuse shared UI
  and the host-detail topology approach.

## 6. Acceptance criteria
1. Clicking a VM opens its detail page.
2. Connectivity tab shows the VM → Network → Uplink → Switch graph (default) with a table
   toggle; edges labelled with portgroup / vmnic / remote port + LLDP|CDP badge.
3. A VM on a standard vSwitch resolves to the correct uplink(s) and switch/port (verified live);
   vDS VMs resolve where the host exposes the proxySwitch mapping.
4. VM with an unresolvable network (no matching host portgroup, or uplink with no neighbor)
   shows the partial path (VM → Network with a dangling end), not an error.
5. All via authenticated `/api/v1/inventory/*` JSON. Read-only.

## 7. Test plan
- **Unit:** portgroup→uplink builder (standard + vDS fixtures); topology join (VM→…→switch),
  incl. missing-neighbor and multi-network VMs.
- **Live:** VM `Arbor_collector` / `FTP-2` on 10.64.46.21 → expect Leaf108 ports via vmnic0/1/3.
- **Frontend:** `tsc` + build; click-through from VM Center; topology + table render; partial-path VM.

## 8. Phase 0 — done (see §3).

## 9. Edge cases
- VM with **multiple networks** → multiple branches (one per portgroup).
- Portgroup on a **vSwitch with multiple uplinks (NIC teaming)** → multiple uplink→switch edges.
- **vDS** portgroup → resolve via proxySwitch; if unresolvable, show VM→Network only.
- Portgroup name **not found** on the host (name drift) → dangling network node, no crash.
- VM **not on any host** (orphaned) or powered off → show what's known.
- Uplink with **no CDP/LLDP** neighbor → uplink node with no switch edge.

## 10. Rollout
Additive: one new table + endpoints + page; model→migration→collector→poller→schema→router→
frontend→verify order, verified against the live ESXi VMs.

## 11. Resolved decisions
1. **Presentation:** a **new VM detail page** (tabbed, like Host/CGNAT detail) — retire the popup.
2. **Topology depth:** full **4-tier VM → Network → Uplink → Switch** (default graph + table toggle).
3. **Switch → ACI/NX-OS correlation:** deferred (shared next phase with host-detail).
4. **Portgroup→uplink mapping:** **stored** (poller-computed `InventoryHostPortgroup`), consistent
   with the collect-then-serve pattern.
