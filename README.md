# NetVerse AI

> **Unified Infrastructure Intelligence for AI**

NetVerse AI is a secure infrastructure operations portal for multinational teams. It combines credential management and remote access (AccessVault) with live inventory across VMware, Cisco ACI, and Cisco IP-MPLS networks.

## Modules
- **AccessVault** — credential vault, group/system management, browser SSH terminal, GUI quick-launch.
- **VM Inventory (VMware)** — live ESXi/vCenter host, VM, datastore, and network telemetry via pyVmomi; overview dashboard + VM Center workspace.
- **Cisco ACI** — fabric node inventory (leaf/spine/controller), interface EPG/L3Out bindings, cross-fabric endpoint directory (MAC/IP), VLAN inventory, and free-ports report.
- **IP-MPLS Inventory** — Cisco IOS-XR/XE device onboarding (by Nautobot role), interface/VRF/neighbor/hardware collection via Netmiko + pyATS/Genie, and an interactive ISIS topology (Cytoscape) with role/location filters and fullscreen.
- **NX-OS Inventory** — Cisco Nexus onboarding by Nautobot role (`Nexus`/`ToR`), interface/VRF/BGP/hardware collection via Netmiko + pyATS/Genie, and a CDP+LLDP topology.
- **CGNAT Inventory** — A10 Thunder (aXAPI) and F5 BIG-IP (iControl REST) CGNAT gateways: NAT/LSN pools, IP interfaces, static routes, and health metrics (sessions, translations, port utilization, exhaustion). Manual onboarding.

## Features
- JWT authentication with role-based access control (admin, user)
- AES/Fernet encryption for stored credentials; secrets never returned in API responses
- Browser-based SSH terminal (xterm.js + Paramiko over WebSocket)
- Resilient background pollers (per-item isolation) for VMware, ACI, and IP-MPLS
- Nautobot enrichment (role/site/rack) for ACI nodes and IP-MPLS devices
- UTC storage rendered as **IST** in the UI
- Auto-logout on session expiry (401 interceptor)
- React dashboard with modals, filters, and responsive layout
- Automated API tests with pytest + httpx

## Project Structure
```
backend/    # FastAPI application
frontend/   # React + Vite + Tailwind SPA
docs/       # Development playbook and design notes
```

## API Documentation
FastAPI auto-generates interactive docs from the code — every registered router
appears automatically:

| Surface | URL |
| --- | --- |
| Swagger UI | `/docs` |
| ReDoc | `/redoc` |
| OpenAPI schema | `/openapi.json` |

Dev: `http://localhost:8200/docs`. Production: proxied through Nginx at
`http://<host>/docs` (see `deployments/nginx.conf`). All portal data is exposed
through authenticated JSON endpoints under `/api/v1`, which is what any MCP
server / integration should consume.

## Contributing / Adding Features
See **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** for the standard feature
workflow (model → migration → collector → schema → router → frontend → verify).
Following it keeps the REST API, Swagger docs, and MCP-readiness consistent as
new inventory domains are added.

## AccessVault Backend Setup
1. Create and activate a Python 3.11+ virtual environment.
2. Install dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Configure environment variables based on `backend/.env.example`:
   ```bash
   cp backend/.env.example backend/.env
   # Generate secrets
   python -c "import secrets; print(secrets.token_urlsafe(32))"  # SECRET_KEY
   python -c "import secrets; print(secrets.token_hex(16))"      # PASSWORD_SALT
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # FERNET_KEY
   ```
   Optional: populate `NAUTOBOT_BASE_URL` and `NAUTOBOT_TOKEN` to enable site/rack enrichment from Nautobot.
4. Run database migrations:
   ```bash
   cd backend
   alembic upgrade head
   ```
   The FastAPI app will also apply pending migrations at startup, but running them explicitly keeps your local environment consistent. Configure `DATABASE_URL` for PostgreSQL deployments as needed.
5. Create an initial admin user:
   ```bash
   cd backend
   python -m app.scripts.create_admin
   ```
6. Start the API server:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8200
   ```

## Frontend Setup
1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
   The app will proxy API and WebSocket requests to `http://localhost:8200`.

> **Tip:** `./dev.sh` launches both FastAPI and Vite dev servers and writes logs to `logs/backend.log` and `logs/frontend.log`.

### Inventory UI Overview
- `/inventory`: live dashboard with KPI tiles, collector health list, and events & alerts feed.
- `/inventory/admin`: step-by-step onboarding wizard with validation history, draft save/clear, and filterable collector registry.
- `/inventory/virtual-machines`: VM Center view with summary metrics, advanced filters, and detail side panel for selected workloads.

## Production Deployment (Docker)
1. Copy the Docker environment template and fill in secure values:
   ```bash
   cp backend/.env.docker.example backend/.env.docker
   ```
   Ensure `DATABASE_URL` remains `sqlite+aiosqlite:///./data/accessvault.db` so the SQLite file lives in the host-mounted volume.
