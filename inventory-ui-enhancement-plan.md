# Inventory UI Enhancement Plan

## Goals
- Streamline the onboarding experience for vSphere/ESXi collectors.
- Deliver an at-a-glance operational dashboard with capacity and health KPIs.
- Provide a dedicated workspace for VM visibility with deep dives and bulk actions.
- Preserve reuse of existing API services while layering richer UX patterns.

## Page Roadmap

### 1. Inventory Admin (`/inventory/admin`)
- **Layout**: two-column grid with a left stepper (Credentials → Validate → Preview → Enroll) and a right summary panel.
- **Forms**: credential helpers (saved profiles, password reveal toggle), TLS verification tooltip, tag chips with autocomplete, description character count.
- **Validation UX**: skeleton placeholders while polling, success state with expandable tables for hosts/VMs/datastores/networks, error banner with remediation hints and log link.
- **History**: show timestamp of last validation run and quick rerun button.
- **Drafts**: allow saving partially completed onboarding flows (local storage) and importing credential JSON files.

### 2. Inventory Overview (`/inventory`)
- **Hero Metrics**: total hosts, VMs, datastores, networks, combined datastore capacity (used vs free), poll success rate.
- **Utilization Charts**: spark-lines for CPU, memory, storage, polling latency; highlight top/bottom assets.
- **Endpoint Health**: cards for each collector with status badge, last poll, quick actions (sync, test).
- **Events Feed**: recent poll failures, credential expiry warnings, stale endpoints.
- **Global Filters**: source type, tags, health status; filters drive all widgets and provide deep links.
- **Navigation**: quick actions to open admin onboarding or jump to VM/host detail pages.

### 3. VM Center (`/inventory/virtual-machines`)
- **Summary Bar**: total VMs, powered-on/off counts, average CPU/memory/storage usage, breakdown by OS/tag.
- **Main Grid**: sortable columns (name, host, endpoint, power state, CPU%, memory MB, storage GB, tools status, tags) with column chooser and CSV export.
- **Filters/Search**: by endpoint, host, power state, tag, OS, utilization thresholds.
- **Detail Drawer**: per-VM charts (24h CPU & memory trends), datastore/network membership, recent events, placeholder action buttons (console, automation).
- **Bulk Actions**: batch tag assignment, schedule maintenance placeholder, export selection.

## Implementation Phases
1. [x] **Foundations**
   - Routes and component scaffolding for the VM Center are wired into the router.
   - Inventory services reused without breaking API compatibility.
2. [x] **Overview Enhancements**
   - Dashboard tiles expanded with poll success and network metrics, plus collector health/event feeds.
   - KPI visuals reorganized for better scanability.
3. [x] **Admin Workflow Upgrade**
   - Stepper layout, draft controls, and validation history added to the onboarding flow.
   - Collector list supports filtering by health state.
4. [x] **VM Center Build-out**
   - Dedicated VM workspace with summary bar, filters, detail panel, and utilization metrics.
5. [ ] **Polish & QA**
   - Accessibility pass (keyboard/tab order, ARIA labels).
   - Responsive layout and fine-grained performance tuning.
   - Update tests, README screenshots, and release notes.

## Open Questions
- Do we expose saved credential profiles server-side or client-side only?
- Are trend metrics precomputed in backend or derived client-side with polling intervals?
- What is the acceptable timeframe for poll history aggregation (24h vs 7d)?
