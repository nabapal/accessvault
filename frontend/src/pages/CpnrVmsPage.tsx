import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ServerIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableRowsSkeleton } from "@/components/ui/Skeleton";
import { fetchCpnrVms } from "@/services/cpnr";
import { parseApiDate } from "@/utils/datetime";
import { CpnrPairStatus, CpnrVm } from "@/types";

const statusBadge: Record<string, string> = {
  ok: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  error: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  pending: "border-slate-500/50 bg-slate-500/15 text-slate-200"
};

export const pairBadge: Record<CpnrPairStatus, string> = {
  in_sync: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  drift: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  single: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  unknown: "border-amber-500/50 bg-amber-500/15 text-amber-200"
};
export const pairLabel: Record<CpnrPairStatus, string> = {
  in_sync: "in sync",
  drift: "drift",
  single: "single",
  unknown: "not compared"
};

const fmtDate = (v?: string | null) => {
  if (!v) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(parseApiDate(v));
  } catch {
    return v;
  }
};

export function CpnrVmsPage() {
  const [vms, setVms] = useState<CpnrVm[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCpnrVms({ search: search || undefined, page, pageSize: 50 })
      .then((p) => {
        if (cancelled) return;
        setVms(p.items);
        setTotal(p.total);
        setHasPrev(p.has_prev);
        setHasNext(p.has_next);
      })
      .catch((e) => console.error(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [search, page]);

  const th = "px-4 py-3 text-left text-xs uppercase tracking-wide text-slate-400";
  const cell = "px-4 py-3 text-slate-100";

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="CPNR VMs"
          description="DHCP config inventory per CPNR VM, grouped by service pair."
          actions={
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, IP, site, service, status..."
              className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none sm:w-96"
            />
          }
        />
        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70">
                <tr>
                  <th className={th}>VM</th>
                  <th className={th}>Site</th>
                  <th className={th}>Service</th>
                  <th className={th}>Role</th>
                  <th className={th}>Mgmt IP</th>
                  <th className={th}>Objects (S/P/R4/R6/C/CC)</th>
                  <th className={th}>Pair</th>
                  <th className={th}>Status</th>
                  <th className={th}>Last Poll</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60">
                {loading ? (
                  <TableRowsSkeleton rows={6} cols={9} />
                ) : vms.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-6"><EmptyState icon={ServerIcon} title="No CPNR VMs" description="Onboard VMs under Admin → CPNR VMs." /></td></tr>
                ) : (
                  vms.map((v) => (
                    <tr key={v.id} className="hover:bg-brand-800/40">
                      <td className={cell}><Link to={`/cpnr/vms/${v.id}`} className="font-semibold text-primary-300 hover:text-primary-200">{v.name}</Link></td>
                      <td className={cell}>{v.site ?? "--"}</td>
                      <td className={cell}>{v.service ?? "--"}</td>
                      <td className={cell}>{v.role}</td>
                      <td className={`${cell} font-mono text-xs`}>{v.mgmt_ip}</td>
                      <td className={`${cell} font-mono text-xs`}>
                        {[v.scope_count, v.prefix_count, v.reservation4_count, v.reservation6_count, v.client_count, v.client_class_count]
                          .map((n) => (n == null ? "--" : n)).join(" / ")}
                      </td>
                      <td className={cell}>
                        <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] uppercase tracking-wide ${pairBadge[v.pair_status]}`}>
                          {pairLabel[v.pair_status]}
                          {v.pair_status === "drift" && v.inconsistency_count ? ` (${v.inconsistency_count})` : ""}
                        </span>
                      </td>
                      <td className={cell}>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${statusBadge[v.status] ?? statusBadge.pending}`}>{v.status}</span>
                      </td>
                      <td className={cell}>{fmtDate(v.last_polled_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-brand-800/70 px-4 py-3 text-xs text-slate-400">
            <span>{total} VM{total === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={loading || !hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 font-semibold text-slate-200 transition hover:border-primary-500 disabled:cursor-not-allowed disabled:text-slate-600">Previous</button>
              <span className="min-w-[80px] text-center">Page {page}</span>
              <button type="button" disabled={loading || !hasNext} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 font-semibold text-slate-200 transition hover:border-primary-500 disabled:cursor-not-allowed disabled:text-slate-600">Next</button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
