# SDD: Show ESXi host IP for direct-ESXi collection

- **Status:** Implemented (commit `32feef3`, 2026-07-15) — retroactive spec (fix shipped first)
- **Owner:** naba
- **Type:** Bugfix — VM Inventory host identity

> Note: this fix was applied before its spec was written, which is contrary to the project's
> SDD-first rule ([[sdd-workflow]]). Recording it here to keep the spec set complete; future
> changes get a spec first.

---

## 1. Summary

In **VM Inventory → Host Utilization**, hosts from a **direct ESXi** collector showed up as
`localhost.localdomain`, while hosts from a **vCenter** collector showed the host IP/FQDN. The
fix makes direct-ESXi hosts show the IP (the address the collector connected to).

## 2. Root cause (Phase 0 finding)

The vSphere collector (`app/services/vsphere.py`) set the host name from
`summary.config.name`. Via **vCenter**, ESXi hosts are registered by IP/FQDN, so that field is
already meaningful. On a **direct ESXi** connection, `config.name` is the host's own configured
name, which for unconfigured hosts defaults to **`localhost.localdomain`**. The collector had no
notion of "am I talking to ESXi or vCenter," so it used the placeholder as-is.

Connection type is distinguishable via `content.about.apiType`:
- `"HostAgent"` → direct ESXi
- `"VirtualCenter"` → vCenter

## 3. Change

`app/services/vsphere.py`:
- Read `api_type = content.about.apiType`; `is_direct_esxi = api_type == "HostAgent"`.
- `_resolve_host_name(config_name)`: for direct ESXi, if `config_name` is empty or a
  `localhost.localdomain`/`localhost` placeholder, return the connected **address**; otherwise
  return `config_name` (or address as a final fallback).
- Apply it to the **host** name **and** the **VM→host** mapping (`host_ref.name`) so VMs stay
  linked after the host is renamed. vCenter behavior is unchanged.

No model/migration/API/frontend change — the collector already feeds `InventoryHost.name`.

## 4. Acceptance criteria

1. A direct-ESXi collector's host shows the IP (connected address) instead of
   `localhost.localdomain` in Host Utilization / VM Center.
2. VMs remain linked to that host (host filter/detail still works).
3. vCenter-sourced hosts are unchanged.
4. Effect appears after the next poll (the host row is re-keyed from placeholder to IP once).

## 5. Edge cases / notes

- If the ESXi was onboarded by **hostname** (not IP), that hostname is shown (it's the connect
  address) — acceptable. A future enhancement could instead read the management VMkernel IP
  from the host's `config.network.vnic` regardless of how it was reached (out of scope here).
- Because `InventoryHost` is keyed by name, the first post-fix poll drops the old
  `localhost.localdomain` row and inserts the IP-named one (one-time, expected).

## 6. Test plan

- Re-poll a direct-ESXi endpoint; confirm the host name is the IP and its VMs still attach.
- Confirm a vCenter endpoint's hosts are unaffected.
