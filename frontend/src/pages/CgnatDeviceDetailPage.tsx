import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  fetchCgnatDevice,
  fetchCgnatDeviceInterfaces,
  fetchCgnatDevicePools,
  fetchCgnatDeviceRoutes
} from "@/services/cgnat";
import { locationFromName } from "@/utils/location";
import { CgnatDevice, CgnatInterface, CgnatNatPool, CgnatStaticRoute } from "@/types";

type Tab = "overview" | "pools" | "interfaces" | "routes";
const cell = "px-3 py-2 text-slate-100";
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400";

type SortDir = "asc" | "desc";
type RouteSortKey = "destination" | "next_hop" | "egress_interface" | "egress_vlan" | "family" | "route_domain" | "distance" | "name";

// Colour-coded admin/oper status badge (R5). Green = enabled/up, red =
// disabled/down, slate = unknown/other (e.g. F5 self-IP "floating").
function StateBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-500">--</span>;
  const v = value.toLowerCase();
  const up = ["enable", "enabled", "up", "true", "active"].some((s) => v.includes(s));
  const down = ["disable", "disabled", "down", "false", "inactive"].some((s) => v.includes(s));
  const tone = up
    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
    : down
      ? "border-rose-500/50 bg-rose-500/15 text-rose-200"
      : "border-slate-500/40 bg-slate-500/10 text-slate-300";
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{value}</span>;
}

// NAT role badge (R4): inside = teal, outside = amber, other = indigo.
function NatRoleBadge({ role }: { role?: string | null }) {
  if (!role) return <span className="text-slate-500">--</span>;
  const r = role.toLowerCase();
  const tone = r === "inside"
    ? "border-teal-500/50 bg-teal-500/15 text-teal-200"
    : r === "outside"
      ? "border-amber-500/50 bg-amber-500/15 text-amber-200"
      : "border-indigo-500/50 bg-indigo-500/15 text-indigo-200";
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{role}</span>;
}

