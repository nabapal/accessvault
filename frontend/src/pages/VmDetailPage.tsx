import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CytoscapeComponent from "react-cytoscapejs";
import type { ElementDefinition } from "cytoscape";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchInventoryVm, fetchInventoryVmTopology } from "@/services/inventory";
import { InventoryVirtualMachine, InventoryVmTopology } from "@/types";

type Tab = "overview" | "connectivity" | "networks" | "storage";
const cell = "px-3 py-2 text-slate-100";
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400";

const kindColor: Record<string, string> = {
  vm: "#2dd4bf",
  network: "#a78bfa",
  uplink: "#f59e0b",
  switch: "#3b82f6"
};

export function VmDetailPage() {
  const { vmId } = useParams<{ vmId: string }>();
  const [vm, setVm] = useState<InventoryVirtualMachine | null>(null);
  const [topology, setTopology] = useState<InventoryVmTopology>({ nodes: [], links: [] });
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState<"topology" | "table">("topology");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!vmId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [v, topo] = await Promise.all([fetchInventoryVm(vmId), fetchInventoryVmTopology(vmId)]);
        if (cancelled) return;
        setVm(v);
        setTopology(topo);
      } catch (err) {
        console.error("Failed to load VM detail", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vmId]);

  const elements = useMemo<ElementDefinition[]>(() => {
    const els: ElementDefinition[] = topology.nodes.map((n) => ({
      data: { id: n.id, label: n.label, kind: n.kind }
    }));
    topology.links.forEach((l, i) => {
      els.push({ data: { id: `e${i}`, source: l.source, target: l.target, label: l.label ?? "" } });
    });
    return els;
  }, [topology]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }
  if (!vm) {
    return (
      <AppShell>
        <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">
          Virtual machine not found.
        </div>
      </AppShell>
    );
  }

  const kpi = (label: string, value: React.ReactNode) => (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
  const gb = (v?: number | null) => (v == null ? "--" : `${Math.round(v)} GB`);
  const switchLinks = topology.links.filter((l) => l.source.startsWith("up:") && l.target.startsWith("sw:"));

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={vm.name}
          description={`${vm.guest_os ?? "Unknown OS"} · ${vm.host_name ?? "Unassigned host"} · ${vm.endpoint_name}`}
          actions={
            <Link
              to="/inventory/virtual-machines"
              className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500"
            >
              ← Virtual Machines
            </Link>
          }
        />

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpi("Power", vm.power_state)}
          {kpi("IP", vm.ip_address ?? "--")}
          {kpi("Host", vm.host_name ?? "--")}
          {kpi("vCPU", vm.cpu_count ?? "--")}
          {kpi("Memory", vm.memory_mb ? `${Math.round(vm.memory_mb / 1024)} GB` : "--")}
          {kpi("Switches", switchLinks.length)}
        </section>

        <div className="flex flex-wrap gap-1 border-b border-brand-800/70">
          {(
            [
              ["overview", "Overview"],
              ["connectivity", `Connectivity (${switchLinks.length})`],
              ["networks", `Networks (${vm.networks.length})`],
              ["storage", `Storage (${vm.datastores.length})`]
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                tab === id ? "border-b-2 border-primary-500 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          {tab === "overview" && (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpi("Guest OS", vm.guest_os ?? "--")}
              {kpi("Tools", vm.tools_status ?? "--")}
              {kpi("Collector", vm.endpoint_name)}
              {kpi("CPU usage", vm.cpu_usage_mhz ? `${vm.cpu_usage_mhz} MHz` : "--")}
              {kpi("Memory usage", vm.memory_usage_mb ? `${Math.round(vm.memory_usage_mb / 1024)} GB` : "--")}
              {kpi("Provisioned", gb(vm.provisioned_storage_gb))}
              {kpi("Used", gb(vm.used_storage_gb))}
              {kpi("Networks", vm.networks.length)}
            </div>
          )}

          {tab === "connectivity" && (
            <div>
              <div className="flex items-center justify-end gap-1 border-b border-brand-800/70 p-3">
                {(["topology", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`rounded px-3 py-1 text-xs font-medium capitalize transition ${
                      view === v ? "bg-primary-600 text-white" : "text-slate-300 hover:bg-brand-800"
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              {view === "topology" ? (
                topology.nodes.length <= 1 ? (
                  <p className="p-6 text-center text-sm text-slate-500">
                    No upstream network path resolved. The host's uplinks may not advertise LLDP/CDP, or the host has
                    not been polled since portgroup collection was enabled.
                  </p>
                ) : (
                  <CytoscapeComponent
                    elements={elements}
                    layout={{ name: "breadthfirst", directed: true, roots: "#vm", spacingFactor: 1.3, animate: false } as any}
                    style={{ width: "100%", height: "520px" }}
                    stylesheet={[
                      {
                        selector: "node",
                        style: {
                          "background-color": (n: any) => kindColor[n.data("kind")] ?? "#64748b",
                          label: "data(label)",
                          color: "#e2e8f0",
                          "font-size": 9,
                          width: 26,
                          height: 26,
                          "text-valign": "bottom",
                          "text-margin-y": 4,
                          "text-wrap": "wrap",
                          "text-max-width": "120px"
                        }
                      },
                      { selector: 'node[kind = "network"]', style: { shape: "round-rectangle" } },
                      { selector: 'node[kind = "switch"]', style: { shape: "round-rectangle", width: 30, height: 30 } },
                      {
                        selector: "edge",
                        style: {
                          width: 2,
                          "line-color": "#475569",
                          "target-arrow-color": "#475569",
                          "target-arrow-shape": "triangle",
                          label: "data(label)",
                          "font-size": 7,
                          color: "#94a3b8",
                          "curve-style": "bezier",
                          "text-rotation": "autorotate"
                        }
                      }
                    ]}
                  />
                )
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                    <thead className="sticky top-0 bg-brand-900/90">
                      <tr>
                        <th className={th}>Network</th>
                        <th className={th}>Uplink</th>
                        <th className={th}>Remote Switch</th>
                        <th className={th}>Remote Port</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-800/60">
                      {switchLinks.length === 0 && (
                        <tr>
                          <td className={`${cell} text-slate-500`} colSpan={4}>
                            No switch neighbors resolved on the host uplinks.
                          </td>
                        </tr>
                      )}
                      {switchLinks.map((sl, i) => {
                        const uplink = topology.nodes.find((n) => n.id === sl.source);
                        const sw = topology.nodes.find((n) => n.id === sl.target);
                        const netLink = topology.links.find((l) => l.target === sl.source && l.source.startsWith("net:"));
                        const net = netLink ? topology.nodes.find((n) => n.id === netLink.source) : undefined;
                        return (
                          <tr key={i} className="hover:bg-brand-800/40">
                            <td className={cell}>{net?.label ?? "--"}</td>
                            <td className={cell}>{uplink?.label ?? "--"}</td>
                            <td className={cell}>{sw?.label ?? "--"}</td>
                            <td className={cell}>{sl.label ?? "--"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === "networks" && (
            <div className="max-h-[520px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Network / Portgroup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {vm.networks.length === 0 && (
                    <tr>
                      <td className={`${cell} text-slate-500`}>No networks assigned.</td>
                    </tr>
                  )}
                  {vm.networks.map((n) => (
                    <tr key={n} className="hover:bg-brand-800/40">
                      <td className={cell}>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "storage" && (
            <div className="max-h-[520px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Datastore</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {vm.datastores.length === 0 && (
                    <tr>
                      <td className={`${cell} text-slate-500`}>No datastores attached.</td>
                    </tr>
                  )}
                  {vm.datastores.map((d) => (
                    <tr key={d} className="hover:bg-brand-800/40">
                      <td className={cell}>{d}</td>
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
