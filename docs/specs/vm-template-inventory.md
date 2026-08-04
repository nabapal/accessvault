# VM Inventory — show VMs and Templates (typed)

- **Feature:** Include VMware **templates** in the inventory alongside VMs, clearly distinguished.
- **Status:** Implemented — Type column + filter + Templates tile; also fixed a
  collector traversal bug found during Phase 0 (see §4a). tsc+build clean.
- **Module:** VM Inventory (VMware)
- **Date:** 2026-07-23

## 1. Summary
vSphere templates are VMs with `config.template = true`. The collector already
lists them (the `vim.VirtualMachine` container view includes templates), so they
currently appear as ordinary VMs. Add an `is_template` flag end-to-end and surface
it in VM Center as a **Type** column (VM / Template badge) + a **Type filter**
(All / VMs / Templates) + a Templates count tile. Nothing is hidden.

## 2. Motivation
Operators want both VMs and templates visible but distinguishable (e.g. AD-Clone
on vCenter 10.64.46.34 is a template — `vm-3146`, datacenter Replica). Today
templates are indistinguishable from running VMs and inflate VM counts silently.

## 3. Phase 0 (validated)
- `summary.config.template` (bool) reliably flags templates via pyVmomi
  (confirmed live: AD-Clone → `is_template = True`, powerState poweredOff).
- Collection path: `entity.summary` in the VM loop of `vsphere.py`.

## 4a. Collector traversal bug (found + fixed during Phase 0)
The collector iterated only `datacenter.vmFolder.childEntity` (top-level) and
only `rootFolder.childEntity` as datacenters — so it **missed VMs in subfolders /
vApps and datacenters nested inside folders**. Live proof: a recursive scan of
vCenter 10.64.46.34 found 277 VMs vs the collector's 210. Fixed with
`_iter_datacenters()` (recurse folders → datacenters) and `_iter_vm_entities()`
(recurse folders/vApps → VMs); collector now returns 276 (277 minus a VM deleted
mid-test). This is a correctness fix independent of templates.

## 4. Design
- **Model:** `InventoryVirtualMachine.is_template` (Boolean, default false).
- **Collector (`vsphere.py`):** add `is_template` to `VsphereVirtualMachine`; set
  `is_template = bool(getattr(summary.config, "template", False))`. Do NOT skip
  templates.
- **Poller:** map `vm.is_template = vm_data.is_template`.
- **Schema:** `InventoryVMRead.is_template: bool`.
- **Frontend (VirtualMachinesPage):**
  - New **Type** column with a badge: `VM` (slate/primary) / `TEMPLATE` (violet).
  - **Type filter**: All / VMs / Templates (alongside the power-state filter).
  - Summary: a **Templates** count tile (count of `is_template`).
  - Search unaffected.

## 5. Acceptance criteria
- Templates appear with a TEMPLATE badge; real VMs show VM.
- Type filter narrows to VMs-only or Templates-only; "All" shows both.
- AD-Clone (once its vCenter is polled) shows as a template.
- No schema-breaking change; migration additive.

## 6. Test / verification
- Live: `collect_inventory(10.64.46.34)` marks AD-Clone `is_template=True` and a
  running VM `False`.
- Migration applies at head; `tsc` + `npm run build` clean.

## 7. Rollout
- Additive column + migration. Existing rows default `is_template=false` until the
  next poll refreshes them.
