import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { fetchIpMplsSummary } from "@/services/ipmpls";
import { locationLabelFromCode } from "@/utils/location";
import { IpMplsSummary } from "@/types";

// A single row in a breakdown card: label + count + proportional bar.
function BreakdownRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-40 shrink-0 truncate text-sm text-slate-200" title={label}>
        {label}
      </span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-brand-800/70">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right text-sm tabular-nums text-slate-300">
        {count}
        <span className="ml-1 text-xs text-slate-500">{pct}%</span>
      </span>
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  total,
  color = "bg-primary-500",
  labelFn
}: {
  title: string;
  data: Record<string, number>;
  total: number;
  color?: string;
  labelFn?: (key: string) => string;
}) {
  const rows = useMemo(
    () =>
      Object.entries(data)
        .map(([key, count]) => ({ key, label: labelFn ? labelFn(key) : key, count }))
        .sort((a, b) => b.count - a.count),
    [data, labelFn]
  );

  return (
    <section className="rounded-lg border border-brand-700 bg-brand-900/60">
      <div className="flex items-center justify-between border-b border-brand-800/70 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <span className="text-xs text-slate-500">{rows.length} groups</span>
      </div>
      <div className="px-4 py-3">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No data.</p>
        ) : (
          rows.map((r) => <BreakdownRow key={r.key} label={r.label} count={r.count} total={total} color={color} />)
        )}
      </div>
    </section>
  );
}

const KPI_TONE: Record<string, string> = {
  default: "text-white",
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300"
};

function Kpi({ label, value, hint, tone = "default" }: { label: string; value: number; hint?: string; tone?: keyof typeof KPI_TONE }) {
  return (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${KPI_TONE[tone]}`}>{value.toLocaleString()}</p>
      {hint ? <p className="mt-1 text-[13px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function IpMplsSummaryPage() {
  const [summary, setSummary] = useState<IpMplsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchIpMplsSummary();
        if (!cancelled) {
          setSummary(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load IP-MPLS summary", err);
          setError("Unable to load IP-MPLS summary. Please retry.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-white">IP-MPLS Summary</h1>
          <p className="mt-1 text-sm text-slate-300">
            Fleet-wide rollup across location, role, platform, model, OS, and routing footprint.
          </p>
        </header>

        {error ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        {isLoading || !summary ? (
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-8 text-center text-sm text-slate-400">
            {isLoading ? "Loading IP-MPLS summary…" : "No summary data."}
          </div>
        ) : (
          <>
            {/* Scale + health KPIs */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Devices" value={summary.total} hint="Onboarded IP-MPLS devices" />
              <Kpi label="Interfaces" value={summary.total_interfaces} hint={`${summary.interfaces_up} up · ${summary.mpls_interfaces} MPLS-enabled`} />
              <Kpi label="VRFs" value={summary.total_vrfs} hint="Total VRFs across the fleet" />
              <Kpi label="Neighbors" value={summary.total_neighbors} hint="IGP/LDP/BGP adjacencies" />
              <Kpi label="MPLS Interfaces" value={summary.mpls_interfaces} hint="Interfaces with MPLS enabled" tone="good" />
              <Kpi label="Interfaces Up" value={summary.interfaces_up} hint="Operational (oper up)" tone="good" />
              <Kpi
                label="Devices in Error"
                value={summary.error_devices}
                hint="Last poll failed"
                tone={summary.error_devices > 0 ? "bad" : "good"}
              />
              <Kpi
                label="Stale Devices"
                value={summary.stale_devices}
                hint="Not polled within 2× interval"
                tone={summary.stale_devices > 0 ? "warn" : "good"}
              />
            </section>

            {/* Dimension breakdowns */}
            <section className="grid gap-4 lg:grid-cols-2">
              <BreakdownCard
                title="By Location"
                data={summary.by_location}
                total={summary.total}
                color="bg-primary-500"
                labelFn={locationLabelFromCode}
              />
              <BreakdownCard title="By Role" data={summary.by_role} total={summary.total} color="bg-violet-500" />
              <BreakdownCard title="By Platform" data={summary.by_platform} total={summary.total} color="bg-blue-500" />
              <BreakdownCard title="By Model" data={summary.by_model} total={summary.total} color="bg-cyan-500" />
              <BreakdownCard title="By OS Version" data={summary.by_os} total={summary.total} color="bg-teal-500" />
              <BreakdownCard title="By Status" data={summary.by_status} total={summary.total} color="bg-amber-500" />
              <BreakdownCard
                title="Neighbors by Protocol"
                data={summary.by_neighbor_protocol}
                total={summary.total_neighbors}
                color="bg-emerald-500"
                labelFn={(k) => k.toUpperCase()}
              />
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
