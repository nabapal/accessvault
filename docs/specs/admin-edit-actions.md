# SDD: Edit action for Fabric Onboarding, IP-MPLS, NX-OS & CGNAT admin surfaces

- **Status:** Implemented — IP-MPLS, NX-OS, and CGNAT Edit shipped; Fabric onboarding per its commit
- **Owner:** naba
- **Date:** 2026-07-09 (updated 2026-07-15 to add CGNAT)
- **Module:** NetVerse AI → Admin (Inventory Admin, IP-MPLS Admin, NX-OS Admin, CGNAT Admin, Telco Fabric Onboarding)
- **Type:** Feature parity — add "Edit" where only VM collectors have it today

> **2026-07-15 addendum:** the CGNAT devices admin (`CgnatDevicesAdminPage`) was added after the
> original spec and initially shipped without Edit. It now has the same modal-based Edit (name,
> mgmt IP, vendor, role, username, password [blank=keep], HTTPS port, poll interval, verify-TLS)
> via `updateCgnatDevice` → `PATCH /cgnat/devices/{id}`, matching this spec. Same
> blank-password-keeps-secret and duplicate-mgmt_ip 409 guard semantics apply.

---

## 1. Summary

The VM-collector admin surface (`InventoryAdminPage`) lets an admin **edit** a registered
collector via a modal (pre-filled form → `PATCH /inventory/endpoints/{id}` → toast + list
refresh, with a blank password meaning "keep the current secret"). The three other
onboarding/admin surfaces expose only **Sync/Delete** (IP-MPLS, NX-OS) or **Validate/Delete**
(Fabric onboarding) — there is no way to change a registered item's name, address/host,
port, credentials, poll interval, tags, etc. without deleting and re-creating it.

This spec adds the same **Edit** capability to:
1. **IP-MPLS devices** (`IpMplsDevicesAdminPage`)
2. **NX-OS devices** (`NxosDevicesAdminPage`)
3. **Fabric onboarding jobs** (`TelcoOnboardingPage`)

mirroring the VM-collector edit UX and the `require_admin` PATCH pattern already used across
the API.

## 2. Motivation

- **Operational parity:** a typo in a hostname, a rotated credential, or a poll-interval
  tweak currently forces delete + re-create for IP-MPLS/NX-OS/fabric items — which for
  IP-MPLS/NX-OS destroys collected child rows (interfaces/VRFs/neighbors/etc.) and for
  fabric jobs discards validation history.
- **Consistency:** admins already know the collector Edit flow; the other three surfaces
  should behave identically.
- **Low risk / mostly wiring:** the backend already supports update for IP-MPLS and NX-OS;
  only the frontend is missing. Fabric onboarding needs one additive endpoint + schema.

## 3. Current state (as-built)

### 3.1 VM collectors — the template (fully implemented)
- **Backend:** `PATCH /inventory/endpoints/{id}` (`require_admin`); `UpdateInventoryEndpoint`
  payload; blank/absent `password` keeps the stored secret.
- **Frontend:** `updateInventoryEndpoint(id, payload)` in `services/inventory.ts`;
  `InventoryAdminPage` renders an **Edit** button per row that opens a `@headlessui/react`
  `Dialog`/`Transition` modal pre-filled from the row (`openEditEndpoint`), with
  `handleEditInputChange` / `handleUpdateEndpoint`, `toast.success/error`, and a list refresh.
  Password field placeholder: *"Leave blank to keep current secret"*; the handler deletes
  `password` from the payload when blank and coerces empty `description` to `null`.

### 3.2 IP-MPLS devices
- **Backend (exists):** `PATCH /ipmpls/devices/{device_id}` (`require_admin`) with
  `IpMplsDeviceUpdate` (all-optional: name, mgmt_ip, port, platform, role, description,
  poll_interval_seconds, connection_params, username, password, enable). Handler re-encrypts
  `password`/`enable` only when present; `password` empty → keep current.
- **Frontend (missing edit):** `services/ipmpls.ts` has fetch/create/delete/sync but **no
  update**. `IpMplsDevicesAdminPage` renders only **Sync** and **Delete** per row; no modal.

