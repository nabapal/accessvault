import { useEffect, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchCpnrPairComparison, fetchCpnrPairs } from "@/services/cpnr";
import { pairBadge, pairLabel } from "@/pages/CpnrVmsPage";
import { CpnrPairComparison, CpnrPairSummary } from "@/types";

const TYPE_LABEL: Record<string, string> = {
  scope: "Scopes", prefix: "Prefixes", reservation4: "Reservations v4",
  reservation6: "Reservations v6", client_entry: "Clients", client_class: "Client Classes"
};

export function CpnrPairComparisonPage() {
  const [pairs, setPairs] = useState<CpnrPairSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<CpnrPairComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCpnrPairs()
      .then((p) => { if (cancelled) return; setPairs(p); if (p.length && !selected) setSelected(p[0].pair_id); })
      .catch((e) => console.error(e))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setReportLoading(true);
    fetchCpnrPairComparison(selected)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => console.error(e))
      .finally(() => !cancelled && setReportLoading(false));
    return () => { cancelled = true; };
  }, [selected]);

  const th = "px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-400";
  const cell = "px-3 py-2 text-slate-100 align-top text-xs";

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader title="CPNR Pair Comparison" description="Verify that a primary/secondary pair holds identical DHCP config; drift is flagged per object." />
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : pairs.length === 0 ? (
          <div className="rounded border border-brand-700 bg-brand-900/60 p-6 text-center text-sm text-slate-400">No primary/secondary pairs onboarded.</div>
        ) : (
          <>
            <section className="rounded-lg border border-brand-700 bg-brand-900/60">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="bg-brand-900/70"><tr><th className={th}>Pair</th><th className={th}>Site</th><th className={th}>Primary</th><th className={th}>Secondary</th><th className={th}>Consistency</th><th className={th}></th></tr></thead>
                <tbody className="divide-y divide-brand-800/60">
                  {pairs.map((p) => (
                    <tr key={p.pair_id} className={`hover:bg-brand-800/40 ${selected === p.pair_id ? "bg-brand-800/50" : ""}`}>
                      <td className={cell}>{p.service ?? p.pair_id}</td>
                      <td className={cell}>{p.site ?? "--"}</td>
                      <td className={`${cell} font-mono`}>{p.primary?.mgmt_ip ?? "--"}</td>
                      <td className={`${cell} font-mono`}>{p.secondary?.mgmt_ip ?? "--"}</td>
                      <td className={cell}>
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-[11px] uppercase ${pairBadge[p.pair_status]}`}>
                          {pairLabel[p.pair_status]}{p.pair_status === "drift" && p.inconsistency_count ? ` (${p.inconsistency_count})` : ""}
                        </span>
                      </td>
                      <td className={cell}>
                        <button type="button" onClick={() => setSelected(p.pair_id)} className="rounded border border-brand-700 bg-brand-800/60 px-2 py-1 text-xs text-slate-200 transition hover:border-primary-500">Compare</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {selected && (
              <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
                {reportLoading || !report ? (
                  <Skeleton className="h-40 w-full" />
                ) : (
                  <>
                    <div className="mb-4 flex items-center gap-3">
                      <h3 className="text-sm font-semibold text-slate-100">
                        {String(report.primary.name)} ↔ {String(report.secondary.name)}
                      </h3>
                      <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] uppercase ${report.in_sync ? pairBadge.in_sync : pairBadge.drift}`}>
                        {report.in_sync ? "in sync" : `drift (${report.inconsistency_count})`}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                        <thead className="bg-brand-900/70"><tr><th className={th}>Object Type</th><th className={th}>Primary</th><th className={th}>Secondary</th><th className={th}>Only Primary</th><th className={th}>Only Secondary</th><th className={th}>Value Mismatch</th></tr></thead>
                        <tbody className="divide-y divide-brand-800/60">
                          {Object.entries(report.by_type).map(([t, r]) => {
                            const clean = r.inconsistency_count === 0;
                            return (
                              <tr key={t} className={clean ? "" : "bg-rose-500/5"}>
                                <td className={cell}>{TYPE_LABEL[t] ?? t}</td>
                                <td className={cell}>{r.primary_count}</td>
                                <td className={cell}>{r.secondary_count}</td>
                                <td className={cell}>{r.only_primary.length ? <span className="text-rose-300">{r.only_primary.slice(0, 10).join(", ")}{r.only_primary.length > 10 ? " …" : ""}</span> : "0"}</td>
                                <td className={cell}>{r.only_secondary.length ? <span className="text-rose-300">{r.only_secondary.slice(0, 10).join(", ")}{r.only_secondary.length > 10 ? " …" : ""}</span> : "0"}</td>
                                <td className={cell}>{r.mismatched.length ? <span className="text-amber-300">{r.mismatched.map((m) => m.key).slice(0, 10).join(", ")}{r.mismatched.length > 10 ? " …" : ""}</span> : "0"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
