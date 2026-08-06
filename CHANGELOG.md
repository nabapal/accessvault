# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com); versions follow [SemVer](https://semver.org).

## [Unreleased]

### Features
- pbr: PBR Flow Monitoring module — read-only ACI L4-L7 service-graph visibility
  (fabric health dashboard, searchable/sortable service browser, node-by-node
  topology with threshold/bypass states, blast radius, durable health-trend history)
- pbr: IP-flow lookup — maps a source/destination IP pair to its PBR service via
  longest-prefix match on scope-valid (import-security) external subnets, with
  same-contract-opposite-side default-route disambiguation and tie surfacing
- pbr: per-node detail (leaf/path, per-side BD/VRF/L3Out/VLAN + redirect policy,
  redirect destinations with configured + learned MAC, L1 redirect interfaces,
  threshold min/max/down-action + active%) resolved from live APIC
- pbr: global IP-flow lookup across all fabrics with a per-fabric selector; matched
  result shows the best-matching consumer/provider EPG, the ACI fabric + tenant, and a
  count when multiple service graphs match
- pbr: redirect destinations distinguished IN (consumer policy) vs OUT (provider policy)
  in node cards and topology; learned/UP next-hop IPs shown in green
- pbr: double-click a redirect IP to open the owning CGNAT device (exact-host match), or
  a toast if the IP is not in the CGNAT inventory; returning restores the PBR view + scroll

### Changed
- pbr: service status is a status judgement, not a static % band — DOWN only when all
  nodes are faulty or a threshold is breached with down-action=deny; otherwise WARNING
- pbr: connector VLAN/VRF resolved for both BD-side (vnsEPpInfo) and L3Out-side
  (l3extRsPathL3OutAtt / l3extRsEctx); external-EPG blocks show only scope-valid
  (import-security) subnets

### Fixed
- pbr: poller survives transient per-tick errors (a DB lock no longer kills the loop),
  gates per-fabric poll interval, and fast-fails an unreachable APIC
- pbr: topology node-box text no longer overflows (interior clip + hover tooltips);
  services/nodes upserted with a stable id so health-trend history accumulates without
  orphaned rows

## [0.3.0] - 2026-07-23

### Features
- cpnr: bulk-import script for CPNR VMs
- cpnr: CPNR (DHCP) inventory module — all phases
- release: deploy environment (dev/pre_pod/prod) + CHANGELOG option A
- release: version traceability, CHANGELOG, and release tooling
- cgnat: devices list shows Software (version+build) + License columns
- cgnat: Phase 5 — license (F5 REST + A10 clideploy show license-info)
- cgnat: Phase 4 — resolve route next-hop to egress interface + VLAN
- cgnat: Phase 3 — all route-domains/partitions + selector
- cgnat: Phase 2 — IPv6 addresses + NAT role + per-interface VLAN
- cgnat: Phase 1 — sortable static routes + colour-coded iface status
- accessvault: paginate credentials table + move Groups above nav
- inventory: VM connectivity topology (VM→Network→Uplink→Switch)
- inventory: ESXi host detail + LLDP/CDP uplink neighbors
- cgnat: add Edit action to CGNAT devices admin
- cgnat: static route details under device detail
- cgnat: collect L3 IP interfaces (A10 ve / F5 self-IPs)
- cgnat: CGNAT inventory frontend (summary, devices, detail, admin)
- cgnat: CGNAT inventory backend (A10 + F5, REST)
- ipmpls,nxos: match device admin actions to VM collectors
- nxos: add Edit action to NX-OS devices admin
- ipmpls: add Edit action to IP-MPLS devices admin
- nxos: NX-OS inventory frontend (devices, detail, admin, summary, topology)
- nxos: NX-OS inventory backend (model, collector, poller, API, importer)
- aci: include L3Out VLANs in the VLAN inventory
- ipmpls: only import Active devices from Nautobot by default
- ui: ACI summary donut charts + PageHeader rollout
- ui: summary charts, shared PageHeader, a11y focus rings
- ui: roll out skeletons, empty states, and action toasts
- ui: polish pass — nav icons, skeletons, empty states, toasts, KPI tiles
- ipmpls: show unique VRF count alongside instance total
- ipmpls: fleet summary page + expanded /summary endpoint
- brand: NetVerse AI node-network logo mark
- ipmpls: onboard ICR + place at AG3 level in topology
- ipmpls: place IBR/IAG at SAR level in topology
- ipmpls: place RR roles at AG3 level in topology
- ipmpls: click a topology link for full detail
- ipmpls: fullscreen mode for topology (Esc to exit)
- ipmpls: Group-by toggle on topology (Devices / Role / Location)
- ipmpls: semantic-zoom grouping on topology (role then location)
- ipmpls: structured topology layout by location + role layers
- ipmpls: location filter on topology + shared location util
- ipmpls: role filter on the topology graph
- ipmpls: add Location column derived from device-name prefix
- ipmpls: render topology with Cytoscape.js
- ipmpls: Phase 3 — link-state topology + Topology view
- ipmpls: compact tabbed device detail page
- ipmpls: switch parsing from TextFSM to pyATS/Genie
- ipmpls: Phase 2 — VRF and neighbor (ISIS/LDP) inventory
- ipmpls: script to bulk-import devices from Nautobot by role
- ipmpls: site = tenant-site; relabel field to Rack Location
- ipmpls: enrich device role/site/rack from Nautobot
- ipmpls: show Last Poll timestamp in the Admin device table
- ipmpls: IP-MPLS inventory frontend (Phase 1)
- ipmpls: IP-MPLS inventory backend for Cisco IOS-XE/XR (Phase 1)
- ui: collapsible (accordion) sidebar groups
- ui: reorganize sidebar into purpose-based groups
- ui: professional branding polish — consistent InfraPulse identity
- ui: display all timestamps in IST (Asia/Kolkata)
- aci: add endpoint, free-port, and VLAN inventories per fabric
- Add host serial extraction from vSphere/ESXi and Nautobot site/rack enrichment for inventory hosts
- add aci node detail view and collector data
- add ipse sidebar navigation
- enhance inventory experience
- add inventory management ui and services