2. Create a persistent data directory on the host:
   ```bash
   mkdir -p data
   ```
3. Build and start the containers:
   ```bash
   ./deployments/deploy.sh
   ```
   The helper script will prompt for admin credentials, build the images, start the stack, and seed the initial admin user.
      - Backend (FastAPI + Uvicorn) listens on `http://localhost:8005` and stores `data/accessvault.db` on the host.
   - Frontend is served via Nginx on `http://localhost/` with API/WebSocket traffic proxied to the backend.
4. Tail logs or stop the stack as needed:
   ```bash
   docker compose logs -f
   docker compose down
   ```

> **Note:** If you deploy behind a custom domain, update `CORS_ORIGINS` in `backend/.env.docker` accordingly.

## VM Inventory Module
- Register ESXi or vCenter collection endpoints through `/api/v1/inventory/endpoints`
- Credentials are stored encrypted using the shared Fernet secret; passwords are never returned in responses
- Responses include polling metadata (`last_polled_at`, `last_poll_status`) for the NetVerse AI dashboard
- Background poller (enabled by default) collects live host/VM/datastore/network telemetry via pyVmomi; toggle via `INVENTORY_POLLER_ENABLED`

### REST Endpoints
| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/v1/inventory/endpoints` | List all registered collectors (authenticated users) |
| POST | `/api/v1/inventory/endpoints` | Create a new collector endpoint (admin only) |
| GET | `/api/v1/inventory/endpoints/{id}` | Retrieve collector details (authenticated users) |
| PATCH | `/api/v1/inventory/endpoints/{id}` | Update collector settings and credentials (admin only) |
| DELETE | `/api/v1/inventory/endpoints/{id}` | Remove a collector (admin only) |
| GET | `/api/v1/inventory/hosts` | Fetch aggregated host telemetry with optional `endpoint_id` filter |
| GET | `/api/v1/inventory/virtual-machines` | Fetch VM inventory with optional `endpoint_id`/`host_id` filters |

## Onboarding IP-MPLS Devices

IP-MPLS devices (Cisco IOS-XE/XR) are bulk-imported from Nautobot **by role** using
`backend/scripts/import_ipmpls_devices.py`. For every Nautobot device whose role matches
and that has a primary management IP, it upserts an `ip_mpls_devices` row (keyed by mgmt IP),
pre-populating role / site / rack from Nautobot. Devices without a primary IP are skipped.

Credentials and Nautobot access default from the environment (`NET_USERNAME` /
`NET_PASSWORD` / `NET_ENABLE`, `NAUTOBOT_BASE_URL` / `NAUTOBOT_TOKEN`); override with flags.

**Local / dev** (from `backend/`, venv active):
```bash
python scripts/import_ipmpls_devices.py --role SAR --role AG2 --role AG3 --dry-run   # preview
python scripts/import_ipmpls_devices.py --role SAR --role AG2 --role AG3             # import
python scripts/import_ipmpls_devices.py --role SAR --collect                        # import + SSH-collect now
```

**Prepod / Prod (Docker)** — run inside the backend container from the repo root
(`/opt/accessvault`) so it writes to the same DB (`/app/data/accessvault.db`, the mounted
`./data` volume):
```bash
cd /opt/accessvault
docker compose exec backend python backend/scripts/import_ipmpls_devices.py \
  --role SAR --role AG2 --role AG3 --dry-run          # preview
docker compose exec backend python backend/scripts/import_ipmpls_devices.py \
  --role SAR --role AG2 --role AG3 [--collect]        # import (add --collect to SSH-collect now)
