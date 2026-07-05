# Cisco ACI & NX-OS Inventory Initiative

## Mission
- Provide the Telco operations team with consolidated, near-real-time inventory across Cisco ACI fabrics and standalone NX-OS devices.
- Leverage AccessVault for secure credential handling, scheduling, visualization, and downstream automation.
- Deliver a repeatable process: verify all required API endpoints first, then execute backend/frontend implementation in incremental releases.

## Scope & Assumptions
- **ACI Controllers**: Access via Cisco APIC REST API (multi-tenant fabric inventory, health scores, faults, relationships).
- **NX-OS Devices**: Access via Cisco NX-API (JSON-RPC or REST) with HTTPS and programmatic CLI commands.
- **Security**: Credentials stored with existing encryption utilities; TLS certificate handling (verify/skip flags) per endpoint.
- **Environments**: Lab APIC `10.64.135.132` (user `nabaa`) as primary testbed; additional controllers/devices added after endpoint validation.

## Phase 0 — API Verification & Discovery
1. **Access Preparation**
   - Confirm reachability (firewall rules, VPN).
   - Validate user roles/privileges for both APIC and NX-OS devices.
   - Document TLS requirements and certificate chains.
2. **Endpoint Catalog**
   - ACI baseline endpoints:
     - `/api/aaaLogin.json` (auth token)
     - `/api/class/fvTenant.json` (tenants)
     - `/api/class/fvAEPg.json` (endpoint groups)
     - `/api/class/fvBD.json` (bridge domains)
     - `/api/class/fvAp.json` (application profiles)
     - `/api/class/fabricNode.json` (fabric nodes, roles)
     - `/api/class/fvCEp.json` (endpoints/attachments)
     - `/api/class/eqptIngrBytes5min.json` (sample timeseries metric)
     - `/api/class/faultInst.json` (faults)
   - NX-OS baseline endpoints:
     - `POST /ins` with JSON-RPC for `show version`, `show inventory`.
     - `POST /ins` for `show interface status`, `show ip route`, `show vlan`.
     - Optional REST resources (`/nxapi/` variants) if enabled.
3. **Verification Scripts**
   - Extend `backend/scripts/test_aci_endpoints.py` to enumerate additional fabrics and capture sample payload snapshots.
   - Create `backend/scripts/test_nxos_endpoints.py` to authenticate and execute diagnostic commands, logging latency and schema.
   - Store sanitized JSON samples in `data/samples/aci/` and `data/samples/nxos/` for schema design.
4. **Acceptance Criteria**
   - Successful authentication + response for each target endpoint.
   - Captured payload size, rate limits, pagination/filters.
   - Identified gaps or custom attributes required by Telco team.
   - Decision log on TLS verification strategy per environment.

## Phase 1 — Data Modeling & Contracts
1. **Domain Modeling Workshop**
   - Map ACI constructs (tenant, VRF, BD, EPG, contract, fabric node, interface, health/fault) to relational schema.
   - Map NX-OS constructs (device, module, interface, VLAN, VRF, route, neighbor).
2. **API Contract Drafts**
   - Swagger draft for REST endpoints (inventory lists, detail views, search filters).
   - WebSocket/event design for streaming fault/health updates.
3. **UML/Data Dictionary**
   - Produce ERD diagrams and attribute dictionaries referencing Phase 0 payloads.
   - Define normalization vs denormalization approach for cross-fabric queries.

## Phase 2 — Backend Foundations
1. **Configuration & Credential Management**
   - Extend settings models for ACI/NX-OS endpoint definitions (host, port, protocol, verify flag, poll cadence, tags).
   - Support per-endpoint secret rotation and tagging for Telco-specific grouping.
2. **Collector Services**
   - Build asynchronous pollers:
     - ACI collector: token management, batched endpoint calls, health score aggregation, fault snapshot.
     - NX-OS collector: session pooling, command batching, interface/route parsing.
   - Implement change detection + persistence (upsert latest state, append to history tables).
3. **APIs & Tasks**
   - REST endpoints for querying fabrics, tenants, endpoints, devices, interfaces.
   - Background tasks for refresh scheduling, error retries, and integration with existing poller framework.
4. **Testing**
   - Unit + integration tests using saved payload fixtures from Phase 0.
   - CI pipeline jobs for collectors (mocked HTTP responses).

## Phase 3 — Frontend & UX
1. **Navigation Additions**
   - Introduce "Cisco ACI" and "Cisco NX-OS" sections under Inventory sidebar.
2. **Screens**
   - **ACI Overview**: Tenant counts, fabric health, fault timeline, quick filters.
   - **Tenant Detail**: VRFs, bridge domains, contracts, endpoints, policy relationships.
   - **Fabric Nodes View**: Spine/leaf roles, status, firmware, interfaces.
   - **NX-OS Dashboard**: Device list, module status, capacity KPIs, syslog/fault feed.
   - **Interface Explorer**: Cross-fabric filtering, operational status, utilization charts.
3. **Shared Components**
   - Search/filter bar with saved filters per Telco requirements.
   - Export and automation hooks (CSV/JSON, API call triggers).
4. **Telemetry & WebSockets**
   - Real-time updates for faults/health changes via WebSocket channel.
   - Visual indicators for stale data or polling errors.

## Phase 4 — Automation & Integrations
1. **Runbook Automation**
   - Actions: trigger ACI policy queries, schedule config backups, open change tickets.
2. **Notifications**
   - Integrate with Telco alerting (email, Teams, PagerDuty) for critical faults.
3. **Reporting**
   - Scheduled reports for tenant resource allocation, interface capacity, fault summaries.

## Phase 5 — Hardening & Release
1. **Performance Testing**
   - Load tests for simultaneous collector runs; tune concurrency/backoff.
   - Benchmark API response times with realistic datasets.
2. **Security Review**
   - Validate RBAC enforcement, audit logging, credential rotation procedures.
3. **Documentation & Training**
   - Administrator guide for onboarding new ACI/NX-OS endpoints.
   - Operator guide for navigating dashboards and creating reports.
4. **Pilot & Rollout**
   - Pilot with Telco QA fabric; gather feedback, iterate.
   - Production rollout with monitoring and rollback plan.

## Deliverables Checklist
- [ ] Endpoint verification logs & sample payload repository.
- [ ] Data models, API contracts, and ERD diagrams.
- [ ] Collector services with automated tests.
- [ ] Frontend dashboards and detail views for ACI/NX-OS.
- [ ] Automation hooks, reporting, and documentation.
- [ ] Runbooks, training materials, and release notes.

## Open Questions
- SLA expectations for inventory freshness (poll intervals per endpoint).
- Required historical retention for fault/health metrics.
- Integration points with existing Telco OSS/BSS platforms.
- Authentication strategy for multi-factor or certificate-based APIC/NX-OS access.
