# PBR Flow Monitoring — large-fabric collection resilience

- **Feature:** Make PBR collection reliable on large/loaded ACI fabrics so services always persist.
- **Status:** Approved — root cause confirmed on prod; implementing on branch `fix/pbr-large-fabric-resilience`.
- **Module:** PBR Flow Monitoring (`/api/v1/pbr`, `app/services/pbr_collector.py`)
- **Date:** 2026-08-05

## 1. Summary
On the prod instance the **Jamnagar** ACI fabric showed **0 PBR services** in
`telco/aci/pbr` even though its APIC has 10 deployed service graphs. Root cause:
the PBR poller polls every fabric on **every tick** (no interval gate), which —
combined with the ACI inventory poller — overloads the large Jamnagar APIC; the
PBR fetch then hits **503**, `collect_pbr_for_job` returns `success=False`, and
the poller **persists nothing and never surfaces the failure**, so the fabric
stays permanently empty. Fix: interval-gated polling, a more resilient fetch, and
visible failures.

## 2. Motivation (prod incident, 2026-08-05)
Investigated live (read-only) on `nap2@10.64.46.241`:
- APIC `10.63.29.8` (Jamnagar) has **10 `vnsGraphInst`, 19 `vnsLDevCtx`, 22
  `vnsSvcRedirectPol`, 51 `vnsRedirectDest`**; base ACI inventory is rich
  (134 nodes, 6,658 interfaces, 15,003 `fvIp`).
- DB had **0 pbr_services** for Jamnagar (never persisted); Bangalore=19,
  Mumbai=23; New Jamnagar genuinely 0 (APIC empty — correct).
- Running the real collector **in isolation** produced **10 services / 11 nodes /
  277 scope-valid subnets** and persisted them — so code + data are fine; the
  periodic poller was the problem.
- A one-shot `collect_pbr_for_job(Jamnagar)` fixed the immediate data (0 → 10);
  this SDD makes it stick.

## 3. Root cause (confirmed)
1. **No interval gate.** `PbrPoller._should_poll` returns `True` for every
   READY/FAILED ACI fabric on **every tick** (default 60s) — it never checks
   elapsed time vs `poll_interval_seconds` (600s). So PBR polls all fabrics ~10×
   more often than intended, and together with the ACI inventory poller keeps the
   big Jamnagar APIC saturated.
2. **Overload → 503 → silent skip.** Under that load the large-fabric fetch hits
   APIC 503; `_apic_get_with_retry` exhausts its retries and raises
   `PbrPartialFetchError`; `collect_pbr_for_job` returns `success=False` **without
   persisting**. In isolation (no contention) the same fetch succeeds.
3. **Failure is invisible.** `PbrPoller._tick` calls `collect_pbr_for_job` but
   **ignores its `success` flag** — it commits and breaks, so a persistently
   failing fabric shows as silently empty with nothing in the DB or logs.

## 4. Design
### 4a. Interval-gated polling (primary fix)
`PbrPoller` keeps an in-memory `self._last_polled: dict[str, datetime]`.
`_should_poll` returns `False` unless `now - last_polled >= poll_interval_seconds`
(first run after start polls immediately). The timestamp is recorded whenever a
poll is attempted (success **or** failure), so a failing fabric is retried on its
normal interval, not every tick. This cuts PBR's APIC load ~10× and removes the
overload that triggers the 503s. (In-memory, per the poll cadence — no schema
change; `job.last_polled_at` stays owned by the ACI poller.)

### 4b. Resilient fetch on big fabrics
Thread PBR-specific retry/backoff into `fetch_class` →
`_apic_get_with_retry`: `_PBR_FETCH_RETRIES = 6`, `_PBR_FETCH_BACKOFF = 3.0`
(exponential-ish backoff up to ~1 min total), keeping intra-fabric concurrency low
(`_PBR_FETCH_CONCURRENCY = 2`). Gives a transiently-busy APIC time to recover
instead of failing the whole fabric. (Shared `_apic_get_with_retry` in
telco_collector is left untouched; PBR passes higher values via existing params.)

### 4c. Surface collection failures
`_tick` captures the `PbrCollectionResult`; on `success=False` it logs a
`warning` naming the fabric + message, so a fabric that can't be collected is
visible rather than silently empty. (No cross-writing of the ACI poller's
`last_error`.)

## 5. Acceptance criteria
- With the interval gate, each ACI fabric is PBR-polled about every
  `poll_interval_seconds` (≈600s), not every tick.
- Jamnagar's PBR services persist and stay populated across poll cycles; a failed
  poll never overwrites good data (unchanged: failure = no persist).
- A persistently failing fabric emits a `warning` log naming it.
- Bangalore/Mumbai unaffected (still populated).

## 6. Test / verification
- Backend imports clean; poller logic unit-reasoned (interval math).
- Prod (post-deploy, read-only): watch that Jamnagar remains at 10 services and
  `pbr_services.updated_at` advances on its interval; confirm no fabric regresses.
- Manual: a one-shot `collect_pbr_for_job(Jamnagar)` already returned
  `success=True`, `service_count=10` (baseline).

## 7. Resolved decisions
- In-memory interval tracking (no new DB column); `poll_interval_seconds` reused.
- Don't modify the shared `_apic_get_with_retry` defaults (telco unaffected);
  PBR passes higher retry/backoff via params.
- Failure surfaced via logs only for now (no schema change); a per-fabric PBR
  status field is a possible future enhancement.

## 8. Rollout
- Code-only (no migration). Deploy via `deploy.sh`; poller is config-gated
  (`PBR_POLLER_ENABLED`). Backfill any empty large fabric with a one-shot collect
  after deploy if needed.
