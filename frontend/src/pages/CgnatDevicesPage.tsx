import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ServerIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableRowsSkeleton } from "@/components/ui/Skeleton";
import { fetchCgnatDevices } from "@/services/cgnat";
import { parseApiDate } from "@/utils/datetime";
import { locationFromName } from "@/utils/location";
import { CgnatDevice } from "@/types";

const vendorBadge: Record<string, string> = {
  a10: "border-amber-500/50 bg-amber-500/15 text-amber-100",
  f5: "border-red-500/50 bg-red-500/15 text-red-100",
  unknown: "border-slate-500/50 bg-slate-500/15 text-slate-200"
};
const statusBadge: Record<string, string> = {
  ok: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  error: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  pending: "border-slate-500/50 bg-slate-500/15 text-slate-200"
};

const fmt = (v?: number | null) => (v == null ? "--" : v.toLocaleString());

// Best-effort parse of licence expiry strings: A10 "01-July-2026", F5 "2025/04/01".
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};
const parseExpiry = (s?: string | null): Date | null => {
  if (!s) return null;
  let m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo === undefined) return null;
    return new Date(Number(m[3]), mo, Number(m[1]));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
};
// Colour a true expiry: red if past, amber within 30 days, else normal.
const expiryTone = (s?: string | null): string => {
  const d = parseExpiry(s);
  if (!d) return "text-slate-300";
  const now = Date.now();
  if (d.getTime() < now) return "text-rose-300";
  if (d.getTime() < now + 30 * 864e5) return "text-amber-300";
  return "text-slate-300";
};

const fmtDate = (v?: string | null) => {
  if (!v) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(parseApiDate(v));
  } catch {
    return v;
  }
};

export function CgnatDevicesPage() {
  const [devices, setDevices] = useState<CgnatDevice[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const p = await fetchCgnatDevices({ search: search || undefined, page, pageSize: 25 });
        if (cancelled) return;
        setDevices(p.items);
        setTotal(p.total);
        setHasPrev(p.has_prev);
        setHasNext(p.has_next);
        setError(null);
      } catch (err) {
        if (!cancelled) { console.error(err); setError("Unable to load CGNAT devices."); }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [search, page]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="CGNAT Devices"
          description="A10 Thunder and F5 BIG-IP CGNAT gateways collected over REST."
          actions={
            <input
              type="search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search name, IP, vendor, role, site, model, status..."
              className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-96"
            />
          }
        />

        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-left">Mgmt IP</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Software</th>
                  <th className="px-4 py-3 text-left">License</th>
                  <th className="px-4 py-3 text-right">Sessions</th>
                  <th className="px-4 py-3 text-right">Translations</th>
                  <th className="px-4 py-3 text-right">Exhaustion</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Last Poll</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <TableRowsSkeleton rows={6} cols={12} />
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-6">
                      <EmptyState icon={ServerIcon} title="No CGNAT devices found" description="Register devices under Admin → CGNAT Devices." />
                    </td>
                  </tr>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <Link to={`/cgnat/devices/${d.id}`} className="font-semibold text-primary-300 hover:text-primary-200">{d.hostname || d.name}</Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${vendorBadge[d.vendor] ?? vendorBadge.unknown}`}>{d.vendor}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{locationFromName(d.hostname || d.name)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">{d.mgmt_ip}</td>
                      <td className="px-4 py-3 text-slate-100">{d.model ?? "--"}</td>
                      <td className="px-4 py-3 text-xs text-slate-100">{d.os_version ?? "--"}</td>
                      <td className="px-4 py-3 text-xs">
                        {d.license_product || d.license_expiry || d.license_bandwidth_mbps != null ? (
                          <div className="space-y-0.5">
                            <div className="text-slate-100">{d.license_product ?? "--"}</div>
                            {d.license_bandwidth_mbps != null && (
                              <div className="text-slate-400">{d.license_bandwidth_mbps} Mbps</div>
                            )}
                            {d.license_expiry && (
                              <div className={d.vendor === "f5" ? "text-slate-400" : expiryTone(d.license_expiry)}>
                                {d.vendor === "f5" ? "chk " : "exp "}{d.license_expiry}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-100">{fmt(d.active_sessions)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-100">{fmt(d.total_translations)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${(d.exhaustion_events ?? 0) > 0 ? "text-amber-300" : "text-slate-400"}`}>{fmt(d.exhaustion_events)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${statusBadge[d.status] ?? statusBadge.pending}`}>{d.status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{fmtDate(d.last_polled_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-brand-800/70 px-4 py-3 text-xs text-slate-400">
            <span>{total} device{total === 1 ? "" : "s"}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={isLoading || !hasPrev} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-[13px] font-semibold text-slate-200 transition hover:border-primary-500 disabled:cursor-not-allowed disabled:text-slate-600">Previous</button>
              <span className="min-w-[80px] text-center">Page {page}</span>
              <button type="button" disabled={isLoading || !hasNext} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-[13px] font-semibold text-slate-200 transition hover:border-primary-500 disabled:cursor-not-allowed disabled:text-slate-600">Next</button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