// Generic comparator: nulls last; numeric when both numeric; else case-insensitive string.
function compareValues(a: unknown, b: unknown): number {
  const an = a == null || a === "";
  const bn = b == null || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function CgnatDeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<CgnatDevice | null>(null);
  const [pools, setPools] = useState<CgnatNatPool[]>([]);
  const [interfaces, setInterfaces] = useState<CgnatInterface[]>([]);
  const [routes, setRoutes] = useState<CgnatStaticRoute[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [routeSort, setRouteSort] = useState<{ key: RouteSortKey; dir: SortDir }>({ key: "destination", dir: "asc" });
  const [scope, setScope] = useState<string>("all");

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [d, p, i, r] = await Promise.all([
          fetchCgnatDevice(deviceId),
          fetchCgnatDevicePools(deviceId),
          fetchCgnatDeviceInterfaces(deviceId),
          fetchCgnatDeviceRoutes(deviceId)
        ]);
        if (cancelled) return;
        setDevice(d); setPools(p); setInterfaces(i); setRoutes(r);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [deviceId]);

  // Tenancy scope (R8/R9): F5 = route-domain, A10 = partition.
  const scopeField: "route_domain" | "partition" = device?.vendor === "f5" ? "route_domain" : "partition";
  const scopeLabel = device?.vendor === "f5" ? "Route Domain" : "Partition";
  const scopeValues = useMemo(() => {
    const set = new Set<string>();
    [...interfaces, ...pools, ...routes].forEach((row) => {
      const v = (row as unknown as Record<string, unknown>)[scopeField];
      if (v != null && v !== "") set.add(String(v));
    });
    return Array.from(set).sort((a, b) => compareValues(a, b));
  }, [interfaces, pools, routes, scopeField]);

  const inScope = (row: CgnatInterface | CgnatNatPool | CgnatStaticRoute): boolean =>
    scope === "all" || String((row as unknown as Record<string, unknown>)[scopeField] ?? "") === scope;
  const filteredInterfaces = useMemo(() => interfaces.filter(inScope), [interfaces, scope, scopeField]);
  const filteredPools = useMemo(() => pools.filter(inScope), [pools, scope, scopeField]);
  const filteredRoutes = useMemo(() => routes.filter(inScope), [routes, scope, scopeField]);

  const sortedRoutes = useMemo(() => {
    const getter: Record<RouteSortKey, (r: CgnatStaticRoute) => unknown> = {
      destination: (r) => r.destination,
      next_hop: (r) => r.next_hop,
      egress_interface: (r) => r.egress_interface,
      egress_vlan: (r) => r.egress_vlan,
      family: (r) => r.family,
      route_domain: (r) => r.route_domain,
      distance: (r) => r.distance,
      name: (r) => r.name || r.description
    };
    const get = getter[routeSort.key];
    const dir = routeSort.dir === "asc" ? 1 : -1;
    return [...filteredRoutes].sort((a, b) => dir * compareValues(get(a), get(b)));
  }, [filteredRoutes, routeSort]);

  const toggleRouteSort = (key: RouteSortKey) =>
    setRouteSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (isLoading) {
    return <AppShell><div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div></AppShell>;
  }
  if (!device) {
    return <AppShell><div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">Device not found.</div></AppShell>;
  }

  const kpi = (label: string, value: React.ReactNode) => (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
  const num = (v?: number | null) => (v == null ? "--" : v.toLocaleString());

  // Clickable sortable header for the static-route table (R6).
  const SortTh = ({ label, sortKey }: { label: string; sortKey: RouteSortKey }) => {
    const active = routeSort.key === sortKey;
    return (
      <th className={th}>
        <button
          type="button"
          onClick={() => toggleRouteSort(sortKey)}
          className={`flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-200 ${active ? "text-slate-100" : ""}`}
        >
          {label}
          <span className={`text-[9px] ${active ? "text-primary-300" : "text-slate-600"}`}>
            {active ? (routeSort.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={device.hostname || device.name}
          description={`${device.vendor.toUpperCase()} · ${device.mgmt_ip} · ${locationFromName(device.hostname || device.name)}`}
          actions={<Link to="/cgnat/devices" className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500">← All devices</Link>}
        />

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpi("Status", device.status)}
          {kpi("Model", device.model ?? "--")}
          {kpi("OS", device.os_version ?? "--")}
          {kpi("Active Sessions", num(device.active_sessions))}
          {kpi("Translations", num(device.total_translations))}
          {kpi("Exhaustion", num(device.exhaustion_events))}
        </section>

        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-brand-800/70">
          <div className="flex flex-wrap gap-1">
            {([["overview", "Overview"], ["pools", `NAT Pools (${filteredPools.length})`], ["interfaces", `Interfaces (${filteredInterfaces.length})`], ["routes", `Static Routes (${filteredRoutes.length})`]] as [Tab, string][]).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-t-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${tab === id ? "border-b-2 border-primary-500 text-white" : "text-slate-400 hover:text-slate-200"}`}>{label}</button>
            ))}
          </div>
          {scopeValues.length > 1 && (
            <label className="mb-1 flex items-center gap-2 text-xs text-slate-400">
              <span className="uppercase tracking-wide">{scopeLabel}</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.currentTarget.value)}
                className="rounded border border-brand-700 bg-brand-900/80 px-2 py-1 text-xs text-slate-200 focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All ({scopeValues.length})</option>
                {scopeValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          {tab === "overview" && (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpi("Serial", device.serial ?? "--")}
              {kpi("Uptime", device.uptime_text ?? "--")}
              {kpi("Subscribers", num(device.active_subscribers))}
              {kpi("Port Utilization", device.port_util_pct == null ? "--" : `${device.port_util_pct}%`)}
              {kpi("NAT/LSN Pools", pools.length)}
              {kpi("Interfaces", interfaces.length)}
              {device.vendor === "f5" ? kpi("Virtual Servers", num(device.virtual_server_count)) : kpi("Role", device.role ?? "--")}
              {kpi("Site / Rack", `${device.site_name ?? "--"} / ${device.rack_location ?? "--"}`)}
            </div>
          )}

          {tab === "pools" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Pool</th>
                    <th className={th}>Kind/Mode</th>
                    <th className={th}>Public Range</th>
                    <th className={th}>Port Block</th>
                    <th className={th}>Active Xlat</th>
                    <th className={th}>Failures</th>
                    <th className={th}>Util %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {filteredPools.map((p) => (
                    <tr key={p.id} className="hover:bg-brand-800/40">
                      <td className={cell}>
                        {p.pool_name}
                        {p.pool_group ? <div className="text-xs text-slate-500">grp: {p.pool_group}</div> : null}
                        {p.partition ? <div className="text-xs text-slate-500">{p.partition}</div> : null}
                      </td>
                      <td className={cell}>{[p.kind, p.mode].filter(Boolean).join(" / ") || "--"}</td>
                      <td className={`${cell} font-mono text-xs`}>{p.start_address ? `${p.start_address}–${p.end_address ?? ""} ${p.prefix ?? ""}` : p.prefix ?? "--"}</td>
                      <td className={cell}>{p.port_block_size ?? "--"}</td>
                      <td className={cell}>{p.active_translations ?? "--"}</td>
                      <td className={(p.translation_failures ?? 0) > 0 ? "px-3 py-2 text-amber-300" : cell}>{p.translation_failures ?? "--"}</td>
                      <td className={cell}>{p.port_util_pct == null ? "--" : `${p.port_util_pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "interfaces" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Interface</th>
                    <th className={th}>IPv4</th>
                    <th className={th}>IPv6</th>
                    <th className={th}>NAT Role</th>
                    <th className={th}>VLAN</th>
                    <th className={th}>Admin/Oper</th>
                    <th className={th}>Description</th>
                    <th className={th}>MTU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {filteredInterfaces.map((i) => {
                    const addrs = i.addresses && i.addresses.length ? i.addresses : (i.ip_address ? [i.ip_address] : []);
                    const v4 = addrs.filter((a) => !a.includes(":"));
                    const v6 = addrs.filter((a) => a.includes(":"));
                    const addrCell = (list: string[], colour: string) =>
                      list.length === 0 ? (
                        <span className="text-slate-500">--</span>
                      ) : (
                        <div className="space-y-0.5">
                          {list.map((a) => (
                            <div key={a} className={colour}>{a}</div>
                          ))}
                        </div>
                      );
                    return (
                    <tr key={i.id} className="hover:bg-brand-800/40">
                      <td className={cell}>{i.name}</td>
                      <td className={`${cell} font-mono text-xs`}>{addrCell(v4, "text-primary-200")}</td>
                      <td className={`${cell} font-mono text-xs`}>{addrCell(v6, "text-sky-300")}</td>
                      <td className={cell}><NatRoleBadge role={i.nat_role} /></td>
                      <td className={cell}>{i.vlan ?? "--"}</td>
                      <td className={cell}>
                        <span className="flex flex-wrap items-center gap-1">
                          <StateBadge value={i.admin_state} />
                          <StateBadge value={i.oper_state} />
                        </span>
                      </td>
                      <td className={cell}>{i.description ?? "--"}</td>
                      <td className={cell}>{i.mtu ?? "--"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "routes" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <SortTh label="Destination" sortKey="destination" />
                    <SortTh label="Next Hop" sortKey="next_hop" />
                    <SortTh label="Egress Iface" sortKey="egress_interface" />
                    <SortTh label="Egress VLAN" sortKey="egress_vlan" />
                    <SortTh label="Family" sortKey="family" />
                    <SortTh label="RD" sortKey="route_domain" />
                    <SortTh label="Distance" sortKey="distance" />
                    <SortTh label="Name / Description" sortKey="name" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {sortedRoutes.map((r) => (
                    <tr key={r.id} className="hover:bg-brand-800/40">
                      <td className={`${cell} font-mono text-xs`}>{r.destination ?? "--"}</td>
                      <td className={`${cell} font-mono text-xs`}>{r.next_hop ?? "--"}</td>
                      <td className={cell}>{r.egress_interface ?? "--"}</td>
                      <td className={cell}>{r.egress_vlan ?? "--"}</td>
                      <td className={cell}>{r.family ?? "--"}</td>
                      <td className={cell}>{r.route_domain ?? "--"}</td>
                      <td className={cell}>{r.distance ?? "--"}</td>
                      <td className={cell}>{r.name || r.description || "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
