# CPNR Inventory (Cisco Prime Network Registrar — DHCP)

- **Feature:** Per-VM CPNR DHCP config inventory, primary↔secondary consistency checking, and change tracking.
- **Status:** Implemented (P1–P4) — verified live on the Bangalore Utility pair; backend import + tsc/build clean.

> Implementation note: the six object types are stored in a single typed
> `cpnr_objects` table (object_type discriminator + business key + normalized
> `data` + `content_hash`) rather than six physical tables — the diff /
> persistence / API / UI are all generic, and per-type views are filters. This
> satisfies the "per-VM inventory" intent (D1) with far less surface area.
- **Module:** CPNR Inventory (IPSE service module, on the CGNAT pattern — see [[ipse-service-inventory]]).
- **Date:** 2026-07-23
- **Probed live:** Bangalore Utility pair — primary `10.64.38.28`, secondary `10.64.38.29` (CPNR REST on :8443).

## 1. Summary
A new IPSE service-inventory module for **Cisco Prime Network Registrar (CPNR)**
DHCP. For every CPNR VM it collects six config object types over the REST API,
stores them per-VM, detects and logs changes over time, and compares each
**primary/secondary pair** to flag configuration drift. DHCP only (no DNS in
this estate). Built on the CGNAT module pattern (per-device onboarding +
encrypted creds + collector + resilient poller + Summary/List/Detail/Admin UI).

## 2. Motivation
CPNR runs as manually-managed primary/secondary VM pairs per service
(Utility/FTTx/WIFI/A6/… across Bangalore + Mumbai). Operators need: a single
inventory of each VM's DHCP config, assurance that a pair's two VMs are
**configured identically** (drift = outage risk on failover), and an audit
trail of what changed and when. Maps directly to the six stated requirements.

## 3. Requirements → design (traceability)
| # | Requirement | Design element |
|---|---|---|
| 1 | Individual inventory per CPNR VM | `cpnr_vms` row + per-VM-scoped child tables (logical per-VM DB in the shared app DB — §7-D1) |
| 2 | Fetch Prefix / IPv6-Res / Scope / IPv4-Res / Clients / Client-Classes | 6 child tables filled by the REST collector (§4b) |
| 3 | Compare primary↔secondary | Pair-consistency diff engine (presence + value, OID-excluded) (§4d) |
| 4 | Flag inconsistencies | Pair status (in_sync/drift) + per-object findings, surfaced in a Comparison view (§4d, §4f) |
| 5 | Update config changes in DB | Idempotent re-sync: upsert + delete-not-seen each poll (§4c) |
| 6 | Track changes, log per VM | `cpnr_change_events` + Changes tab + on-demand `cpnr_<vm>_changes.log` export (§4e, §7-D2) |

## 4. Design

### 4a. Phase-0 facts (validated live)
- **REST** on `:8443`, HTTP Basic, base `…/web-services/rest/resource/{Class}`,
  JSON via `Accept: application/json`. Read-only GETs.
- **Pagination = cursor via `Link: rel="next"`** (`…/web-services/rest/collection/<id>`);
  lists cap at ~20/page → the collector **must follow the cursor** to fetch all.
- **Per-VM credentials** (Utility-primary = `rancore@123`, others `admin`) →
  per-device encrypted creds (Fernet), like CGNAT.
- **`objectOid` is server-local** (differs between primary and secondary) → it is
  **never** used as the comparison/identity key; the business key is.

| Object | Resource | Business key | Key fields collected |
|---|---|---|---|
| Scope (v4) | `Scope` | `name` | subnet, rangeList[start,end], policy, embeddedPolicy, vpnId, tenantId |
| Prefix (v6) | `Prefix` | `name` | address, range, allocationGroup(+priority), policy, embeddedPolicy |
| IPv4 Reservation | `Reservation` | `ipaddr` | lookupKey, lookupKeyType, scope, vpnId |
| IPv6 Reservation | `Reservation6` | `ip6Address` | lookupKey, lookupKeyType, prefix |
| Clients | `ClientEntry` | `name` | embeddedPolicy, (client-class) |
| Client Classes | `ClientClass` | `name` | embeddedPolicy |

