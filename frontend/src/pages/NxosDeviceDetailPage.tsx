import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  fetchNxosDevice,
  fetchNxosDeviceBgp,
  fetchNxosDeviceInterfaces,
  fetchNxosDeviceModules,
  fetchNxosDeviceNeighbors,
  fetchNxosDeviceVrfs
} from "@/services/nxos";
import { locationFromName } from "@/utils/location";
import {
  NxosBgpNeighbor,
  NxosDevice,
  NxosInterface,
  NxosModule,
  NxosNeighbor,
  NxosVrf
} from "@/types";

type Tab = "overview" | "interfaces" | "vrfs" | "neighbors" | "bgp" | "hardware";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "interfaces", label: "Interfaces" },
  { id: "vrfs", label: "VRFs" },
  { id: "neighbors", label: "Neighbors (CDP/LLDP)" },
  { id: "bgp", label: "BGP" },
  { id: "hardware", label: "Hardware" }
];

const cell = "px-3 py-2 text-slate-100";
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400";

export function NxosDeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<NxosDevice | null>(null);
  const [interfaces, setInterfaces] = useState<NxosInterface[]>([]);
  const [modules, setModules] = useState<NxosModule[]>([]);
  const [vrfs, setVrfs] = useState<NxosVrf[]>([]);
  const [neighbors, setNeighbors] = useState<NxosNeighbor[]>([]);
  const [bgp, setBgp] = useState<NxosBgpNeighbor[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [ifFilter, setIfFilter] = useState("");
  const [nbrProto, setNbrProto] = useState<"all" | "cdp" | "lldp">("all");

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const [d, i, m, v, n, b] = await Promise.all([
          fetchNxosDevice(deviceId),
          fetchNxosDeviceInterfaces(deviceId),
          fetchNxosDeviceModules(deviceId),
          fetchNxosDeviceVrfs(deviceId),
          fetchNxosDeviceNeighbors(deviceId),
          fetchNxosDeviceBgp(deviceId)
        ]);
        if (cancelled) return;
        setDevice(d);
        setInterfaces(i);
        setModules(m);
        setVrfs(v);
        setNeighbors(n);
        setBgp(b);
      } catch (err) {
        console.error("Failed to load NX-OS device", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  const filteredIfs = useMemo(() => {
    const q = ifFilter.trim().toLowerCase();
    if (!q) return interfaces;
    return interfaces.filter((i) => `${i.name} ${i.description ?? ""} ${i.ip_address ?? ""} ${i.vrf ?? ""}`.toLowerCase().includes(q));
  }, [interfaces, ifFilter]);

  const filteredNbrs = useMemo(
    () => (nbrProto === "all" ? neighbors : neighbors.filter((n) => n.protocol === nbrProto)),
    [neighbors, nbrProto]
  );

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

  if (!device) {
    return (
      <AppShell>
        <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">Device not found.</div>
      </AppShell>
    );
  }

  const kpi = (label: string, value: React.ReactNode) => (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={device.hostname || device.name}
          description={`${device.mgmt_ip} · ${locationFromName(device.hostname || device.name)}`}
          actions={
            <Link to="/nxos/devices" className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500">
              ← All devices
            </Link>
          }
        />

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpi("Status", device.status)}
          {kpi("Role", device.role ?? "--")}
          {kpi("Model", device.model ?? "--")}
          {kpi("Serial", device.serial ?? "--")}
          {kpi("OS", device.os_version ?? "--")}
          {kpi("Uptime", device.uptime_text ?? "--")}
        </section>

        <div className="flex flex-wrap gap-1 border-b border-brand-800/70">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                tab === t.id ? "border-b-2 border-primary-500 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
              {t.id === "interfaces" ? ` (${interfaces.length})` : ""}
              {t.id === "vrfs" ? ` (${vrfs.length})` : ""}
              {t.id === "neighbors" ? ` (${neighbors.length})` : ""}
              {t.id === "bgp" ? ` (${bgp.length})` : ""}
            </button>
          ))}
        </div>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          {tab === "overview" && (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpi("Interfaces", interfaces.length)}
              {kpi("Interfaces Up", interfaces.filter((i) => (i.oper_state ?? "").toLowerCase() === "up").length)}
              {kpi("VRFs", vrfs.length)}
              {kpi("CDP/LLDP Neighbors", neighbors.length)}
              {kpi("BGP Neighbors", bgp.length)}
              {kpi("Modules", modules.length)}
              {kpi("Site / Rack", `${device.site_name ?? "--"} / ${device.rack_location ?? "--"}`)}
              {kpi("Mgmt IP", device.mgmt_ip)}
            </div>
          )}

          {tab === "interfaces" && (
            <div>
              <div className="border-b border-brand-800/70 p-3">
                <input
                  type="search"
                  value={ifFilter}
                  onChange={(e) => setIfFilter(e.target.value)}
                  placeholder="Filter interfaces…"
                  className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 sm:w-72"
                />
              </div>
              <div className="max-h-[560px] overflow-auto">
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="sticky top-0 bg-brand-900/90">
                    <tr>
                      <th className={th}>Interface</th>
                      <th className={th}>Admin/Oper</th>
                      <th className={th}>IP</th>
                      <th className={th}>VRF</th>
                      <th className={th}>Mode</th>
                      <th className={th}>Speed</th>
                      <th className={th}>MTU</th>
                      <th className={th}>PC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60">
                    {filteredIfs.map((i) => (
                      <tr key={i.id} className="hover:bg-brand-800/40">
                        <td className={cell}>
                          {i.name}
                          {i.description ? <div className="text-xs text-slate-500">{i.description}</div> : null}
                        </td>
                        <td className={cell}>
                          <span className={(i.oper_state ?? "").toLowerCase() === "up" ? "text-emerald-300" : "text-slate-400"}>
                            {i.admin_state ?? "--"}/{i.oper_state ?? "--"}
                          </span>
                        </td>
                        <td className={`${cell} font-mono text-xs`}>{i.ip_address ? `${i.ip_address}/${i.prefix_len ?? ""}` : "--"}</td>
                        <td className={cell}>{i.vrf ?? "--"}</td>
                        <td className={cell}>{i.mode ?? "--"}</td>
                        <td className={cell}>{i.speed ?? "--"}</td>
                        <td className={cell}>{i.mtu ?? "--"}</td>
                        <td className={cell}>{i.port_channel ?? "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "vrfs" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>VRF</th>
                    <th className={th}>RD</th>
                    <th className={th}>State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {vrfs.map((v) => (
                    <tr key={v.id} className="hover:bg-brand-800/40">
                      <td className={cell}>{v.name}</td>
                      <td className={`${cell} font-mono text-xs`}>{v.rd ?? "--"}</td>
                      <td className={cell}>{v.state ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "neighbors" && (
            <div>
              <div className="flex gap-1 border-b border-brand-800/70 p-3 text-xs font-medium">
                {(["all", "cdp", "lldp"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setNbrProto(p)}
                    className={`rounded px-3 py-1 uppercase transition ${nbrProto === p ? "bg-primary-600 text-white" : "text-slate-300 hover:bg-brand-800"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="max-h-[560px] overflow-auto">
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="sticky top-0 bg-brand-900/90">
                    <tr>
                      <th className={th}>Proto</th>
                      <th className={th}>Local Intf</th>
                      <th className={th}>Remote Device</th>
                      <th className={th}>Remote Intf</th>
                      <th className={th}>Platform</th>
                      <th className={th}>Mgmt IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60">
                    {filteredNbrs.map((n) => (
                      <tr key={n.id} className="hover:bg-brand-800/40">
                        <td className={cell}>
                          <span className="rounded border border-brand-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">{n.protocol}</span>
                        </td>
                        <td className={cell}>{n.local_interface ?? "--"}</td>
                        <td className={cell}>{n.remote_device ?? "--"}</td>
                        <td className={cell}>{n.remote_interface ?? "--"}</td>
                        <td className={cell}>{n.remote_platform ?? "--"}</td>
                        <td className={`${cell} font-mono text-xs`}>{n.remote_mgmt_ip ?? "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "bgp" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Neighbor</th>
                    <th className={th}>VRF</th>
                    <th className={th}>AF</th>
                    <th className={th}>Remote AS</th>
                    <th className={th}>State</th>
                    <th className={th}>Pfx Rcvd</th>
                    <th className={th}>Uptime</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {bgp.map((b) => (
                    <tr key={b.id} className="hover:bg-brand-800/40">
                      <td className={`${cell} font-mono text-xs`}>{b.neighbor_ip}</td>
                      <td className={cell}>{b.vrf ?? "--"}</td>
                      <td className={cell}>{b.address_family ?? "--"}</td>
                      <td className={cell}>{b.remote_as ?? "--"}</td>
                      <td className={cell}>
                        <span className={(b.state ?? "").toLowerCase() === "established" ? "text-emerald-300" : "text-amber-300"}>
                          {b.state ?? "--"}
                        </span>
                      </td>
                      <td className={cell}>{b.prefixes_received ?? "--"}</td>
                      <td className={cell}>{b.uptime ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "hardware" && (
            <div className="max-h-[560px] overflow-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="sticky top-0 bg-brand-900/90">
                  <tr>
                    <th className={th}>Slot / Name</th>
                    <th className={th}>Description</th>
                    <th className={th}>PID</th>
                    <th className={th}>Serial</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60">
                  {modules.map((m) => (
                    <tr key={m.id} className="hover:bg-brand-800/40">
                      <td className={cell}>{m.slot ?? m.name ?? "--"}</td>
                      <td className={cell}>{m.description ?? "--"}</td>
                      <td className={cell}>{m.pid ?? "--"}</td>
                      <td className={`${cell} font-mono text-xs`}>{m.serial ?? "--"}</td>
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
