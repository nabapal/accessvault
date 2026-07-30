# SDD: PBR Flow Monitoring — NetVerse AI integration

- **Status:** Implemented (2026-07-29) — Phases 1–4 on branch `feat/pbr-flow-monitoring`.
- **Owner:** sumit (reporting to naba)
- **Type:** New feature — ACI L4–L7 / PBR observability, **read-only**
- **Nav placement:** Sidebar → **Data Center Inventory**, a new **“PBR Monitoring”** item directly **below the “Endpoints”** tab. IP-flow lookup sits directly under the fabric dashboard.

> **As-built delta (validated against live Bangalore/Mumbai/Jamnagar APICs).** The
> sections below are the design; these are the deltas discovered while implementing
> and validating against real fabrics:
> - **Service intersection** matches on **(contract name, graph name)** — `vnsGraphInst`
>   exposes `ctrctDn`/`graphDn` (DNs) while `vnsLDevCtx` exposes `ctrctNameOrLbl`/
>   `graphNameOrLbl` (names), so keys are normalised to names.
> - **Extra APIC classes** beyond §5 were required to hydrate the prototype's detail:
>   `vnsLIfCtx` (consumer/provider connector split + `ctxDn` VRF), `vnsRsCIfPathAtt`
>   (leaf/path), `vnsEPpInfo` (BD-side connector VLAN), `l3extRsPathL3OutAtt` (L3Out
>   VLAN), `l3extRsEctx` (L3Out→VRF), plus `fvIp` DN parsing (`cep-<MAC>`) for the
>   learned MAC on redirect destinations.
> - **Storage:** rich per-node detail is persisted as JSON (`pbr_nodes.detail`,
>   `pbr_nodes.active_pct`) and per-service external-EPG groups as JSON
>   (`pbr_services.consumer_epgs` / `provider_epgs`) via migration
>   `20260729_pbr_detail_columns`, rather than a wider relational model.
> - **Persistence is upsert, not replace:** services are keyed by (contract, graph)
>   with a **stable id** so `pbr_health_samples` accumulate a real trend; child rows
>   are deleted explicitly because SQLite FK cascade is not enforced in this env.
> - **VLAN gap resolved:** consumer/provider `lif_encap` (e.g. `vlan-3634`, `vlan-3521`)
>   and L3Out-side VRF are now derived (BD side via `vnsEPpInfo`; L3Out side via
>   `l3extRsPathL3OutAtt`/`l3extRsEctx`). L1 shows `L1 (no VLAN)`.
> - **EPG blocks show only scope-valid** ("External Subnets for the External EPG",
>   `import-security`) subnets; route-control-only subnets are not listed there.
> - **Flow-lookup** returns the full matched service (header + EPG chips + topology +
>   node cards + consumer/provider match-basis footer), with `src_side`/`dst_side`.

## Source documents (read both before implementing)

1. [../../NetverseAI_PBR_Monitoring_SDD.docx](../../NetverseAI_PBR_Monitoring_SDD.docx) — the authored design doc (v0.1). This spec adapts it to the real NetVerse AI (accessvault) architecture. Section numbers below (§7.3 etc.) reference that document.
2. [../../NetverseAI_PBR_Flow_Console_19.html](../../NetverseAI_PBR_Flow_Console_19.html) — the validated single-file prototype. Its JS functions are the reference implementation of the business logic to port:
   - `computeServiceHealth` (line 443), `nodeHealthPct` (880), `nodeLiveStatus` (894), `nodeBypassState` (858), `nodeIsFaulty` (867)
   - `computeBlastRadius` (621)
   - `specificHits` / `ipMatchesSubnet` / `defaultRouteForContractSide` / `excludedPeers` (743–809) — the IP matcher
   - `wrapFaultText` (316), `combineStatus` (907), SVG-id uniqueness in `renderTopology` (914+)

> **Port the *logic*, not the DOM code.** Move the computation into our Python backend
> (unit-testable) + React frontend; do not lift the prototype's inline HTML/SVG string-building.

