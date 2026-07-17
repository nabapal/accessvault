# NetVerse AI — Improvement Roadmap

Cross-domain improvement plan spanning all modules (AccessVault, VMware, ACI,
IP-MPLS, NX-OS, CGNAT). Each item is SDD-first: write the spec in
`docs/specs/<feature>.md` (Phase 0 discovery first) before any code.

Status legend: 🔵 planned · 🟡 in progress · ✅ done

## Flagship — cross-domain value
1. **Cross-domain topology correlation** 🔵 · *VMware + ACI + NX-OS*
   Correlate CDP/LLDP switch neighbors discovered in VM/host topology
   (`remote_device`, e.g. `Leaf108`) to the ACI/NX-OS device inventory so a
   VM's switch node deep-links into the fabric leaf. Highest-leverage feature;
   the deferred "next phase".
2. **Global unified search** 🔵 · *all domains*
   One search box resolving IP / MAC / name across VMs, hosts, ACI endpoints,
   IP-MPLS + NX-OS devices, and CGNAT pools.
3. **Read-only MCP server** 🟡 · *all domains* — **NEXT UP**
   MCP server (in `claude-netops-lab`) exposing inventory to Claude for
   natural-language queries. Builds on #1/#2.

## Reliability & operations
4. **ACI large-fabric hardening** 🔵 · *ACI*
   Retry/backoff on 503s + partial-collection flag so silent data loss on big
   fabrics is surfaced, not hidden.
5. **Real alerting & change tracking** 🔵 · *all domains*
   Detect state transitions (host down, BGP/ISIS neighbor down, CGNAT pool
   exhaustion, VM add/remove) and notify (email/webhook/Slack).
6. **Poller observability & health** 🔵 · *cross-cutting*
   Per-poller metrics (last run, duration, items, error rate) + health page +
   metrics endpoint; CI smoke check for the py3.8/pyVmomi boot gap.

## Per-domain depth
7. **Historical trends & thresholds for CGNAT** 🔵 · *CGNAT*
   Time-series storage + trend charts + threshold alerts (catch pool
   exhaustion before it happens).
8. **Config backup & drift detection** 🔵 · *IP-MPLS + NX-OS*
   Pull running-config per poll, version + diff over time, flag drift.
9. **Bulk onboarding + Nautobot sync for CGNAT & VMware** 🔵 · *CGNAT + VMware*
   Nautobot-role-based import (like IP-MPLS/NX-OS) + scheduled re-sync.

## Platform hardening
10. **Scoped RBAC + audit logging** 🔵 · *AccessVault core*
    Per-domain / per-group scoped roles + audit log (credential access, SSH
    launches, admin changes). Prerequisite for wider team rollout.

## Recommended sequence
#3 (MCP, current) → #1 → #2 → #5 → #4/#6, with #10 before broadening access.
