# NetVerse AI — Product Overview

**Unified Infrastructure Intelligence for AI**

---

## What is NetVerse AI?

NetVerse AI is a secure, single-pane web portal that gives network and data‑center teams
**live, searchable inventory and topology** across our VMware, Cisco ACI, Cisco IP‑MPLS,
and Cisco NX‑OS estates — plus a built‑in **credential vault and remote‑access** module.

Instead of logging into each controller, vCenter, or device to answer "what's deployed
where / what's connected to what / what's free," you get one continuously‑refreshed view,
with the same data available through a documented API.

## Who it's for

- **Network / Telco operations** — audit fabrics, devices, VLANs, BGP, and topology.
- **Data‑center / virtualization teams** — track ESXi hosts, VMs, datastores, networks.
- **Anyone needing secure access** — stored credentials, browser SSH, quick‑launch.

---

## Modules & Features

### 🔐 AccessVault — Credentials & Remote Access
- Encrypted credential storage (AES/Fernet); secrets never exposed in the UI or API.
- Browser‑based **SSH terminal** and **GUI quick‑launch** for managed systems.
- Group/system organization with search.

### 🖥️ VM Inventory (VMware)
- Live **ESXi / vCenter** collection: hosts, virtual machines, datastores, networks.
- Dashboard with capacity/health KPIs; VM Center workspace with filters.
- **Host detail** (clickable) — facts, VMs, datastores, and an **Uplinks & Neighbors**
  topology built from each host's physical NIC **LLDP / CDP** switch neighbors.
- **VM detail** (clickable) — Overview / Networks / Storage plus a **connectivity
  topology** tracing VM → port group → host uplink → **switch** (LLDP/CDP).
- Onboard collectors with a guided admin flow (validate → test → enroll).

### 🔵 Cisco ACI
- **Fabric inventory** — leaf/spine/controller nodes with model, firmware, site/rack.
- **Endpoint directory** — locally‑attached MAC/IP across all fabrics, deep search.
- **VLAN inventory** — Bridge‑Domain **and L3Out** VLANs, mapped to EPG/BD/VRF/tenant.
- **Free‑ports report** — available access ports per switch, fabric uplinks excluded.
- **Fabric summary** — nodes by role/model/state with charts.

### 🟢 IP‑MPLS Inventory (Cisco IOS‑XR / IOS‑XE)
- Onboard routers **by Nautobot role**; collected over SSH with pyATS/Genie.
- Interfaces, VRFs, hardware, and **ISIS / LDP / BGP** neighbors.
- Interactive **ISIS topology** (region/role layout, filters, fullscreen, link detail).
- **Fleet summary** dashboard with health and breakdowns.

### 🟣 NX‑OS Inventory (Cisco Nexus)
- Onboard switches **by Nautobot role** (`Nexus`, `ToR`) over SSH (pyATS/Genie).
- Interfaces, VRFs, hardware, and **BGP** neighbors (all VRFs, IPv4/IPv6).
- **Topology from CDP + LLDP** (merged, shows which protocol saw each link).
- Device detail with Overview / Interfaces / VRFs / Neighbors / BGP / Hardware tabs.

### 🟠 CGNAT Inventory (A10 Thunder + F5 BIG‑IP)
- Multi‑vendor CGNAT gateways collected over **REST** (A10 aXAPI, F5 iControl); manual onboarding.
- **NAT/LSN pools** (public‑IP ranges, port‑block settings), **IP interfaces**, and **static routes**.
- Health metrics: active sessions/subscribers, translations, port utilization, pool exhaustion.
- Device detail with Overview / NAT Pools / Interfaces / Static Routes tabs.

### 🔴 CPNR Inventory (Cisco Prime Network Registrar — DHCP) — *new*
- Per‑VM DHCP config inventory over **REST** (`:8443`): scopes, prefixes,
  IPv4/IPv6 reservations, clients, and client‑classes.
- **Primary ↔ secondary pair consistency** — verifies both VMs of a service pair
  hold identical config and **flags drift** per object (missing / value mismatch).
- **Change tracking** — timestamped add/modify/remove per VM, with a Changes tab
  and per‑VM log export.
- Summary (pairs in‑sync vs drift, by site/service), VMs list, VM detail
  (6 object tabs + Changes), and a **Pair Comparison** view. Bulk onboarding.

### 🟣 NX‑OS Inventory (Cisco Nexus) — *new*
- Onboard Nexus switches **by Nautobot role** (`Nexus`, `ToR`) over SSH.
- Interfaces, VRFs, hardware, and **BGP** neighbors (all VRFs, IPv4/IPv6).
- **Topology from CDP + LLDP** (merged, showing which protocol saw each link).
- Device detail with Overview / Interfaces / VRFs / Neighbors / **BGP** / Hardware tabs.

---

## What makes it useful day‑to‑day

- **Always current** — background pollers refresh each source on a schedule; every view
  shows last‑polled time and flags devices in error or stale.
- **Search everything** — device lists search across name, IP, role, site, rack, model,
  serial, platform, status, and OS.
- **One source of truth via API** — everything the UI shows is available as authenticated
  JSON, with interactive **Swagger docs** at `/docs`. (This also powers upcoming AI/assistant
  integrations.)
- **Enriched from Nautobot** — role, site, and rack pulled automatically.
- **Clean, consistent UX** — dark dashboard with KPI tiles, charts, topology graphs, and
  in‑app notifications; timestamps shown in **IST**.
- **Secure** — JWT login with roles (admin/user), auto‑logout on session expiry, encrypted
  secrets.

---

## Getting started

1. **Open** the portal URL (shared separately) and sign in with your account.
2. Use the left sidebar to pick a module: **VM Inventory, Data Center (ACI), IP‑MPLS,
   NX‑OS**, or **Access Vault**.
3. Each area has a **Summary** (the big picture), detailed **lists** (searchable), and a
   **Topology** where applicable. Admins can onboard new collectors/devices under **Admin**.
4. Developers/integrators: the API is at `/api/v1` with docs at `/docs`.

> Access is role‑based — if you need admin actions (onboarding, edits) or a login, contact
> the platform owner.

---

## On the roadmap

- **AI assistant integration (MCP)** — ask questions of the inventory in natural language
  ("which ports are free on fabric X", "stale devices in Mumbai").
- Deeper metrics/trends and additional device families.

## Feedback

This is the first team release — please send issues, gaps, or requests to the platform
owner. Tell us which views you use most so we prioritize well.
