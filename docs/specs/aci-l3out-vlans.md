# SDD: Include L3Out VLANs in the ACI VLAN Inventory

- **Status:** Implemented (commit `78623a6`, 2026-07-06) — verified live on all fabrics
- **Owner:** naba
- **Date:** 2026-07-06
- **Module:** NetVerse AI → Data Center Inventory → Cisco ACI VLANs (`/telco/aci/vlans`)
- **Type:** Feature (extend existing VLAN inventory)

---

## 1. Summary

The ACI VLAN inventory at `/telco/aci/vlans` currently lists **only Bridge-Domain
(EPG-attached) VLANs**. Cisco ACI also deploys encap VLANs for **L3Outs** (external
routed SVIs), which are not represented today. This feature adds L3Out VLANs to the
**same table** with the **same columns**. The only visible change is the
**"Bridge Domain"** column, which is renamed **"Bridge Domain / L3OUT"** and shows
the **L3Out name** for L3Out-derived VLANs (and the Bridge-Domain name for BD VLANs,
as today). All other fields keep their current meaning.

## 2. Motivation

L3Out SVIs consume VLAN encaps on leaf ports just like EPGs do. Operators auditing
VLAN usage, free encaps, or tenant/VRF mappings need L3Out VLANs in the same view;
today they are invisible, giving an incomplete picture of deployed VLANs.

## 3. Current behavior (as-built)

- **Collection** — `backend/app/services/telco_collector.py`
  - `_collect_and_upsert_aci_vlans()` fetches `vlanCktEp` (deployed VLAN circuit
    endpoints per leaf), plus `fvBD` and `fvCtx` name maps.
  - `_build_fabric_vlans()` aggregates `vlanCktEp` by `encap` (e.g. `vlan-100`) and
    resolves: `epgDn` → tenant / app_profile / epg; `bdDn` segment → `bridge_domain`;
    `ctxDn` segment → `vrf`. Only `encap` starting with `vlan-` is kept.
  - `_replace_fabric_vlans()` deletes and re-inserts `AciFabricVlan` rows per job.
- **Model** — `AciFabricVlan` (`backend/app/models/aci.py`): `encap`, `vlan_id`,
  `fab_encap`, `epg`, `tenant`, `app_profile`, `bridge_domain`, `vrf`, `pc_tag`,
  `mode`, `admin_state`, `oper_state`, `node_count`, `nodes`. Unique on
  `(fabric_job_id, encap)`.
- **API** — `GET /api/v1/telco/aci/fabric/vlans` (`list_fabric_vlans` in
  `backend/app/routers/aci.py`), paginated + `search`; schema
  `AciFabricVlanRead` / `AciFabricVlanPage` (`backend/app/schemas/aci.py`).
- **Frontend** — `frontend/src/pages/AciVlansPage.tsx` renders columns:
  Fabric, VLAN, EPG, Tenant / App, **Bridge Domain**, VRF, VXLAN, Nodes.
  Type `AciFabricVlan` in `frontend/src/types/index.ts`.

L3Out encap VLANs are **not** currently surfaced (their `vlanCktEp` records resolve
to an L3Out owner, not a BD/EPG, so they either fall out or show blank associations).

## 4. Goals / Non-goals

**Goals**
- Surface L3Out encap VLANs in the same table and API as BD VLANs.
- Rename the display column to **"Bridge Domain / L3OUT"**; show the **L3Out name**
  for L3Out rows, BD name for BD rows.
- Distinguish the two kinds so search/label/badge can tell them apart.
- Keep all other columns/fields identical in meaning.

**Non-goals**
- No new page, route, or nav entry.
- No L3Out topology, routing, or prefix data — VLAN inventory only.
- No change to BD-VLAN semantics.

## 5. Proposed design

### 5.1 Data source (APIC) — confirmed in Phase 0

