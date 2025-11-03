# InfraPulse

InfraPulse is a secure infrastructure operations portal for multinational teams. The first module, AccessVault, delivers credential management and remote access automation. Upcoming expansions introduce live ESXi inventory and wider data center observability.

## Features
- JWT authentication with role-based access control (admin, user)
- Group and system management with search and filtering (AccessVault module)
- AES/Fernet encryption for stored credentials
- Browser-based SSH terminal (xterm.js + Paramiko over WebSocket)
- GUI quick-launch helpers for basic-auth protected interfaces
- React dashboard with modals, filters, and responsive layout
- Cisco ACI node detail surfaces interface EPG/L3Out bindings with contextual filters
- Fabric inventory KPIs include controller counts alongside leaf/spine metrics
- Inventory overview with collector health, alerts feed, and VM Center workspace
- Automated API tests with pytest + httpx
- InfraPulse Inventory (in progress): live ESXi visibility with host, VM, datastore, and network telemetry
- Inventory endpoint registry with encrypted credentials and polling metadata

## Project Structure
```
backend/    # FastAPI application
frontend/   # React + Vite + Tailwind SPA
```

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
4. Run database migrations (SQLite default auto-creates tables on startup). For PostgreSQL, configure `DATABASE_URL` accordingly.
5. Create an initial admin user:
   ```bash
   cd backend
   python -m app.scripts.create_admin
   ```
6. Start the API server:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
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
   The app will proxy API and WebSocket requests to `http://localhost:8002`.

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

## Inventory Module (Alpha)
- Register ESXi or vCenter collection endpoints through `/api/v1/inventory/endpoints`
- Credentials are stored encrypted using the shared Fernet secret; passwords are never returned in responses
- Responses include polling metadata (`last_polled_at`, `last_poll_status`) for the InfraPulse dashboard
- Background poller (enabled by default) refreshes endpoint heartbeat metadata; toggle via `INVENTORY_POLLER_ENABLED`
- Stub collector currently seeds representative host and VM telemetry so the dashboard surfaces utilization trends while ESXi integration is developed

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

### 2025-11-03
- **ACI Interface Bindings:** Collector now ingests `fvRsPathAtt` and `l3extRsPathL3OutAtt` data, exposing EPG and L3Out bindings on each node interface in the UI and API.
- **Inventory Dashboard:** Replaced the delayed-heartbeat KPI with controller node counts and refreshed filtering text to highlight policy bindings.
- **Schema & API:** Added JSON columns for `epg_bindings`/`l3out_bindings`, updated Pydantic responses, and extended tests to cover the new payload shape.
