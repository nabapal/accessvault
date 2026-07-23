import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { cpnrChangesExportUrl, fetchCpnrChanges, fetchCpnrObjects, fetchCpnrVm } from "@/services/cpnr";
import { pairBadge, pairLabel } from "@/pages/CpnrVmsPage";
import { CpnrChangeEvent, CpnrObject, CpnrVm } from "@/types";

type Tab = "overview" | "scope" | "prefix" | "reservation4" | "reservation6" | "client_entry" | "client_class" | "changes";
const cell = "px-3 py-2 text-slate-100 align-top";
const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400";

const get = (d: Record<string, unknown>, path: string): string => {
  const parts = path.split(".");
  let cur: unknown = d;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return "";
  }
  if (cur == null) return "";
  if (typeof cur === "object") return JSON.stringify(cur);
  return String(cur);
};

const ranges = (d: Record<string, unknown>): string => {
  const items = (d.rangeList as { RangeItem?: { start?: string; end?: string }[] } | undefined)?.RangeItem ?? [];
  return items.map((r) => `${r.start ?? "?"}–${r.end ?? "?"}`).join(", ");
};

// per-type table columns: [header, extractor]
const COLUMNS: Record<string, [string, (d: Record<string, unknown>) => string][]> = {
  scope: [["Subnet", (d) => get(d, "subnet")], ["Ranges", ranges], ["Policy", (d) => get(d, "policy")], ["VPN", (d) => get(d, "vpnId")]],
  prefix: [["Address", (d) => get(d, "address")], ["Range", (d) => get(d, "range")], ["Alloc Group", (d) => get(d, "allocationGroup")], ["Policy", (d) => get(d, "policy")]],
  reservation4: [["Lookup Key", (d) => get(d, "lookupKey")], ["Key Type", (d) => get(d, "lookupKeyType")], ["Scope", (d) => get(d, "scope")], ["VPN", (d) => get(d, "vpnId")]],
  reservation6: [["Lookup Key", (d) => get(d, "lookupKey")], ["Key Type", (d) => get(d, "lookupKeyType")], ["Prefix", (d) => get(d, "prefix")]],
  client_entry: [["Policy", (d) => get(d, "embeddedPolicy.name")]],
  client_class: [["Policy", (d) => get(d, "embeddedPolicy.name")]]
};
const KEY_HEADER: Record<string, string> = {
  scope: "Scope", prefix: "Prefix", reservation4: "IP Address", reservation6: "IPv6 Address",
  client_entry: "Client", client_class: "Client Class"
};

