# AccessVault ESXi Live Inventory Expansion

## Status Update (Oct 2025)
- [x] Inventory endpoint registry API (FastAPI) with encrypted credential storage
- [x] React dashboard integration for collector visibility
- [x] Polling service scaffold for collector heartbeat metadata (ESXi ingestion wiring pending)
- [x] Stubbed host/VM data model, REST surfaces, and dashboard tables for early UX validation
- [ ] Timeseries metrics store and alerting pipeline
- [ ] Inventory admin panel with onboarding workflow
 - [x] Inventory admin panel with onboarding workflow

## Objectives
- Aggregate real-time inventory data (hosts, clusters, VMs, datastores, networks, performance metrics) from multiple ESXi or vCenter endpoints.
- Provide live visibility, trend analysis, and alerting through the existing AccessVault platform.
- Maintain secure credential handling, RBAC-driven access, and auditability.
- Deliver extensible APIs to support automation and downstream integrations.

## High-Level Architecture
- **Collectors**: Agentless polling services using pyVmomi to query ESXi/vCenter APIs; support multiple target endpoints with per-host schedules.
- **Ingestion Pipeline**: Normalize inventory entities, detect deltas, and enqueue updates for persistence; optional message bus (e.g., RabbitMQ/Kafka) to decouple polling from storage.
- **Data Stores**:
  - PostgreSQL (existing) for latest-state inventory, metadata, and configuration.
  - Timeseries store (TimescaleDB extension or InfluxDB) for performance metrics and historical trends.
  - Redis cache for frequently requested summaries and WebSocket fan-out.
- **API Layer (FastAPI)**: Expanded endpoints for inventory queries, metrics retrieval, alert configuration, WebSocket/SSE streaming, and administration of collector targets.
- **Frontend (React/Vite)**: New navigation section for "Inventory" with dashboard, tables, detail views, alert console, and admin pages; WebSocket integration for live updates.
- **Background Workers**: Celery/Redis or APScheduler-based jobs for polling, data retention, alert evaluation, and report generation.

## Backend Enhancements
1. **Configuration & Credentials**
   - Extend settings models to include multiple ESXi/vCenter targets (hostname, port, protocol, credentials, tags, poll intervals).
   - Encrypt stored credentials using existing Fernet utility or integrate with Vault/KMS.
   - Provide admin API endpoints to create, update, validate, and delete target definitions.
2. **Polling Service**
   - Implement asynchronous collectors (asyncio + aiohttp) orchestrated by a scheduler.
   - Support incremental updates via vSphere Property Collector filters.
   - Capture host/VM metrics: CPU, memory, storage usage, power state, uptime, datastore utilization, network status.
   - Persist last successful poll time, status, and error diagnostics for each target.
3. **Data Model**
   - Normalize ORM models: `EsxiEndpoint`, `Cluster`, `Host`, `VirtualMachine`, `Datastore`, `Network`, `ResourcePool`, `Alert`.
   - Track relationships (host memberships, VM placements, datastore assignments, network connections).
   - Maintain change history tables or event logs for audit.
4. **APIs**
   - REST endpoints for list/filter/sort across entities; support pagination and query parameters.
   - Detail endpoints providing related entities and recent events.
   - WebSocket channel streaming live updates and alert notifications.
   - Health endpoints for collectors (poll status, queue depth, latency).
5. **Alerts & Notifications**
   - Rule engine configurable per endpoint/tag (e.g., host offline, datastore utilization > 80%, VM powered off unexpectedly).
   - Integrations for email, Slack, Teams, or existing AccessVault notification mechanism.
6. **Security & Compliance**
   - RBAC: restrict inventory admin actions to privileged roles; provide read-only roles for operators.
   - Log access events and configuration changes.
   - Apply TLS to external APIs and sanitize logs.

## Frontend Enhancements
1. **Navigation**
   - Add "Inventory" section with subroutes: Dashboard, Hosts, VMs, Datastores, Alerts, Admin.
2. **Pages & Key Features**
   - **Inventory Dashboard**: KPI cards, filtering, poll status timeline, recent alerts, quick search.
   - **Hosts Table**: Column sorting, status indicators, resource bars, filter by cluster/tag; row click opens Host Detail.
   - **Host Detail**: Hardware summary, live metrics charts, VM list, datastore usage, network mappings, event history.
   - **VMs Table**: Power state, guest OS, IP, host, datastore; quick filters; bulk actions (export). Detail view mirrors host detail with utilization graphs and snapshots.
   - **Datastores View**: Capacity/free charts, host/VM counts, trend graphs.
   - **Alerts Console**: Active alerts, acknowledgement workflow, rule configuration (if user has permissions).
   - **Inventory Admin Panel**: CRUD for endpoints, credential validation, polling schedule controls, tags, test connectivity button, last poll status cards.
3. **Technology Considerations**
   - Reuse existing component library (Tailwind, headless UI components).
   - Use React Query or SWR for API caching and refetching.
   - Establish WebSocket context for live updates; fallback to polling.
   - Add form validation with Zod/Yup for admin forms.

## Data & Storage Strategy
- **Latest State**: `facts` tables updated atomically on each poll; include `version` or `last_seen` timestamp.
- **Historical Metrics**: Append-only timeseries for CPU, memory, datastore usage; daily rollups to control storage.
- **Change Events**: Capture diffs (e.g., VM power changes) as structured events for timeline views.
- **Archiving & Retention**: Configurable retention policy; consider moving old metrics to cold storage.

## Deployment & Operations
- Extend Docker Compose/Kubernetes manifests with background worker/queue services.
- Parameterize environment variables for endpoints, polling intervals, secrets.
- CI/CD: integrate tests for collectors, run e2e suites (API + UI) pre-deploy.
- Observability: add Prometheus exporters, Grafana dashboards (poll latency, API response times, alert rates).
- Backup: include inventory data in existing backup schedule; test restore procedures.
- Runbooks: document steps for adding hosts, rotating credentials, handling poll failures.

## Roadmap & Milestones
1. **Discovery & Design (1-2 weeks)**
   - Finalize data model, API contracts, UI wireframes.
   - Validate credentials and permissions with infrastructure team.
2. **Phase 1: Core Inventory (3-4 weeks)**
   - Implement endpoint registry, polling service, database schema.
   - Expose REST endpoints and minimal dashboard (host/VM lists).
   - Basic frontend pages hooked to live data.
3. **Phase 2: Metrics & Alerts (3-4 weeks)**
   - Add timeseries storage, charts, and trend views.
   - Implement alert rules, notifications, and alerts console.
4. **Phase 3: Admin & Hardening (2-3 weeks)**
   - Complete admin panel UX, credential rotation workflows, RBAC enforcement.
   - Add audit logging, health checks, load/perf testing.
5. **Phase 4: Polish & Launch (1-2 weeks)**
   - UX refinements, documentation, knowledge transfer, production rollout.

## Risks & Mitigations
- **API Limits / Performance**: Poll frequency may overload ESXi APIs; implement backoff and staggered schedules.
- **Credential Management**: Ensure secure storage and rotation; consider secret manager integration.
- **Scalability**: Large deployments may require horizontal scaling; design collector service to be stateless and horizontally scalable.
- **Data Volume**: Timeseries data growth; define retention and aggregation policies early.
- **Change Management**: Communicate new UI and workflows to users; provide training.

## Next Actions
- Review plan with stakeholders and validate scope.
- Confirm infrastructure resources (DB extensions, message broker, cache).
- Draft UI wireframes and API contracts.
- Kick off Phase 1 implementation once approvals and resources are secured.
