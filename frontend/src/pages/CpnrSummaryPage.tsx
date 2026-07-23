import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchCpnrSummary } from "@/services/cpnr";
import { CpnrSummary } from "@/types";

const tile = "rounded-lg border border-brand-800 bg-brand-900/70 p-4";

export function CpnrSummaryPage() {
  const [summary, setSummary] = useState<CpnrSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCpnrSummary()
      .then((d) => !cancelled && setSummary(d))
      .catch((e) => console.error(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const kpi = (label: string, value: React.ReactNode, hint?: string, tone?: string) => (
    <div className={tile}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone ?? "text-primary-100"}`}>{value}</p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );

  const breakdown = (title: string, data: Record<string, number>) => (
    <div className="rounded-lg border border-brand-800/70 bg-brand-900/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-200">{title}</h3>
      <div className="space-y-1 text-sm">
        {Object.keys(data).length === 0 && <p className="text-slate-500">No data</p>}
        {Object.entries(data)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-slate-300">{k}</span>
              <span className="tabular-nums text-slate-100">{v}</span>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="CPNR Summary"
          description="Cisco Prime Network Registrar (DHCP) VMs, primary/secondary pairs, and config consistency."
          actions={
            <Link to="/cpnr/pairs" className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500">
              Pair Comparison →
            </Link>
          }
        />
        {loading || !summary ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {kpi("CPNR VMs", summary.total_vms)}
              {kpi("Pairs", summary.total_pairs)}
              {kpi("Pairs In-Sync", summary.pairs_in_sync, "identical config", "text-emerald-300")}
              {kpi("Pairs Drift", summary.pairs_drift, "config mismatch", summary.pairs_drift > 0 ? "text-rose-300" : "text-slate-300")}
              {kpi("Scopes", summary.total_scopes.toLocaleString())}
              {kpi("Prefixes (v6)", summary.total_prefixes.toLocaleString())}
              {kpi("Reservations", summary.total_reservations.toLocaleString(), "v4 + v6")}
              {kpi("VMs in Error", summary.error_vms, undefined, summary.error_vms > 0 ? "text-amber-300" : "text-slate-300")}
            </section>
            <section className="grid gap-4 lg:grid-cols-3">
              {breakdown("By Site", summary.by_site)}
              {breakdown("By Service", summary.by_service)}
              {breakdown("By Status", summary.by_status)}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