Also available (system): `DHCPServer`, `CCMCluster`, `Policy`. Failover-pair
resource is not exposed under obvious names → pairing is **manual** (§7-D3).

### 4b. Collector (`cpnr_collector.py`)
- httpx client, Basic auth, `verify_ssl` per VM, timeout.
- `fetch_all(resource)` — GET base resource, append items, follow
  `Link: rel="next"` until absent (guard max pages). Returns full list.
- Parse each object into a normalized dict (business key + typed fields + raw
  `attributes` JSON) and compute a **`content_hash`** = stable hash of the
  normalized fields **excluding `objectOid`** and volatile/server-local fields.
- Facts: version/cluster from `DHCPServer`/`CCMCluster`; object counts.
- Resilient: per-resource try/except; a failed resource leaves prior data intact
  and records `last_error`; sync still reports partial success.

### 4c. Persistence (idempotent, per-VM)
- Upsert child rows keyed on `(vm_id, business_key)`; **delete-not-seen** to drop
  removed objects (req 5). Diff against stored rows *before* writing to emit
  change events (§4e).
- Roll up counts onto `cpnr_vms`.

### 4d. Pair-consistency diff engine (req 3/4)
- Input: a `pair_id` → primary VM P, secondary VM S. For each object type:
  - **Presence diff:** business keys only-on-P, only-on-S.
  - **Value diff:** keys present on both whose `content_hash` differs → list the
    differing fields (from stored normalized fields).
- Output: per-pair **consistency report** (grouped by object type) + a rollup
  (`in_sync` | `drift` + inconsistency_count + `last_compared_at`) persisted on
  the pair/VMs. Computed from stored rows (pure DB), so it's cheap and reusable.
- Runs after each sync of either pair member, and on demand.

### 4e. Change tracking (req 6)
- On each sync, compare fetched vs stored per (vm, object_type):
  new key → `added`; missing key → `removed`; same key, different `content_hash`
  → `modified` (record changed field(s) old→new).
- Write `cpnr_change_events` rows (per VM, timestamped). Surface in a **Changes**
  tab; **export** endpoint streams a per-VM `cpnr_<vm>_changes.log`.

### 4f. Schema
- **`cpnr_vms`**: id, name, site, service, role (primary|secondary|local),
  pair_id (nullable; links the two), mgmt_ip, port(=8443), username,
  password_secret, verify_ssl, version, cluster_role, poll_interval_seconds,
  status, last_polled_at, last_error, per-object counts, pair_status,
  inconsistency_count, last_compared_at, description, timestamps.
- **6 child tables** (`cpnr_scopes`, `cpnr_prefixes`, `cpnr_reservations4`,
  `cpnr_reservations6`, `cpnr_client_entries`, `cpnr_client_classes`): id, vm_id
  (FK, cascade), business-key column(s), normalized fields, `attributes` JSON
  (raw), `content_hash`, timestamps; unique `(vm_id, business_key)`.
- **`cpnr_change_events`**: id, vm_id (FK), ts, object_type, object_key, action,
  field, old_value, new_value, detail JSON.
- (Optional) `cpnr_pairs` if a first-class pair row proves cleaner than
  `pair_id` on VMs; decide in P2.

### 4g. API (`/cpnr`)
- `GET /cpnr/vms` (paginated; filters site/service/role/status/pair_status +
  search), `GET /cpnr/vms/{id}`.
- `GET /cpnr/vms/{id}/{scopes|prefixes|reservations4|reservations6|clients|client-classes}`.
- `GET /cpnr/vms/{id}/changes`, `GET /cpnr/vms/{id}/changes/export` (log file).
- `GET /cpnr/pairs`, `GET /cpnr/pairs/{pair_id}/comparison` (detailed diff).
- `GET /cpnr/summary`.
- Admin: `POST /cpnr/vms`, `PATCH`, `DELETE`, `POST /cpnr/vms/{id}/test`, `/sync`.