### Fixes
- release: bundle VERSION into backend image
- cgnat: A10 CFW NAT role via ip client/server
- cgnat: F5 os_version now includes build number
- accessvault: keep Groups panel at bottom of nav rail
- inventory: host nics 500 -> InventoryHostNicRead id/host_id as UUID
- inventory: show ESXi host IP for direct-ESXi collection
- aci: bound APIC query concurrency + retry to fix large-fabric collection
- dev: free ports 8200/5173 on startup in dev.sh
- ipmpls: include collection status in device search
- ipmpls: include platform and OS version in device search
- ipmpls: bind topology edge-click reliably (ref-based, once per graph)
- aci: make endpoint search match IP addresses
- ipmpls: show link detail as a floating popup
- ipmpls: include role/site/rack in device search
- ipmpls: tolerate per-command TextFSM parse failures
- ui: don't dump all sub-tabs when the sidebar rail is collapsed
- auth: auto-logout to /login when the session expires
- aci: prune decommissioned fabric nodes on poll
- ui: parse naive API timestamps as UTC so IST display is correct
- inventory: keep ESXi/vCenter poller alive across failing ticks

### Documentation
- document CPNR inventory module + onboarding (dev/prepod/prod)
- spec: CPNR inventory SDD (DHCP config + pair diff + change tracking)
- spec: D3 resolved — F5 NAT role via LSN egressInterfaces + VS vlans
- spec: A10 license via aXAPI clideploy passthrough (no SSH)
- spec: CGNAT D4 resolved — A10 license via SSH 'show license-info'
- spec: CGNAT SDD Phase-0 findings — A10 partitions confirmed, license not in aXAPI
- spec: CGNAT dashboard enhancements SDD (Phase 0 validated on F5+A10)
- add cross-domain improvement roadmap (10 items)
- document ESXi host detail + VM connectivity topology
- spec: VM connectivity topology SDD (VM->network->uplink->switch)
- spec: resolve ESXi host-detail/LLDP decisions; approve spec
- spec: ESXi host detail + LLDP/CDP uplink neighbors SDD + probe
- backfill specs for CGNAT edit + ESXi host-IP fix; update release notes
- update README + product overview for NX-OS and CGNAT modules
- spec: resolve CGNAT decisions; approve spec
- spec: CGNAT inventory SDD (A10 + F5) with live Phase 0 findings
- add NetVerse AI product overview for first team release
- add 2026-07-06 NetVerse AI release notes
- spec: record NX-OS Phase 0 findings (Genie nxos commands; BGP=show bgp vrf all all summary)
- spec: resolve NX-OS inventory decisions; approve spec
- spec: SDD for Cisco NX-OS device inventory module
- spec: mark ACI L3Out VLANs spec as Implemented
- spec: resolve open questions for ACI L3Out VLANs
- spec: SDD for including L3Out VLANs in ACI VLAN inventory
- note active-only default and --status flag for IP-MPLS onboarding
- add IP-MPLS device onboarding section to README
- prune stale docs, archive plans, refresh README
- expose Swagger in prod + development playbook for consistent API/MCP flow

### Chores
- cgnat: probe script — add IP-interface + BGP endpoints
- remove dead spike scripts and orphan VM page
- make deploy script executable
- auto-stash before deployment pull
- streamline header navigation
- stop tracking local db and logs

### Other
- split iface IPv4/IPv6 columns + rename NAT role "other"
- InfraPulse -> NetVerse AI
- Revert "feat(ipmpls): semantic-zoom grouping on topology (role then location)"
- make deploy script compose-compatible; adjust alembic.ini path
- Document ACI interface binding release
- Add ACI interface binding display and controller metrics
- Update fabric summary UI and backend
- Expose backend on host port 8005
- Restore env templates
- Enhance ESXi inventory reporting
- Remove virtual environment from repository
- Initial project setup

