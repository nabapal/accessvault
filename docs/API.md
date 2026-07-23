# NetVerse AI — API Guide

The backend is a FastAPI app. The **authoritative, always-current** API reference
is the auto-generated OpenAPI spec, served live:

- **Swagger UI:** `https://<host>/docs` (dev: `http://localhost:8200/docs`)
- **ReDoc:** `https://<host>/redoc`
- **Machine-readable:** `https://<host>/openapi.json`

A point-in-time snapshot is committed at [`docs/openapi.json`](openapi.json)
(regenerate on release — see below). Current spec version tracks the app
`VERSION` (now **0.3.0**).

## Base URL & versioning
All endpoints are under `/api/v1`. The running build identifies itself at:
- `GET /api/v1/health` and `GET /api/v1/version` → `{version, environment, git_sha, build_date}`

## Authentication
1. `POST /api/v1/auth/login` with credentials → returns a JWT.
2. Send `Authorization: Bearer <token>` on all other calls.
Admin-only routes (create/update/delete/sync/test) require an admin user.

## Modules (endpoint prefixes)
| Prefix | Module |
| --- | --- |
| `/api/v1/auth`, `/api/v1/users`, `/api/v1/groups`, `/api/v1/systems`, `/api/v1/gui`, `/api/v1/terminal` | AccessVault (auth, RBAC, credential vault, SSH/GUI) |
| `/api/v1/inventory` | VM Inventory (ESXi/vCenter) |
| `/api/v1/aci`, `/api/v1/telco` | Cisco ACI / fabric onboarding |
| `/api/v1/ipmpls` | IP-MPLS Inventory |
| `/api/v1/nxos` | NX-OS Inventory |
| `/api/v1/cgnat` | CGNAT Inventory (A10 / F5) |
| `/api/v1/cpnr` | CPNR Inventory (DHCP) |

## CPNR endpoints
| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/cpnr/vms` | List CPNR VMs (paginated; `search`) |
| POST | `/api/v1/cpnr/vms` | Onboard a VM (admin) |
| GET | `/api/v1/cpnr/vms/{id}` | VM detail |
| PATCH / DELETE | `/api/v1/cpnr/vms/{id}` | Update / remove (admin) |
| POST | `/api/v1/cpnr/vms/{id}/sync` | Collect now (admin) |
| POST | `/api/v1/cpnr/vms/{id}/test` | Test connectivity (admin) |
| GET | `/api/v1/cpnr/vms/{id}/objects/{object_type}` | Objects of a type (`scope`, `prefix`, `reservation4`, `reservation6`, `client_entry`, `client_class`) |
| GET | `/api/v1/cpnr/vms/{id}/changes` | Change events for a VM |
| GET | `/api/v1/cpnr/vms/{id}/changes/export` | Download per-VM change log |
| GET | `/api/v1/cpnr/pairs` | Primary/secondary pairs + consistency status |
| GET | `/api/v1/cpnr/pairs/{pair_id}/comparison` | Detailed pair diff (drift per object) |
| GET | `/api/v1/cpnr/summary` | Fleet summary (pairs in-sync vs drift, counts) |

## Regenerating the snapshot
`docs/openapi.json` is exported from the app; refresh it when the API changes
(ideally at release time):
```bash
cd backend
../.venv/bin/python -c "import json; from app.main import app; open('../docs/openapi.json','w').write(json.dumps(app.openapi(), indent=2, default=str))"
```
