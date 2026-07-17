import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CytoscapeComponent from "react-cytoscapejs";
import type { ElementDefinition } from "cytoscape";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  fetchInventoryDatastores,
  fetchInventoryHost,
  fetchInventoryHostNics,
  fetchInventoryNetworks,
  fetchInventoryVirtualMachines
} from "@/services/inventory";
import {
  InventoryDatastore,
  InventoryHost,
  InventoryHostNic,
  InventoryNetwork,
  InventoryVirtualMachine
} from "@/types";

type Tab = "overview" | "uplinks" | "vms" | "datastores" | "networks";
const cell = "px-3 py-2 text-slate-100";
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400";

export function HostDetailPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const [host, setHost] = useState<InventoryHost | null>(null);
  const [nics, setNics] = useState<InventoryHostNic[]>([]);
  const [vms, setVms] = useState<InventoryVirtualMachine[]>([]);
  const [datastores, setDatastores] = useState<InventoryDatastore[]>([]);
  const [networks, setNetworks] = useState<InventoryNetwork[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [uplinkView, setUplinkView] = useState<"topology" | "table">("topology");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!hostId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const h = await fetchInventoryHost(hostId);
        const [n, v, d, net] = await Promise.all([
          fetchInventoryHostNics(hostId),
          fetchInventoryVirtualMachines({ hostId }),
          fetchInventoryDatastores(h.endpoint_id),
          fetchInventoryNetworks(h.endpoint_id)
        ]);
        if (cancelled) return;
        setHost(h); setNics(n); setVms(v); setDatastores(d); setNetworks(net);
      } catch (err) {
        console.error("Failed to load host detail", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hostId]);

  const elements = useMemo<ElementDefinition[]>(() => {
    if (!host) return [];
    const els: ElementDefinition[] = [
      { data: { id: "host", label: host.name, kind: "host" } }
    ];
    const switches = new Set<string>();
    nics.forEach((nic, i) => {
      if (!nic.remote_device) return;
      const sw = `sw:${nic.remote_device}`;
      if (!switches.has(sw)) {
        switches.add(sw);
        els.push({ data: { id: sw, label: nic.remote_device, kind: "switch" } });
      }
      els.push({
        data: {
          id: `e${i}`,
          source: "host",
          target: sw,
          label: `${nic.device} → ${nic.remote_port ?? ""} (${(nic.neighbor_protocol ?? "").toUpperCase()})`
        }
      });
    });
    return els;
  }, [host, nics]);

  if (isLoading) {
    return <AppShell><div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div></AppShell>;
  }
  if (!host) {
    return <AppShell><div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">Host not found.</div></AppShell>;
  }

  const kpi = (label: string, value: React.ReactNode) => (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
  const gb = (v?: number | null) => (v == null ? "--" : `${Math.round(v)} GB`);
  const neighborNics = nics.filter((n) => n.remote_device);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={host.name}
          description={`${host.vendor ?? ""} ${host.hardware_model ?? ""} · ${host.endpoint_name}`.trim()}
          actions={<Link to="/inventory" className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500">← Inventory</Link>}
        />

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpi("Mgmt IP", host.management_ip ?? host.name)}
          {kpi("Vendor / Model", `${host.vendor ?? "--"} ${host.hardware_model ?? ""}`.trim())}
          {kpi("CPU", host.cpu_cores ? `${host.cpu_cores} cores` : "--")}
          {kpi("Memory", host.memory_total_mb ? `${Math.round(host.memory_total_mb / 1024)} GB` : "--")}
          {kpi("ESXi", host.esxi_version ?? "--")}
          {kpi("Uptime", host.uptime_seconds ? `${Math.floor(host.uptime_seconds / 86400)}d` : "--")}
        </section>

        <div className="flex flex-wrap gap-1 border-b border-brand-800/70">
          {([["overview", "Overview"], ["uplinks", `Uplinks & Neighbors (${nics.length})`], ["vms", `Virtual Machines (${vms.length})`], ["datastores", `Datastores (${datastores.length})`], ["networks", `Networks (${networks.length})`]] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-t-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${tab === id ? "border-b-2 border-primary-500 text-white" : "text-slate-400 hover:text-slate-200"}`}>{label}</button>
          ))}
        </div>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          {tab === "overview" && (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpi("Serial", host.serial ?? "--")}
              {kpi("CPU model", host.cpu_model ?? "--")}
              {kpi("BIOS", host.bios_version ?? "--")}
              {kpi("Cluster", host.cluster ?? "--")}
              {kpi("Site / Rack", `${host.site_name ?? "--"} / ${host.rack_location ?? "--"}`)}
              {kpi("Connection", host.connection_state)}
              {kpi("Datastore", `${gb(host.datastore_free_gb)} free / ${gb(host.datastore_total_gb)}`)}
              {kpi("Uplinks w/ neighbor", `${neighborNics.length} / ${nics.length}`)}
            </div>
          )}

          {tab === "uplinks" && (
            <div>
              <div className="flex items-center justify-end gap-1 border-b border-brand-800/70 p-3">
                {(["topology", "table"] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setUplinkView(v)} className={`rounded px-3 py-1 text-xs font-medium capitalize transition ${uplinkView === v ? "bg-primary-600 text-white" : "text-slate-300 hover:bg-brand-800"}`}>{v}</button>
                ))}
              </div>
              {uplinkView === "topology" ? (
                neighborNics.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">No LLDP/CDP neighbors advertised on this host's uplinks.</p>
                ) : (
                  <CytoscapeComponent
                    elements={elements}
                    layout={{ name: "concentric", concentric: (n: any) => (n.data("kind") === "host" ? 2 : 1), minNodeSpacing: 60, animate: false } as any}
                    style={{ width: "100%", height: "460px" }}
                    stylesheet={[
                      { selector: 'node[kind = "host"]', style: { "background-color": "#2dd4bf", label: "data(label)", color: "#e2e8f0", "font-size": 10, width: 30, height: 30, "text-valign": "bottom", "text-margin-y": 4 } },
                      { selector: 'node[kind = "switch"]', style: { "background-color": "#3b82f6", shape: "round-rectangle", label: "data(label)", color: "#e2e8f0", "font-size": 9, width: 26, height: 26, "text-valign": "bottom", "text-margin-y": 4 } },
                      { selector: "edge", style: { width: 2, "line-color": "#475569", label: "data(label)", "font-size": 7, color: "#94a3b8", "curve-style": "bezier", "text-rotation": "autorotate" } }
                    ]}
                  />
                )
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                    <thead className="sticky top-0 bg-brand-900/90">
                      <tr>
                        <th className={th}>Uplink</th>
                        <th className={th}>Speed</th>
                        <th className={th}>Proto</th>
                        <th className={th}>Remote Switch</th>
                        <th className={th}>Remote Port</th>
                        <th className={th}>Platform</th>
                        <th className={th}>Mgmt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-800/60">
                      {nics.map((n) => (
                        <tr key={n.id} className="hover:bg-brand-800/40">
                          <td className={cell}>{n.device}<div className="text-xs text-slate-500">{n.mac ?? ""}</div></td>
                          <td className={cell}>{n.speed_mb ? `${n.speed_mb} Mb` : "down"}</td>
                          <td className={cell}>{n.neighbor_protocol ? <span className="rounded border border-brand-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">{n.neighbor_protocol}</span> : "--"}</td>
                          <td className={cell}>{n.remote_device ?? "--"}</td>
                          <td className={cell}>{n.remote_port ?? "--"}</td>
                          <td className={cell}>{n.remote_platform ?? "--"}</td>
                          <td className={`${cell} font-mono text-xs`}>{n.remote_mgmt ?? "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "vms" && (
            <div className="max-h-[520px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90"><tr><th className={th}>VM</th><th className={th}>Power</th><th className={th}>Guest OS</th><th className={th}>IP</th></tr></thead>
                <tbody className="divide-y divide-brand-800/60">
                  {vms.map((v) => (
                    <tr key={v.id} className="hover:bg-brand-800/40">
                      <td className={cell}>{v.name}</td>
                      <td className={cell}>{v.power_state}</td>
                      <td className={cell}>{v.guest_os ?? "--"}</td>
                      <td className={`${cell} font-mono text-xs`}>{v.ip_address ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "datastores" && (
            <div className="max-h-[520px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90"><tr><th className={th}>Datastore</th><th className={th}>Type</th><th className={th}>Capacity</th><th className={th}>Free</th></tr></thead>
                <tbody className="divide-y divide-brand-800/60">
                  {datastores.map((d) => (
                    <tr key={d.id} className="hover:bg-brand-800/40">
                      <td className={cell}>{d.name}</td>
                      <td className={cell}>{d.type ?? "--"}</td>
                      <td className={cell}>{gb(d.capacity_gb)}</td>
                      <td className={cell}>{gb(d.free_gb)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "networks" && (
            <div className="max-h-[520px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90"><tr><th className={th}>Network</th></tr></thead>
                <tbody className="divide-y divide-brand-800/60">
                  {networks.map((nw) => (
                    <tr key={nw.id} className="hover:bg-brand-800/40"><td className={cell}>{nw.name}</td></tr>
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