### 3.3 NX-OS devices
- **Backend (exists):** `PATCH /nxos/devices/{device_id}` (`require_admin`) with
  `NxosDeviceUpdate`, identical shape/semantics to IP-MPLS.
- **Frontend (missing edit):** `services/nxos.ts` has fetch/create/delete/sync but **no
  update**. `NxosDevicesAdminPage` renders only **Sync** and **Delete**; no modal.

### 3.4 Fabric onboarding (telco)
- **Backend (no update):** `telco.py` exposes GET (list/detail), `POST /telco/onboarding/jobs`
  (create, optional auto-validate), `POST /telco/onboarding/jobs/{id}/validate`, and
  `DELETE`. There is **no PATCH/PUT**. Model `TelcoFabricOnboardingJob` fields: name,
  fabric_type, target_host, port, username, password_secret, description, connection_params,
  verify_ssl, poll_interval_seconds, status, last_* validation/poll fields. Note: the
  `validate` endpoint already re-encrypts `password` when one is supplied.
- **Frontend (missing edit):** `services/telco.ts` has list/create/validate/delete but **no
  update**. `TelcoOnboardingPage` renders **Validate** and **Delete** per job; no edit modal.

## 4. Goals / Non-goals

**Goals**
- An admin-only **Edit** button on each row of the IP-MPLS, NX-OS, and Fabric onboarding
  admin tables, opening a pre-filled modal that PATCHes the item and refreshes the list.
- **Fabric onboarding:** add `PATCH /telco/onboarding/jobs/{id}` + `TelcoOnboardingJobUpdate`
  schema (additive, `require_admin`).
- **IP-MPLS / NX-OS:** add the frontend `update*Device` service call + edit modal; reuse the
  existing backend PATCH.
- Preserve the **blank-password-keeps-secret** rule and **secrets-never-returned** invariant.
- Match the collector modal's look/feel (headless-UI `Dialog`, same field styling, toasts).

**Non-goals**
- No change to Create/Delete/Sync/Validate flows or to the pollers themselves.
- No new editable fields beyond what each Create form already accepts (no schema/data-model
  expansion for IP-MPLS/NX-OS).
- Fabric edit does **not** auto-revalidate or auto-poll (see §5.4 / §11).
- No bulk edit, no inline (non-modal) editing.
- No changes to the CLI onboarding importer scripts.

## 5. Design (per `docs/DEVELOPMENT.md` order)

### 5.1 Backend — Fabric onboarding update (only new backend work)
`backend/app/schemas/telco.py`: add
```python
class TelcoOnboardingJobUpdate(BaseModel):
    name: Optional[str] = None
    fabric_type: Optional[TelcoFabricType] = None
    target_host: Optional[str] = None
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    username: Optional[str] = None
    verify_ssl: Optional[bool] = None
    description: Optional[str] = None
    connection_params: Optional[Dict[str, Any]] = None
    poll_interval_seconds: Optional[int] = Field(default=None, ge=60, le=86400)
    password: Optional[str] = None  # blank/omitted → keep current secret
```
`backend/app/routers/telco.py`: add
```python
@router.patch("/onboarding/jobs/{job_id}", response_model=TelcoOnboardingJobRead)
async def update_onboarding_job(job_id, payload: TelcoOnboardingJobUpdate, db, _: require_admin):
    # 404 if missing (reuse existing lookup)
    data = payload.model_dump(exclude_unset=True)
    if "password" in data:
        password = data.pop("password")
        if password:
            job.password_secret = encrypt_secret(password)
    # trim strings (name/target_host/username/description) like create does
    for key, value in data.items():
        setattr(job, key, value)
    await db.commit(); await db.refresh(job)
    return TelcoOnboardingJobRead.model_validate(job)
```
- Export `TelcoOnboardingJobUpdate` from `app/schemas/__init__.py`.
- **Status left unchanged** on edit (editing config does not re-validate; existing
  `status`/`last_snapshot` are preserved). See §5.4.
- No migration — no model change. IP-MPLS and NX-OS need **no backend change** (PATCH +
  `*DeviceUpdate` already present).

