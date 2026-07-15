import { useEffect, useMemo, useState } from "react";
import {
  ArrowsRightLeftIcon,
  CircleStackIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  ServerIcon,
  SignalIcon,
  UsersIcon
} from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { CHART_PALETTE, Donut, DonutLegend } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTileSkeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { toast } from "@/components/ui/toast";
import { fetchCgnatSummary } from "@/services/cgnat";
import { locationLabelFromCode } from "@/utils/location";
import { CgnatSummary } from "@/types";

function Breakdown({ title, data, total, color, labelFn }: { title: string; data: Record<string, number>; total: number; color: string; labelFn?: (k: string) => string }) {
  const rows = useMemo(() => Object.entries(data).map(([k, v]) => ({ k, label: labelFn ? labelFn(k) : k, v })).sort((a, b) => b.v - a.v), [data, labelFn]);
  return (
    <section className="rounded-lg border border-brand-700 bg-brand-900/60">
      <div className="border-b border-brand-800/70 px-4 py-3"><h2 className="text-sm font-semibold text-slate-100">{title}</h2></div>
      <div className="px-4 py-3">
        {rows.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No data.</p> : rows.map((r) => {
          const pct = total > 0 ? Math.round((r.v / total) * 100) : 0;
          return (
            <div key={r.k} className="flex items-center gap-3 py-1.5">
              <span className="w-36 shrink-0 truncate text-sm text-slate-200" title={r.label}>{r.label}</span>
              <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-brand-800/70"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, r.v > 0 ? 4 : 0)}%` }} /></div>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums text-slate-300">{r.v}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CgnatSummaryPage() {
  const [summary, setSummary] = useState<CgnatSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchCgnatSummary();
        if (!cancelled) { setSummary(data); setError(null); }
      } catch (err) {
        if (!cancelled) { console.error(err); setError("Unable to load CGNAT summary."); toast.error("Failed to load summary"); }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title="CGNAT Summary" description="A10 Thunder and F5 BIG-IP CGNAT gateways — pools, sessions, translations, and exhaustion." />
        {isLoading ? (
          <StatTileSkeleton count={8} />
        ) : error ? (
          <EmptyState icon={ExclamationTriangleIcon} title="Couldn't load the summary" description={error} />
        ) : !summary || summary.total === 0 ? (
          <EmptyState icon={ServerIcon} title="No CGNAT devices yet" description="Onboard A10 / F5 devices from Admin → CGNAT Devices." />
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Devices" value={summary.total} icon={ServerIcon} />
              <StatTile label="NAT / LSN Pools" value={summary.total_pools} icon={CircleStackIcon} />
              <StatTile label="Public IP ranges" value={summary.total_public_ips} icon={GlobeAltIcon} />
              <StatTile label="Active Sessions" value={summary.active_sessions} icon={SignalIcon} tone="good" />
              <StatTile label="Translations" value={summary.total_translations} icon={ArrowsRightLeftIcon} />
              <StatTile label="Subscribers (A10)" value={summary.total} hint="see device detail" icon={UsersIcon} />
              <StatTile label="Exhaustion Events" value={summary.exhaustion_events} tone={summary.exhaustion_events > 0 ? "warn" : "good"} icon={ExclamationTriangleIcon} />
              <StatTile label="Devices in Error" value={summary.error_devices} tone={summary.error_devices > 0 ? "bad" : "good"} icon={ExclamationTriangleIcon} />
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4 lg:col-span-1">
                <h2 className="mb-3 text-sm font-semibold text-slate-100">By Vendor</h2>
                {(() => {
                  const slices = Object.entries(summary.by_vendor).map(([label, value], i) => ({ label: label.toUpperCase(), value, color: CHART_PALETTE[i % CHART_PALETTE.length] }));
                  return <div className="flex items-center gap-4"><Donut data={slices} size={150} centerValue={summary.total} centerLabel="devices" /><div className="min-w-0 flex-1"><DonutLegend data={slices} /></div></div>;
                })()}
              </div>
              <Breakdown title="By Location" data={summary.by_location} total={summary.total} color="bg-primary-500" labelFn={locationLabelFromCode} />
              <Breakdown title="By Role" data={summary.by_role} total={summary.total} color="bg-violet-500" />
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