---

## 1. Summary

Integrate a **PBR (Policy-Based Redirect) Flow Monitoring** module into NetVerse AI so
engineers get one cross-fabric view of every deployed ACI L4–L7 service graph: its
health, node-by-node redirect topology (with threshold/bypass state), which PBR service
handles a given source→destination IP flow, and the blast radius of touching a shared
device group. Validated in the prototype against live APIC data from **Bangalore,
Mumbai, Jamnagar**. Read-only against APIC in every phase.

## 2. Scope

**In scope:** ACI PBR service graphs (contract+graph+node topology); fabric- and
service-level health from live `fvIp` + threshold/bypass config; IP→service
identification; device-group blast radius; read-only visualization inside the existing
NetVerse AI shell.

**Out of scope:** non-PBR contracts; non-ACI fabrics; any write/remediation to APIC; L1
real-time operational state (a data-availability gap, see §9.1 below).

## 3. Requirement highlights (what the user asked for)

- Live under **Data Center Inventory**, immediately **below the Endpoints tab**
  ([AppShell.tsx:42](../../../frontend/src/components/layout/AppShell.tsx#L42) — insert new
  item after "Endpoints"; route `/telco/aci/pbr`).
- Reuse the existing NetVerse AI shell, nav, auth/RBAC, and ACI APIC access — do not build
  a standalone page or a parallel connector.
- Preserve the three real bug-fixes from prototyping (§9) exactly.

---

## 4. Architecture (reconciled with the accessvault codebase)

Follows the existing **collector → model → poller → router → frontend service → page**
pipeline used by ACI/NXOS/CGNAT/CPNR.

| Layer | Decision |
|---|---|
| **Fabric entity** | Reuse `TelcoFabricOnboardingJob` (`fabric_type = aci`). PBR rows FK to `telco_fabric_onboarding_jobs.id`. No new controller model. |
| **APIC access** | Reuse the `telco_collector` httpx pattern: POST `/api/aaaLogin.json` → `APIC-cookie` → `/api/class/<mo>.json`, via `_apic_get_with_retry` + the fetch-concurrency semaphore. Credentials come from the fabric's encrypted `password_secret` (`crypto.decrypt_secret`). |
| **Subtree fetch** | `vnsLDevCtx` needs a full subtree (`?query-target=self&rsp-subtree=full`). The existing collector never uses `rsp-subtree`, so a small subtree-query helper is a **new, documented convention** (SDD §7.1). |
| **Ingestion** | New `app/services/pbr_collector.py` (or extend telco), following the collector pattern. Count-verify large fetches. |
| **Compute** | New `app/services/pbr_compute.py` — **pure, no I/O**, unit-testable: health scoring, three-way threshold/bypass, blast radius, IP matcher. |
| **Poller** | New `PbrPoller` following `NxosPoller` (robust `asyncio.Event` shutdown + per-item SQLite-lock retry). Gated by `settings.pbr_poller_enabled` / `pbr_poll_tick_seconds`; per-fabric interval from the fabric's `poll_interval_seconds`. Wired in `main.py` lifespan. |
| **Persistence** | New tables via a hand-written Alembic revision (chained off the current head `20260723_add_cpnr_inventory`). SQLite (async aiosqlite). |
| **Read API** | New `app/routers/pbr.py`, prefix `/pbr`, registered in `api_v1.py`; served under `/api/v1`. Read = `Depends(get_current_user)`. |
| **Frontend** | New `services/pbr.ts` (shared axios `api`, Bearer auth inherited), `types` in `types/index.ts`, page(s) under `pages/`, `<Route>` in `App.tsx` under `/telco/aci/pbr`, nav item in AppShell. |
| **Time-series** | No existing time-series store → a new `pbr_health_samples` table (SDD Appendix B Q2 resolved: new table). |

**Polling cadence (SDD §7.2):** split fast health data (`vnsGraphInst`, `fvIp`; 1–5 min)
from slow structural data (`vnsLDevCtx`, `vnsSvcRedirectPol`, `l3extSubnet`,
`fvRsProv/fvRsCons`; 15–60 min / on-demand). Tune against APIC load; the split is the
design point, not the exact numbers.

**Stale-safety (SDD §10.4):** if a fabric's APIC is unreachable during a poll, persist
nothing new and serve last-known rows with a `stale_as_of` / "stale as of …" indicator —
never blank/error the whole view.

---

## 5. ACI object classes ingested (SDD §7.1)

`vnsGraphInst`, `vnsLDevCtx` (**full subtree**), `vnsCDev`/`vnsCIf`/`vnsRsCIfPathAtt`,
`vnsSvcRedirectPol` (**full attributes incl. thresholdEnable / minThresholdPercent /
maxThresholdPercent / thresholdDownAction**), `vnsRedirectDest`,
`vnsL1L2RedirectDest`/`vnsRsToCIf`, `l3extSubnet`, `fvRsProv`/`fvRsCons`
(**count-verified**), `fvIp`.

- `vnsCIf.operSt` is **not** ingested for health — unreliable in this environment (§9.1).

## 6. Two hard filtering rules (SDD §7.3.1, §7.3.3)

- **Intersection rule:** a `(contract, graph)` pair is a real Service **iff present in
  both `vnsGraphInst` AND `vnsLDevCtx`**. Persist the intersection, never the union.
  (Prototype found Bangalore 24 device-selection vs 19 deployed; Mumbai had deployed
  graphs with no device-selection policy.)
- **Scope-valid subnet rule:** only `l3extSubnet` whose `scope` contains
  `import-security` may resolve an IP flow. Others are retained as **excluded** (shown for
  transparency) but never used to resolve a flow.

## 7. Domain model (persisted)

All tables: `GUID` PK, `fabric_job_id` FK (CASCADE), `created_at`/`updated_at`,
`raw_attributes` JSON, appropriate `UniqueConstraint`.

- **PbrService** — `contract_dn`, `graph_dn`, names, consumer/provider EPG dn+name,
  `health_pct`, `state` (`healthy|degraded|down|unknown`), `stale_as_of`.
- **PbrNode** — `service_id`, `name`, `layer` (`L1|L3`), `device_group_dn`+name (blast-radius
  join key), `leaf`/`path`, per-side `bd`/`vrf`/`vlan` (**consumer & provider may
  legitimately differ**, e.g. L1→L3 hop), `redirect_policy_names`, threshold config
  (`threshold_enable`, `min/max_threshold_pct`, `threshold_down_action`),
  `configured_dest_count`, `learned_dest_count`, `health_pct`, `live_status`
  (`live|faulty|bypassed|permit|unknown`), `bypassed`.
- **PbrRedirectDest** — `node_id`, `ip`, `mac`, `layer`, `l1_interface_ref`, `resolved`
  (L1 ref resolves), `learned` (present in `fvIp`).
- **PbrSubnet** — `epg_dn`, `side` (consumer/provider), `prefix` (CIDR), `scope`,
  `scope_valid`, `is_default_route`. (`side` is required for the default-route rule §8.)
- **PbrHealthSample** — `service_id`, `sampled_at`, `health_pct`, `state`, node snapshot
  (durable trend history; replaces the prototype's localStorage).

## 8. IP-flow lookup rules (SDD §5.3, ports `specificHits`/`defaultRouteForContractSide`)

Validated **server-side and client-side**:
1. Strict single-host IPv4/IPv6; reject CIDR in a host field with an actionable message;
   reject source/destination **address-family mismatch**.
2. **Longest-prefix match** against **scope-valid subnets only** (a `/23` beats a `/22`).
3. **Default-route fallback** (`0.0.0.0/0` / `::/0`) allowed **only when the same
   contract's opposite side holds a scope-valid default route** — not any default-route
   EPG in the fabric.
4. **Ties surfaced explicitly**, never silently resolved. Excluded (route-control-only)
   peers on the matched subnet are shown and labeled "NOT used for classification".

## 9. Critical logic — the three fixed bugs (implement exactly)

### 9.1 L1 nodes: no real-time health (SDD §9.1)
`vnsCIf.operSt` reads "down" uniformly fabric-wide even for device groups confirmed
passing traffic via `fvIp` — untrustworthy. **Never** use it for L1 health or breach. L1
health = **config-completeness only** (`nodeHealthPct`: 100 if the redirect interface
reference resolves, else 0). L1 threshold config is **informational only**, never a
computed breach.

### 9.2 Fetch `fvRsProv`/`fvRsCons` completely + verify count (SDD §9.2)
A partial fetch once captured 62/77 and 55/94 objects → wrong subnet↔contract mapping.
Ingestion must fetch programmatically and **assert `len(imdata) == int(totalCount)`**
before use; on mismatch, refuse to persist and keep last-known state.

### 9.3 Threshold Down Action: `bypass` ≠ `permit` ≠ `deny` (SDD §9.3) — **three-way**
Per node, from `vnsSvcRedirectPol` (real per-policy values, never defaulted):
`breached = threshold_enable AND active_pct < min_threshold_pct` (L3 only).
- `bypass` → `bypassed`, **score 100** ("bypassed by design"), excluded from penalizing service health.
- `permit` → **distinct informational state**, **do NOT ghost, do NOT force 100** — score from the real `active_pct` (a 0%-active permit node must score **0**).
- `deny` → genuine outage, real (low) score, `faulty`.

> ⚠️ **Prototype discrepancy to correct:** the v19 file's `nodeBypassState`
> ([line 858-865](../../NetverseAI_PBR_Flow_Console_19.html)) returns `bypassed:true` for
> **any** non-`deny` breach — i.e. it still collapses `permit` into `bypass`, the exact
> §9.3 bug. **The production implementation must follow SDD §9.3's three-way rule, not the
> v19 `nodeBypassState` code.** A unit test must pin: breached + `permit` + 0% active →
> score 0, status `permit` (not `bypassed`/100).

### 9.4 Health scoring formula (ports `computeServiceHealth`)
- **L3 node:** `learned_destinations / total_configured_destinations * 100`; "learned" = present in `fvIp`.
- **L1 node:** 100 if redirect interface ref resolves else 0.
- **Bypassed node:** 100 ("bypassed by design").
- **Service health:** average of node scores; a node with **zero configured destinations is
  excluded** from the average (not counted as 0). Bands: `healthy ≥90`, `warning 50–89`,
  `failed <50`, `unknown` when no scorable nodes (matches prototype `healthBand`).

## 10. Blast radius (SDD §5.5, ports `computeBlastRadius`)
Other services **in the same fabric** sharing a **device group** (`vnsLDevVip`) with the
viewed service. **Device-group-only by design** (not L3Out-based; SDD §9.4, Appendix B Q4).

## 11. Read API (`/api/v1/pbr`, all `Depends(get_current_user)`)

Adapts SDD §8 to our `...Page` pagination convention.

| Method + path | Purpose |
|---|---|
| `GET /pbr/fabrics` | Fabrics + rollup health counts + `stale_as_of`. |
| `GET /pbr/fabrics/{fabric_id}/services` | Paginated, searchable, sortable (health/name/state), filterable service list. |
| `GET /pbr/services/{service_id}` | Full detail: EPGs, nodes, per-side VLAN/BD/VRF, redirect dests, threshold state. |
| `GET /pbr/services/{service_id}/blast-radius` | Same-fabric device-group sharers. |
| `GET /pbr/services/{service_id}/health-history` | Time-series from `pbr_health_samples`. |
| `POST /pbr/fabrics/{fabric_id}/flow-lookup` | Body `{source,destination}`; server-side validated; returns matched service(s)/no-match with match basis (specific / default-route / tie). |

## 12. Frontend module (SDD §5, Phases 2–3)

- **Nav:** add `{ label: "PBR Monitoring", to: "/telco/aci/pbr", icon: … }` to the
  **Data Center Inventory** section **immediately after Endpoints**
  ([AppShell.tsx:42](../../../frontend/src/components/layout/AppShell.tsx#L42)); add the route in
  [App.tsx](../../../frontend/src/App.tsx) after `/telco/aci/endpoints`.
- **Dashboard + service browser:** per-fabric health cards; searchable/sortable/status-filterable
  service list; wired to the Phase 1 API (never APIC directly).
- **Service detail + topology:** Consumer EPG → node(s) → Provider EPG; per-node health %
  badge; `live/faulty/bypassed/permit/unknown` arrow states; per-side VLAN on the arrows
  (may diverge across L1→L3); ghosted skip-arc for a bypassed node distinct from a faulty one.
  **Every SVG `<defs>` id must be unique per diagram instance** (the prototype uses a
  `_topoInstanceCounter`; multiple simultaneously-rendered diagrams otherwise collide on
  `url(#…)` refs and silently drop shapes — SDD §11).
- **IP-flow lookup tool** and **blast radius** panels, wired to the API.
- Fault-code glossary tooltips (`wrapFaultText`), JSON export per fabric/service.

## 13. Non-functional (SDD §10)
Read-only against APIC; inherit portal auth/RBAC (no separate frontend credential
handling); server-side flow-lookup validation; dashboard renders from persisted/computed
state (no live APIC call per page view); fabric onboarding is configuration, not code.

## 14. Phased delivery (SDD §12)
1. **Backend** — model + migration; collector (count-verify, subtree, intersection + scope
   rules); pure compute layer; poller + config + wiring; read API; unit + integration tests.
2. **Frontend** — fabric dashboard + service browser inside the shell (nav below Endpoints), wired to Phase 1 API.
3. **Frontend** — topology (unique SVG ids), threshold/bypass states, blast radius, IP-flow lookup.
4. **Durable trend history** — `pbr_health_samples`; retire client-side history.
5. **Expand fabric coverage** — onboarding as configuration.

## 15. Testing (SDD §11)
- **Compute unit tests** (fixtures for every edge case): three-way threshold/bypass **incl.
  the `permit`≠`bypass` regression pin (§9.3)**; L1 config-only health ignoring `operSt`
  (§9.1); zero-configured-dest exclusion (§9.4); blast radius; IP matcher (CIDR reject,
  family mismatch, **longest-prefix `/22` vs `/23`**, default-route same-contract-opposite-side,
  tie surfacing).
- **Integration test:** ingestion asserts fetched counts == APIC `totalCount` for
  `fvRsProv`/`fvRsCons` (§9.2).
- **Frontend multi-diagram test:** several topology diagrams rendered simultaneously must
  not collide on SVG element ids (§12).
- **Data-quality check:** compare deployed-graph vs device-selection counts per fabric;
  alert on a sharp intersection-rate drop.

## 16. Appendix — deviations & open questions
**Deviations from SDD's illustrative design:** fabric entity reused
(`TelcoFabricOnboardingJob`); API adapted to `...Page` pagination; `flow-lookup` is POST
(body) but non-mutating; subtree query is a new helper; credentials from encrypted
`password_secret` not a `SystemCredential` FK. **Corrected from v19 prototype:** the
three-way threshold rule supersedes v19's `nodeBypassState` permit/bypass collapse (§9.3).

**Open questions (SDD Appendix B):**
1. Ingestion job ownership/pattern → **resolved**: reuse the `*_collector` + `*_poller`
   pattern; PBR poller in `main.py` lifespan.
2. Time-series store → **resolved**: new `pbr_health_samples` table (no existing TS store).
3. Acceptable structural-data staleness window (15–60 min?) — confirm with NOC.
4. Extend blast radius to L3Out-sharing later? (device-group-only today.)
5. Right ACI/PBR SMEs to validate the §9.1 L1 `operSt` finding before build.