### 5.2 Backend — duplicate-key guard (small hardening, all three device/job types)
The IP-MPLS/NX-OS `create` handlers reject a duplicate `mgmt_ip` (409) but `update` does
**not** re-check when `mgmt_ip` changes; a collision would surface as a DB `IntegrityError`
(→ 500) at commit. Add the same "another row already uses this mgmt_ip" 409 guard to
`update_device` in `ipmpls.py` and `nxos.py` (check `id != device_id`). Fabric jobs have no
unique business key, so no guard needed there. *(Small, but keeps Edit from 500-ing on a
duplicate.)*

### 5.3 Frontend — services
- `services/ipmpls.ts`: add
  ```ts
  export interface IpMplsDeviceUpdate extends Partial<IpMplsDeviceCreate> {}
  export const updateIpMplsDevice = (id, payload: IpMplsDeviceUpdate) =>
    api.patch<IpMplsDevice>(`/ipmpls/devices/${id}`, payload).then(r => r.data);
  ```
- `services/nxos.ts`: add `NxosDeviceUpdate` + `updateNxosDevice` (same shape, `/nxos/...`).
- `services/telco.ts`: add
  ```ts
  export type TelcoOnboardingJobUpdatePayload = Partial<Omit<TelcoOnboardingJobPayload, "auto_validate">>;
  export const updateTelcoOnboardingJob = (id, payload) =>
    api.patch<TelcoOnboardingJob>(`/telco/onboarding/jobs/${id}`, payload).then(r => r.data);
  ```

### 5.4 Frontend — Edit modal (each of the three admin pages)
Mirror `InventoryAdminPage`'s modal implementation on each page:
- **State:** `editing<Item>`, `editForm`, per-page `editTagsInput` only if that entity has
  tags (VM collectors do; IP-MPLS/NX-OS/telco currently have none — omit tags), and
  `isUpdating` / `updateError`.
- **Open:** an **Edit** button per row (placed left of Sync/Delete/Validate) → `openEdit()`
  pre-fills `editForm` from the row, `password: ""`.
- **Form fields** = that entity's Create fields (reuse the create form's field list/labels):
  - IP-MPLS/NX-OS: name, mgmt_ip, port, platform (select), role, poll_interval_seconds,
    username, password (blank = keep), enable (blank = keep), description. *(connection_params
    only if the create form exposes it.)*
  - Fabric: name, fabric_type (select), target_host, port, username, verify_ssl (checkbox),
    poll_interval_seconds, password (blank = keep), description.
- **Submit:** delete `password` (and `enable`) from payload when blank; coerce empty
  `description` to `null`/omit; call the `update*` service; on success `toast.success`, close
  modal, reload the list; on failure show `updateError` + `toast.error`.
- **Modal chrome:** `@headlessui/react` `Dialog`/`Transition.Root` copied from the collector
  page (already a project dependency and used there).
- **Fabric revalidation cue:** because editing does not re-validate, when the edited fabric
  job's connection-affecting fields (target_host/port/username/password/verify_ssl) change,
  show a hint in the modal/toast: *"Run Validate to test the new settings."* (The poller will
  pick up a changed `poll_interval_seconds` on its next tick regardless.)

### 5.5 Access control
All three PATCH routes use `require_admin` (as create/delete already do). The pages already
gate admin tooling (`isAdmin` from the auth store); the Edit button follows the same gate.

### 5.6 MCP / OpenAPI
The new `PATCH /telco/onboarding/jobs/{id}` appears in `/openapi.json` automatically; the
IP-MPLS/NX-OS PATCH routes are already published. Add the telco update tool to the MCP spec
when shipped (read/write parity with the device modules).

## 6. Acceptance criteria

1. On **IP-MPLS Admin**, **NX-OS Admin**, and **Fabric Onboarding** pages, each row shows an
   **Edit** button (admin only) alongside the existing actions.
2. Clicking **Edit** opens a modal pre-filled with the item's current values; the password
   field is empty and labelled "leave blank to keep current secret".