Phase 0 against the live APIC (`10.88.17.162`, fabric "Bangalore") showed that on
this fabric **L3Out SVIs do not appear as `vlanCktEp`** (no `vlanCktEp.epgDn`
contains `/out-`; `bdDn`/`ctxDn` are null there). L3Out encap VLANs live on
**`l3extRsPathL3OutAtt`**:

```
dn    = uni/tn-<TENANT>/out-<L3OUT>/lnodep-<..>/lifp-<..>/rspathL3OutAtt-[<path>]
encap = vlan-2627
ifInstT = ext-svi
tDn   = topology/pod-1/paths-<NODE>/pathep-[<intf>]
mode  = regular
```

So the L3Out VLAN source and mapping is:
- **VLANs:** `l3extRsPathL3OutAtt` where `encap` starts with `vlan-`
  (`ifInstT == ext-svi`). `vlan_id` from the encap.
- **L3Out name + tenant:** parse the `out-<L3OUT>` and `tn-<TENANT>` segments of `dn`.
- **VRF:** `l3extRsEctx` (`/api/class/l3extRsEctx.json`) keyed by the L3Out DN
  (`uni/tn-…/out-<L3OUT>`) → `tnFvCtxName`.
- **External EPG (EPG column):** `l3extInstP` (`/api/class/l3extInstP.json`) under the
  same L3Out DN → `instP-<name>` (first; join if several).
- **Node / interface:** parse `tDn` → `paths-<NODE>` and `pathep-[<intf>]`; aggregate
  nodes per encap (same as BD VLANs).
- `binding_type = "l3out"`, `bridge_domain = null`, `l3out = <name>`.

**State columns:** `l3extRsPathL3OutAtt` carries `mode` (populate it). It does **not**
expose `adminSt`/`operSt` directly (those are config, not oper); populate `mode` and
leave admin/oper best-effort (`--` if unavailable) — deployed presence implies active.
This refines Resolved-decision #1: `mode` is populated the same way; admin/oper are
best-effort for L3Out rows.

**Merge rule:** L3Out entries are added for `encap`s not already produced by the
`vlanCktEp` (BD/EPG) pass, preserving the `(fabric_job_id, encap)` uniqueness.

### 5.2 Data model
Add two nullable columns to `AciFabricVlan` (`backend/app/models/aci.py`):
- `binding_type: str | None` — `"bd"` or `"l3out"` (default `"bd"` for existing rows).
- `l3out: str | None` — L3Out name (null for BD VLANs).

Keep `bridge_domain` unchanged (BD name for BD VLANs; null for L3Out). The frontend
derives the combined display value.

> Alternative (rejected): overload `bridge_domain` to hold the L3Out name. Rejected —
> loses the ability to filter/label by kind and muddies the schema.

**Migration:** `backend/migrations/versions/<date>_aci_vlan_l3out.py` adding the two
columns, `down_revision` = current head. Auto-applies on startup.

### 5.3 Collector
- Extend `_build_fabric_vlans()` to accept an `l3out_by_seg`/`l3out_ctx` map and set
  `binding_type` + `l3out` + `vrf` for L3Out-owned encaps.
- Extend `_collect_and_upsert_aci_vlans()` to also fetch `l3extOut` (+ `l3extRsEctx`)
  and build the L3Out maps alongside the BD/VRF maps.
- Extend `_replace_fabric_vlans()` to persist `binding_type` and `l3out`.
- Deploy-count/`nodes` aggregation, `encap` uniqueness, and up/down logic unchanged.

### 5.4 API / schema
- Add `binding_type: str | None` and `l3out: str | None` to `AciFabricVlanRead`.
- Extend `list_fabric_vlans` search to also match `l3out` and `binding_type`
  (same `func.lower(func.coalesce(...))` pattern already used for `bridge_domain`).

### 5.5 Frontend
- `frontend/src/types/index.ts`: add `binding_type?: string | null` and
  `l3out?: string | null` to `AciFabricVlan`.