```

Only **Active** devices are imported by default (Decommissioned/Offline are skipped).

Options: `--role` (repeatable), `--status` (Nautobot status slug, default `active`; pass
empty `''` for all), `--collect` (SSH-collect reachable devices immediately; otherwise the
background poller picks them up), `--dry-run`, `--username` / `--password` / `--enable`,
`--nautobot-url` / `--nautobot-token`, `--poll-interval` (seconds, default 900).

> Tables are created by migrations at container startup, so no migration step is needed.
> If Docker requires `sudo` on the host, prefix the command; use `docker-compose` (hyphen)
> on older hosts.

## Testing
```bash
cd backend
pytest
```

## Operational Notes
- GUI quick-launch injects credentials only for services that support HTTP Basic Auth URLs. Custom automation may be required for other login methods.
- Web-based SSH relies on Paramiko. Ensure target systems accept the provided credentials and that the API host can reach them.
- Rotate the Fernet key only after re-encrypting stored secrets.

## Next Steps
- Harden GUI automation pathways (e.g., per-application scripts via Playwright).
- Extend audit logging and session tracking.
- Add end-to-end tests for the React frontend.

## Release Notes

### 2026-07-15 — CGNAT module

- **New module: CGNAT Inventory** (`/cgnat/*`) — A10 Thunder (aXAPI v3) and F5 BIG-IP
  (iControl REST) gateways onboarded manually. Collects device facts, **IP interfaces**
  (A10 `ve` SVIs, F5 self-IPs), **NAT/LSN pools**, **static routes** (A10 ip/ipv6 route rib,
  F5 net/route), and health metrics (active sessions/subscribers, translations, port
  utilization, pool exhaustion; F5 virtual-server count). Pages: Summary, Devices, Device
  detail (Overview / NAT Pools / Interfaces / Static Routes), Admin (register/sync/test/delete).
- **NX-OS & IP-MPLS admin:** per-device **Edit** and **Test-connectivity** actions.

### 2026-07-06 — NetVerse AI

**Rebrand**
- Product rebranded **InfraPulse → NetVerse AI** — "Unified Infrastructure Intelligence for AI",
  new connected-node logo mark. AccessVault remains the credential-vault module; internal
  package/DB identifiers are unchanged.

**New module: Cisco NX-OS (Nexus) Inventory** (`/nxos/*`)
- Per-device onboarding by Nautobot role (`Nexus`, `ToR`) over SSH with pyATS/Genie parsing;
  resilient background poller; collects interfaces, VRFs, hardware/modules, and BGP neighbors
  (all VRFs, IPv4/IPv6) via `show bgp vrf all all summary`.
- **Topology from CDP + LLDP** (merged and de-duplicated per device pair, showing which
  protocol(s) discovered each link) rendered with Cytoscape.
- Pages: Summary, Devices, Device detail (Overview/Interfaces/VRFs/Neighbors/BGP/Hardware),
  Topology, and Admin.

**Cisco ACI — L3Out VLANs**
- The VLAN inventory now includes **L3Out SVI encap VLANs** alongside Bridge-Domain VLANs in the
  same table (`Bridge Domain` column → **Bridge Domain / L3OUT**, with a BD/L3Out badge and the
  external EPG for L3Out rows).

**IP-MPLS**
- New **fleet Summary dashboard**: scale/health KPIs (interfaces, VRFs unique vs instances,
  neighbors, MPLS-enabled, error/stale devices) plus breakdowns by location/role/platform/
  model/OS and gauges/donuts.
- Device search now also matches platform, status, and OS version; onboarding imports **Active
  devices only** by default (`--status` flag to override).

**Device admin (IP-MPLS & NX-OS)**
- Admin pages gained **Edit** and **Test-connectivity** actions per device (matching the VM
  collector admin), alongside register / sync / delete.

**UI/UX polish**
- Sidebar nav icons; reusable loading **skeletons**, designed **empty states**, and action
  **toasts**; upgraded KPI **stat tiles**; dependency-free **donut/gauge charts** on summaries;
  a consistent **PageHeader**; keyboard focus rings.

**Reliability & fixes**
- ACI collector now **bounds APIC query concurrency + retries** — large fabrics (e.g. Jamnagar,
  130+ nodes) previously returned 503s that silently dropped interface oper-state, breaking the
  free-ports report and L3Out VLANs.
- `dev.sh` frees ports 8200/5173 on startup (fixes "stuck on sign-in" from an orphaned backend);
  reliable topology link-click; ACI endpoint search matches IP addresses.

**Docs & process**
- Adopted spec-driven development — feature specs under `docs/specs/`; IP-MPLS onboarding
  documented in the README.

### 2026-07
- **IP-MPLS Inventory:** Cisco IOS-XR/XE onboarding by Nautobot role; interface/VRF/ISIS-LDP-BGP neighbor/hardware collection via Netmiko + pyATS/Genie; interactive ISIS topology (Cytoscape) with role/location grouping, filters, fullscreen (Esc), and link detail.
- **Cisco ACI:** Cross-fabric endpoint directory (locally-attached MAC/IP, tunnel-learned excluded) with search across MAC/IP/tenant/EPG/BD/VRF; per-fabric VLAN inventory and free-ports report.
- **Platform:** Timestamps rendered in IST; auto-logout on 401; Swagger/ReDoc/OpenAPI proxied in production (see `deployments/nginx.conf`); feature-development playbook added (`docs/DEVELOPMENT.md`).

### 2025-11-03
- **ACI Interface Bindings:** Collector now ingests `fvRsPathAtt` and `l3extRsPathL3OutAtt` data, exposing EPG and L3Out bindings on each node interface in the UI and API.
- **Inventory Dashboard:** Replaced the delayed-heartbeat KPI with controller node counts and refreshed filtering text to highlight policy bindings.
- **Schema & API:** Added JSON columns for `epg_bindings`/`l3out_bindings`, updated Pydantic responses, and extended tests to cover the new payload shape.