### 4h. Frontend
- Sidebar **CPNR Inventory** → Summary · VMs · Pair Comparison · (Admin →) Onboarding.
- **Summary**: tiles (VMs, pairs, pairs in-sync vs **drift**, total objects,
  VMs in error); charts by site/service. Reuse CGNAT summary.
- **VMs list**: grouped by pair, columns incl. site/service/role, object counts,
  **drift chip**, version, status, last-poll; filters + search.
- **VM detail** (tabbed, reuse device-detail): Overview / Scopes / Prefixes /
  Reservations (v4+v6) / Clients / Client-Classes / **Changes**.
- **Pair Comparison**: pick a pair → side-by-side per object type; highlight
  only-on-one (add/remove) and value mismatches; export/report.
- **Admin onboarding**: mgmt_ip, creds, verify_ssl, **site/service/role**, and
  **pair designation** (which VM is the primary's secondary).

## 5. Acceptance criteria
- Each onboarded VM shows all 6 object lists, fully paginated (verified counts:
  Utility 72 scopes / 90 prefixes / 11 res4 / 102 res6 / 35 clients / 31 classes).
- Re-sync updates the DB (new/changed/removed objects reflected) — req 5.
- A pair with identical config shows **in_sync**; an injected difference shows
  **drift** with the exact object(s)/field(s) — req 3/4.
- Change events recorded per VM and exportable to a per-VM log — req 6.
- Per-VM credentials (incl. Utility-primary `rancore@123`) work; secrets encrypted.

## 6. Test / verification
- Live re-fetch both Utility VMs; counts match §5; diff = in_sync.
- Validate drift detection against a known-inconsistent pair (e.g. a Mumbai pair)
  or by temporarily filtering one object out — must flag presence + value diffs.
- `content_hash` stable across polls when config unchanged (no false change events).
- Backend imports + Alembic head applies; `tsc` + `npm run build` clean.

## 7. Resolved decisions
- **D1 — per-VM storage:** logical per-VM inventory in the shared DB (device row
  + child tables scoped by vm_id), not physical per-VM DB files.
- **D2 — change log:** DB `cpnr_change_events` (source of truth) + on-demand
  per-VM file export.
- **D3 — pairing:** manual at onboarding (designate primary/secondary + pair_id);
  singles (e.g. `pcpe-local`) have no pair and skip the diff.
- **D4 — module shape:** service-first CPNR module on the CGNAT pattern; DHCP
  only; REST (cursor-paginated) collector.

## 8. Edge cases
- **Singles/local** VMs (no secondary) → pair_status = `single`, no diff.
- **Per-page cap** → always follow the cursor; guard against runaway pages.
- **objectOid / server-local fields** excluded from `content_hash` and diff.
- **Partial collection** (one resource errors) → keep prior rows, flag error,
  don't emit spurious "removed" change events for the un-fetched type.
- **Auth/version variance** across VMs → per-VM creds; tolerate missing system
  resources.
- **Large lists** (v6 reservations/clients) → pagination + bounded concurrency
  in the poller.

## 9. Phases
- **P1** — model + migration, REST collector (cursor pagination) + persistence,
  resilient poller, onboarding admin (with pairing fields), VMs list + VM detail
  (6 object tabs), basic Summary.
- **P2** — pair-consistency diff engine + Pairs list + **Pair Comparison** view +
  drift flags/health (req 3/4).
- **P3** — change detection + `cpnr_change_events` + Changes tab + per-VM log
  export (req 5/6 depth).
- **P4** — Summary charts/filters polish, value-diff depth, edge-case hardening.

## 10. Rollout
- Additive tables + migration (non-destructive). Ships with the next build; the
  poller is config-gated (`cpnr_poller_enabled`). Onboard the Bangalore + Mumbai
  pairs after merge.