3. Saving with no password change updates the other fields and **keeps the stored secret**;
   saving with a new password re-encrypts it. Secrets are never shown or returned.
4. After save: the modal closes, a success toast fires, and the list reflects the new values.
5. IP-MPLS/NX-OS: changing `mgmt_ip` to one already in use returns a **409** with a clear
   message (no 500), surfaced as the modal error.
6. Fabric: `PATCH /telco/onboarding/jobs/{id}` updates the job; editing does not change
   `status` or clear `last_snapshot`; a hint prompts re-validation when connection fields
   changed.
7. Non-admins cannot see the Edit button and receive 403 from the PATCH endpoints.
8. `npx tsc --noEmit` and `npm run build` pass; backend tests pass.

## 7. Test plan

- **Backend (pytest + httpx):**
  - New telco: PATCH updates fields; blank password keeps secret; new password re-encrypts;
    non-admin → 403; missing id → 404; `status`/`last_snapshot` unchanged by edit.
  - IP-MPLS/NX-OS: PATCH duplicate `mgmt_ip` → 409 (regression for the new guard); blank
    password keeps secret; `GET` after PATCH shows updates and no secret fields.
- **Frontend:** `npx tsc --noEmit` + `npm run build`; manual: open each admin page, edit a
  row (change name + poll interval, leave password blank → verify kept; then set a new
  password), confirm toast + refreshed row; verify the fabric "revalidate" hint appears.
- **Verify (live):** edit a real IP-MPLS/NX-OS device's poll interval and confirm the poller
  honors it on the next tick; edit a fabric job's target_host then click Validate.

## 8. Phase 0 — discovery (do first)

1. Confirm the existing IP-MPLS/NX-OS PATCH accepts an empty-string `password` as
   "keep current" from the UI payload shape (it does per the handler; verify with one curl).
2. Confirm `TelcoOnboardingPage`'s create form field set (to reuse labels/inputs verbatim in
   the edit modal) and whether it exposes `connection_params` (mirror only what create shows).
3. Confirm `@headlessui/react` Dialog usage on IP-MPLS/NX-OS pages is new (they have no modal
   today) and copy the collector modal wholesale.

## 9. Edge cases

- **Blank password:** must be stripped from the payload so the stored secret is preserved
  (all three).
- **Duplicate mgmt_ip on update** (IP-MPLS/NX-OS): 409, not 500 (§5.2).
- **fabric_type change** on a fabric job: allowed by schema; the next Validate/poll uses the
  new collector path — surface the revalidation hint.
- **Editing while a Sync/Validate is in-flight:** disable the row's Edit button (or the
  modal Save) during that row's async action, matching how Sync is disabled today.
- **Empty `description`:** coerce to `null`/omit (consistent with collector edit).
- **Secrets in `connection_params`:** if the create form allows arbitrary
  `connection_params`, do not echo any secret-like values; treat as pass-through JSON only.
- **poll_interval bounds:** respect schema bounds (telco 60–86400; keep IP-MPLS/NX-OS
  consistent with their create validation).

## 10. Rollout

- Additive and low-risk: one new backend endpoint (telco) + a small update-guard on two
  existing endpoints; frontend service functions + a modal per page.
- Order (playbook): telco schema → telco router (+ guards on ipmpls/nxos) → tests →
  frontend services → per-page modals → `tsc`/build → live verify → commit per step.
- No migration, no data-model change, no poller change. VM-collector flow untouched.

## 11. Resolved decisions

- **Edit is a modal (not inline), reusing the collector pattern.** Confirmed — matches the
  surface the user pointed at ("edit option available in VM collectors").
- **Fabric edit does not auto-revalidate.** Editing persists configuration only; the admin
  runs the existing **Validate** action to test new settings. *Alternative considered:*
  auto-validate on edit (like create's `auto_validate`) — rejected as surprising and slow;
  a hint nudges the user instead.
- **Reuse existing backend PATCH for IP-MPLS/NX-OS.** No new endpoints there; only add the
  duplicate-`mgmt_ip` guard so Edit can't 500.
- **No new editable fields.** Edit exposes exactly the entity's Create fields to avoid
  schema/data-model drift.
