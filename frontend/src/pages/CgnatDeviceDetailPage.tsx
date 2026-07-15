import { useEffect, useState } from "react";
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

export function CgnatDeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<CgnatDevice | null>(null);
  const [pools, setPools] = useState<CgnatNatPool[]>([]);
  const [interfaces, setInterfaces] = useState<CgnatInterface[]>([]);
  const [routes, setRoutes] = useState<CgnatStaticRoute[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [isLoading, setIsLoading] = useState(true);

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

        <div className="flex flex-wrap gap-1 border-b border-brand-800/70">
          {([["overview", "Overview"], ["pools", `NAT Pools (${pools.length})`], ["interfaces", `Interfaces (${interfaces.length})`], ["routes", `Static Routes (${routes.length})`]] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-t-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${tab === id ? "border-b-2 border-primary-500 text-white" : "text-slate-400 hover:text-slate-200"}`}>{label}</button>
          ))}
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
                  {pools.map((p) => (
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
                    <th className={th}>IP Address</th>
                    <th className={th}>VLAN</th>
                    <th className={th}>Admin/Oper</th>
                    <th className={th}>Description</th>
                    <th className={th}>MTU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {interfaces.map((i) => (
                    <tr key={i.id} className="hover:bg-brand-800/40">
                      <td className={cell}>{i.name}</td>
                      <td className={`${cell} font-mono text-xs ${i.ip_address ? "text-primary-200" : "text-slate-500"}`}>{i.ip_address ?? "--"}</td>
                      <td className={cell}>{i.vlan ?? "--"}</td>
                      <td className={cell}>{i.admin_state ?? "--"}/{i.oper_state ?? "--"}</td>
                      <td className={cell}>{i.description ?? "--"}</td>
                      <td className={cell}>{i.mtu ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "routes" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Destination</th>
                    <th className={th}>Next Hop</th>
                    <th className={th}>Family</th>
                    <th className={th}>RD</th>
                    <th className={th}>Distance</th>
                    <th className={th}>Name / Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {routes.map((r) => (
                    <tr key={r.id} className="hover:bg-brand-800/40">
                      <td className={`${cell} font-mono text-xs`}>{r.destination ?? "--"}</td>
                      <td className={`${cell} font-mono text-xs`}>{r.next_hop ?? "--"}</td>
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
