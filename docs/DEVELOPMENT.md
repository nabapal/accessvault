# InfraPulse — Development Playbook

This is the standard workflow for adding a feature (especially a new inventory
domain) so that **every feature automatically exposes its data through the REST
API → OpenAPI/Swagger → and is ready for the MCP server**. Follow it and the
API surface, docs, and MCP-readiness stay consistent for free.

> Golden rule: **all data the portal shows must be reachable via an authenticated
> JSON endpoint.** The UI is a client of the same API an MCP server will use.

---

## API docs (Swagger / OpenAPI)

FastAPI auto-generates these — no manual upkeep:

| Surface | URL |
|---|---|
| Swagger UI | `/docs` |
| ReDoc | `/redoc` |
| OpenAPI schema | `/openapi.json` |

- **Dev** (`./dev.sh`, uvicorn): `http://localhost:8200/docs`.
- **Prod** (nginx): `/docs`, `/redoc`, `/openapi.json` are proxied to the backend
  (see `deployments/nginx.conf`) — reachable at `http://<host>/docs`.

Any router registered in `app/api/api_v1.py` appears in Swagger automatically.

---

## Architecture patterns (pick the closest one)

- **Per-device / per-endpoint registration + background poller** — ESXi/vCenter
  (`InventoryEndpoint` + `InventoryPoller`), IP-MPLS (`IpMplsDevice` +
  `IpMplsPoller`). Use for things you log into individually.
- **Fabric onboarding job + poller** — ACI/NX-OS (`TelcoFabricOnboardingJob` +
  `TelcoFabricPoller`). Use for controller-fronted fabrics.
- **Collector in a worker thread** — blocking client libs (pyVmomi, Netmiko,
  Genie) run via `asyncio.to_thread`; parse, then upsert.

Cross-cutting conventions already in place — reuse them:
- **Encrypted credentials:** `app/services/crypto.py` (`encrypt_secret` /
  `decrypt_secret`); never return secrets in API responses.
- **Nautobot enrichment:** `app/services/nautobot.py` for role/site/rack.
- **Resilient pollers:** tick-guarded loop + per-item isolation (see
  `InventoryPoller` / `IpMplsPoller`) so one failure never kills the loop.
- **Timestamps:** store **UTC**; the frontend renders **IST** via
  `parseApiDate()` + `timeZone: "Asia/Kolkata"`.
- **Refresh semantics:** replace-per-poll or delete-not-seen so deletions and
  updates on the source reflect in the portal.

---

## Checklist: add a new inventory feature

### Backend
1. **Model** — `app/models/<domain>.py`; register in `app/models/__init__.py`.
2. **Migration** — `backend/migrations/versions/<date>_<name>.py`; set
   `down_revision` to the current head. Migrations auto-apply on startup.
3. **Collector** — `app/services/<domain>_collector.py`: connect (in a thread),
   parse, normalize, upsert with delete-not-seen / replace-per-item.
4. **Poller** (if scheduled) — mirror the resilient poller; wire into
   `app/main.py` lifespan behind a `*_POLLER_ENABLED` setting in
   `app/core/config.py`.
5. **Schemas** — `app/schemas/<domain>.py` (`Config.from_attributes = True`);
   export from `app/schemas/__init__.py`.
6. **Router** — `app/routers/<domain>.py` with `get_current_user` (reads) /
   `require_admin` (writes). **Register in `app/routers/__init__.py` and
   `app/api/api_v1.py`.** Provide: list (paginated + `search`), detail, and any
   child collections; plus admin CRUD + a "sync now" if applicable.

### Frontend
7. **Types** — `frontend/src/types/index.ts`.
8. **Service** — `frontend/src/services/<domain>.ts` (uses shared `api` client;
   401 auto-logout is already handled centrally).
9. **Pages + routes** — page(s) under `frontend/src/pages/`, routes in
   `frontend/src/App.tsx`, nav entries in
   `frontend/src/components/layout/AppShell.tsx`.
10. **Dense detail pages:** use the compact **KPI header + tabs** pattern
    (see `IpMplsDeviceDetailPage`); paginate large tables, filter where useful.

### Verify & ship
11. **Verify against real data** (this repo can't fully boot on system Python —
    use a Python 3.11/3.12 venv; see `memory` note). Import `app.main`, run
    `run_migrations()`, exercise the collector against a live source, and hit the
    new endpoints. Frontend: `npx tsc --noEmit` and `npm run build`.
12. **Commit per logical step**, push to `master` (deploy reads from there).

---

## Endpoint conventions (keep these uniform for MCP mapping)

- **Auth:** `POST /auth/login` (form `username`+`password`) → `{access_token}`;
  send `Authorization: Bearer <token>`; token ~30 min, re-login on 401.
- **List endpoints:** support `search` and pagination
  (`page`, `page_size`, returning `{items,total,page,page_size,has_next,has_prev}`).
- **Filters:** expose obvious dimensions as query params (role, platform,
  protocol, fabric…).
- **Detail + children:** `/<domain>/<id>` and `/<domain>/<id>/<children>`.
- **Summary:** a `/<domain>/summary` rollup where it helps dashboards.

Because the UI already consumes these, an MCP tool maps 1:1 to an endpoint.

---

## MCP server (generated last)

The MCP server is a **read client of this same API** — it does not need `/docs`,
it calls `/api/v1/...`. Once the feature set is complete, generate the MCP build
prompt from the current endpoint list (`/openapi.json`): one tool per
list/detail/summary endpoint, auth = login→bearer with 401 re-login, read-only.
Keeping the endpoint conventions above uniform means new features slot into the
MCP prompt with no special-casing.

Prereqs for the MCP: a **read-only service account** (`python -m
app.scripts.create_admin`) and `INFRAPULSE_URL` pointing at the backend
(`http://<host>:8200` dev, or the prod URL).