export function CpnrVmDetailPage() {
  const { vmId } = useParams<{ vmId: string }>();
  const [vm, setVm] = useState<CpnrVm | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [objects, setObjects] = useState<CpnrObject[]>([]);
  const [changes, setChanges] = useState<CpnrChangeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);

  useEffect(() => {
    if (!vmId) return;
    let cancelled = false;
    fetchCpnrVm(vmId).then((v) => !cancelled && setVm(v)).catch((e) => console.error(e)).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [vmId]);

  useEffect(() => {
    if (!vmId || tab === "overview") return;
    let cancelled = false;
    setTabLoading(true);
    (async () => {
      try {
        if (tab === "changes") setChanges(await fetchCpnrChanges(vmId));
        else setObjects(await fetchCpnrObjects(vmId, tab));
      } catch (e) { console.error(e); } finally { if (!cancelled) setTabLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [vmId, tab]);

  if (loading) return <AppShell><Skeleton className="h-64 w-full" /></AppShell>;
  if (!vm) return <AppShell><div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">CPNR VM not found.</div></AppShell>;

  const kpi = (label: string, value: React.ReactNode) => (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );

  const tabs: [Tab, string][] = [
    ["overview", "Overview"],
    ["scope", `Scopes (${vm.scope_count ?? 0})`],
    ["prefix", `Prefixes (${vm.prefix_count ?? 0})`],
    ["reservation4", `Res v4 (${vm.reservation4_count ?? 0})`],
    ["reservation6", `Res v6 (${vm.reservation6_count ?? 0})`],
    ["client_entry", `Clients (${vm.client_count ?? 0})`],
    ["client_class", `Client Classes (${vm.client_class_count ?? 0})`],
    ["changes", "Changes"]
  ];

  const cols = tab in COLUMNS ? COLUMNS[tab] : [];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={vm.name}
          description={`${vm.site ?? ""} · ${vm.service ?? ""} · ${vm.role} · ${vm.mgmt_ip}`}
          actions={<Link to="/cpnr/vms" className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500">← All VMs</Link>}
        />

        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpi("Status", vm.status)}
          {kpi("Pair", <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] uppercase ${pairBadge[vm.pair_status]}`}>{pairLabel[vm.pair_status]}</span>)}
          {kpi("Scopes", vm.scope_count ?? "--")}
          {kpi("Prefixes", vm.prefix_count ?? "--")}
          {kpi("Reservations", (vm.reservation4_count ?? 0) + (vm.reservation6_count ?? 0))}
          {kpi("Clients", vm.client_count ?? "--")}
        </section>

        <div className="flex flex-wrap gap-1 border-b border-brand-800/70">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-t-md px-4 py-2 text-sm font-medium transition ${tab === id ? "border-b-2 border-primary-500 text-white" : "text-slate-400 hover:text-slate-200"}`}>{label}</button>
          ))}
        </div>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          {tab === "overview" && (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpi("Service / Role", `${vm.service ?? "--"} / ${vm.role}`)}
              {kpi("Pair ID", vm.pair_id ?? "--")}
              {kpi("Inconsistencies", vm.inconsistency_count ?? "--")}
              {kpi("Version", vm.version ?? "--")}
              {kpi("Poll interval", `${vm.poll_interval_seconds}s`)}
              {kpi("Last error", vm.last_error ?? "--")}
            </div>
          )}

          {tab !== "overview" && tab !== "changes" && (
            <div className="max-h-[600px] overflow-auto">
              {tabLoading ? (
                <div className="p-6"><Skeleton className="h-40 w-full" /></div>
              ) : objects.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">No objects.</p>
              ) : (
                <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                  <thead className="sticky top-0 bg-brand-900/90">
                    <tr>
                      <th className={th}>{KEY_HEADER[tab] ?? "Key"}</th>
                      {cols.map(([h]) => <th key={h} className={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/60">
                    {objects.map((o) => (
                      <tr key={o.id} className="hover:bg-brand-800/40">
                        <td className={`${cell} font-mono text-xs`}>{o.object_key}</td>
                        {cols.map(([h, ex]) => <td key={h} className={`${cell} text-xs`}>{ex(o.data) || "--"}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === "changes" && (
            <div>
              <div className="flex items-center justify-between border-b border-brand-800/70 p-3">
                <span className="text-xs text-slate-400">{changes.length} change events</span>
                <a href={vmId ? cpnrChangesExportUrl(vmId) : "#"} className="rounded border border-brand-700 bg-brand-800/60 px-3 py-1 text-xs text-slate-200 transition hover:border-primary-500">Export log</a>
              </div>
              <div className="max-h-[560px] overflow-auto">
                {tabLoading ? (
                  <div className="p-6"><Skeleton className="h-40 w-full" /></div>
                ) : changes.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">No changes recorded yet.</p>
                ) : (
                  <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                    <thead className="sticky top-0 bg-brand-900/90"><tr><th className={th}>Time</th><th className={th}>Action</th><th className={th}>Type</th><th className={th}>Object</th><th className={th}>Changes</th></tr></thead>
                    <tbody className="divide-y divide-brand-800/60">
                      {changes.map((c) => (
                        <tr key={c.id} className="hover:bg-brand-800/40">
                          <td className={`${cell} text-xs`}>{c.ts}</td>
                          <td className={cell}>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${c.action === "removed" ? "border-rose-500/50 text-rose-200" : c.action === "added" ? "border-emerald-500/50 text-emerald-200" : "border-amber-500/50 text-amber-200"}`}>{c.action}</span>
                          </td>
                          <td className={`${cell} text-xs`}>{c.object_type}</td>
                          <td className={`${cell} font-mono text-xs`}>{c.object_key}</td>
                          <td className={`${cell} text-xs`}>{c.changes?.map((ch) => `${ch.field}: ${String(ch.old)} → ${String(ch.new)}`).join("; ") || "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
