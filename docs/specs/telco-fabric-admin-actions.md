# Telco Fabric Onboarding — admin action parity (Edit / Test / Sync / Delete)

- **Feature:** Bring the ACI/NX-OS **Fabric Onboarding** admin tab to parity with the
  other admin tabs (CGNAT / NX-OS / IP-MPLS): **Edit, Test connection, Sync now,
  Delete**. Today it only exposes **Validate** and **Remove**.
- **Status:** Approved — Phase 0 probed; open decisions resolved with the user.
- **Module:** Telco Fabric Onboarding (`/api/v1/telco`, `app/routers/telco.py`,
  `app/services/telco_collector.py`, `frontend/src/pages/TelcoOnboardingPage.tsx`)
- **Date:** 2026-08-05

## 1. Summary
The Fabric Onboarding tab lists onboarded ACI/NX-OS fabrics but only offers
**Validate** (which quietly runs a *full* base-inventory collection) and **Remove**.
Every other admin tab offers the standard four actions. This adds **Edit**
(update fabric settings without re-onboarding), a lightweight **Test connection**
(auth/reachability only, nothing persisted), **Sync now** (a true full refresh),
and renames the destructive action to **Delete** — matching the rest of the portal.

## 2. Motivation
- Consistency: users expect the same Edit/Delete/Test/Sync controls everywhere.
- No way today to change a fabric's host, port, poll interval, or rotate its
  password without deleting and re-onboarding (which drops history).
- No fast connectivity check — the only probe is a full collection via Validate.
- **Sync gap (confirmed):** an ACI fabric has **two independent collectors** — the
  base **telco** inventory poller (`run_collection_for_job`) and the **PBR** poller
  (`collect_pbr_for_job`). Validate only runs the base inventory, so PBR never
  refreshes on demand. Users reasonably expect "Sync now" to refresh *everything*.

## 3. Phase 0 (live/code probe)
- `app/routers/telco.py` exposes: list, create, get, `POST …/validate`,
  `DELETE …/{id}`. No update, no test, no sync.
- `run_collection_for_job(session, job, password_override)` dispatches by
  `fabric_type` → `_collect_aci_fabric` (APIC `POST /api/aaaLogin.json` then class
  GETs) or `_collect_nxos_fabric` (NX-API `POST /ins`, HTTP basic auth). PBR is a
  **separate** collector/poller (`app/services/pbr_collector.py`).
- Frontend `TelcoOnboardingPage.tsx` renders only **Validate** + **Remove**;
  `services/telco.ts` has list/create/validate/delete. The CGNAT/NX-OS admin pages
  use an inline edit form + `actingId` busy state + feedback banners (no shared
  Modal component) — this feature mirrors that pattern.

## 4. Resolved decisions (with user)
- **Sync now = FULL:** runs the base inventory collector **and**, for ACI fabrics,
  the PBR collector — one click refreshes everything for that fabric. (NX-OS: base
  collector only; no PBR.) Sync also updates onboarding status like Validate did.
- **Test connection = lightweight probe:** performs only the vendor auth handshake
  (APIC `aaaLogin` / NX-API login) and returns success + latency; **persists
  nothing** and does not change onboarding status.

## 5. Design
### 5a. Backend — schemas (`app/schemas/telco.py`)
- `TelcoOnboardingJobUpdate` — all fields optional (`name`, `target_host`, `port`,
  `username`, `verify_ssl`, `description`, `connection_params`,
  `poll_interval_seconds`, and optional `password` to rotate the stored credential;
  blank/omitted password keeps the existing secret).
- `TelcoConnectivityResult` — `{ success: bool, message: str, latency_ms: float | None,
  checked_at: datetime }`.
- `TelcoSyncResult` — `{ success: bool, message: str, snapshot: dict | None,
  pbr_service_count: int | None, job: TelcoOnboardingJobRead }`.

### 5b. Backend — collector (`app/services/telco_collector.py`)
- `test_connection_for_job(job, password_override) -> TelcoConnectivityProbe` —
  ACI: `POST /api/aaaLogin.json`, success iff a token is returned. NX-OS: NX-API
  login/simple call. Times the round trip; no DB writes. Reuses `_build_base_url`
  and the existing auth payloads. SSH transport → "not supported yet" failure.

### 5c. Backend — router (`app/routers/telco.py`), all `require_admin`
- `PATCH /onboarding/jobs/{job_id}` — apply provided fields; if `password` given,
  `encrypt_secret` and replace `password_secret`; commit; return job.
- `POST /onboarding/jobs/{job_id}/test` — call `test_connection_for_job`; return
  `TelcoConnectivityResult` (no persistence).
- `POST /onboarding/jobs/{job_id}/sync` — `start_validation()`, run
  `run_collection_for_job`; on success `mark_validation_success`, set
  `last_snapshot` + `last_polled_at`; if `fabric_type == ACI` also run
  `collect_pbr_for_job` and report `pbr_service_count`; on base failure
  `mark_validation_failure`. Return `TelcoSyncResult`. (`validate` retained for
  back-compat / auto-validate on create.)

### 5d. Frontend
- `services/telco.ts` — `updateTelcoOnboardingJob` (PATCH),
  `testTelcoOnboardingJob` (POST test), `syncTelcoOnboardingJob` (POST sync) + result
  types; `types/index.ts` gets the two result interfaces.
- `TelcoOnboardingPage.tsx` — replace the two buttons with **Edit · Test · Sync now
  · Delete**; add an inline edit form (pre-filled; password field labelled "leave
  blank to keep"); `actingId` busy state; surface test latency and sync result
  (nodes + PBR service count) in the existing feedback banner; Delete confirms.

## 6. Acceptance criteria
- Fabric Onboarding rows show Edit / Test connection / Sync now / Delete.
- **Edit** changes settings (and optionally rotates the password) without
  re-onboarding; poll interval change takes effect on the next tick.
- **Test connection** returns quickly with success + latency (or a clear error) and
  writes nothing to the DB / leaves onboarding status unchanged.
- **Sync now** on an ACI fabric refreshes base inventory **and** PBR in one action
  and reports both counts; on NX-OS it refreshes base inventory.
- **Delete** removes the job (unchanged behaviour, relabelled).

## 7. Test / verification
- `npx tsc --noEmit` + `npm run build` pass; backend imports clean; single Alembic
  head (no schema change — none needed).
- Live (read-only creds already stored): Test against a known-good APIC returns
  success+latency; against a bad port returns failure. Sync on an ACI fabric bumps
  both the inventory snapshot and PBR `stale_as_of`.

## 8. Edge cases
- Missing stored credentials → Test/Sync return a clear "credentials missing" error.
- NX-OS + SSH transport → Test returns "not supported yet" (matches collector).
- Sync where base inventory succeeds but PBR fails → report partial success
  (inventory ok, PBR message surfaced); never overwrite good PBR data on failure.
- Edit with blank password → keep existing secret (never blanks the credential).

## 9. Rollout
- **Code-only, no migration.** Ships behind existing admin RBAC; pollers unchanged.
- Deploy via `deploy.sh`. Roll into the next release (0.4.0).