- `frontend/src/pages/AciVlansPage.tsx`:
  - Rename the header **"Bridge Domain"** → **"Bridge Domain / L3OUT"**.
  - Cell renders `bridge_domain` for BD rows and `l3out` for L3Out rows, with a small
    badge (`BD` / `L3OUT`) so the kind is obvious. All other columns unchanged.
  - Update the search placeholder to mention L3Out.

## 6. Acceptance criteria

1. `/telco/aci/vlans` shows both BD and L3Out VLANs from all onboarded fabrics.
2. The column header reads **"Bridge Domain / L3OUT"**.
3. BD VLAN rows show the **Bridge Domain** name (unchanged from today).
4. L3Out VLAN rows show the **L3Out** name in that column, with an `L3OUT` indicator.
5. All other columns (Fabric, VLAN, EPG, Tenant/App, VRF, VXLAN, Nodes, states)
   populate for L3Out rows using the same semantics; unavailable values render `--`.
6. Search matches L3Out names.
7. Existing BD-VLAN counts/values are unchanged (no regression).
8. `GET /api/v1/telco/aci/fabric/vlans` returns `binding_type` and `l3out`; OpenAPI
   reflects them (MCP-ready).

## 7. Test plan

- **Unit:** feed synthetic `vlanCktEp` + `l3extOut`/`l3extRsEctx` fixtures (one BD
  VLAN, one L3Out VLAN) to `_build_fabric_vlans`; assert `binding_type`, `l3out`,
  `vrf`, `encap`, node aggregation.
- **Integration (live APIC `10.88.17.162`):** run the collector for a fabric known to
  have an L3Out; confirm L3Out encaps appear with correct L3Out name + VRF and BD
  VLANs are unchanged.
- **API:** hit `/telco/aci/fabric/vlans`; verify new fields + search by L3Out name.
- **Frontend:** `npx tsc --noEmit` + `npm run build`; visually confirm header rename,
  badges, and `--` fallbacks.

## 8. Phase 0 — discovery (do first)

Against the live APIC, confirm the exact object model before coding:
1. For an L3Out SVI, capture a sample `vlanCktEp` and inspect `dn` / `epgDn` /
   `bdDn` / `ctxDn` to determine how to detect L3Out ownership and extract the
   L3Out name.
2. Confirm `l3extOut` + `l3extRsEctx` give L3Out name + VRF; capture samples to
   `data/samples/aci/` (git-ignored).
3. Decide detection rule (owner-DN under `out-<name>` vs. join via
   `l3extRsPathL3OutAtt`). Record the decision in this doc before implementation.

## 9. Edge cases

- Same encap used by both a BD EPG and an L3Out on different leaves → keep current
  `(fabric_job_id, encap)` uniqueness; classify by majority/first-seen and note the
  limitation, or split key by owner (decide in Phase 0).
- L3Out with no deployed SVI (no `vlanCktEp`) → not listed (correct; nothing deployed).
- Missing VRF/tenant on L3Out → render `--`.
- Existing rows after migration default to `binding_type="bd"`, `l3out=null`.

## 10. Rollout

- Backwards-compatible (additive columns/fields). No breaking API change.
- Ships behind the normal deploy; next poll repopulates VLANs including L3Outs.
- Follows the `docs/DEVELOPMENT.md` order: model → migration → collector → schema →
  router → frontend → verify → commit per step.

## 11. Resolved decisions

- **L3Out VLAN `mode`/`admin_state`/`oper_state`:** present on the L3Out `vlanCktEp`
  the same way as EPG ones → **Yes.** Populate these columns for L3Out rows using the
  same `vlanCktEp` attributes as BD VLANs.
- **`EPG` column for L3Out rows:** **show the external EPG (`l3extInstP`) name.**
  Resolve it from the L3Out's external EPG; fall back to `--` only if none is
  associated with the deployed encap.
