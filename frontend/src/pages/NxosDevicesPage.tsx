import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ServerIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableRowsSkeleton } from "@/components/ui/Skeleton";
import { fetchNxosDevices, fetchNxosSummary } from "@/services/nxos";
import { parseApiDate } from "@/utils/datetime";
import { locationFromName } from "@/utils/location";
import { NxosDevice, NxosSummary } from "@/types";

const statusBadge: Record<string, string> = {
  ok: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200",
  error: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  pending: "border-slate-500/50 bg-slate-500/15 text-slate-200"
};

const DEFAULT_PAGE_SIZE = 25;

const formatDateTime = (value?: string | null) => {
  if (!value) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(
      parseApiDate(value)
    );
  } catch {
    return value;
  }
};

export function NxosDevicesPage() {
  const [devices, setDevices] = useState<NxosDevice[]>([]);
  const [summary, setSummary] = useState<NxosSummary | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasPrev, setHasPrev] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const [summaryResp, page_] = await Promise.all([
          fetchNxosSummary(),
          fetchNxosDevices({ search: search || undefined, page, pageSize: DEFAULT_PAGE_SIZE })
        ]);
        if (cancelled) return;
        setSummary(summaryResp);
        setDevices(page_.items);
        setTotal(page_.total);
        setHasPrev(page_.has_prev);
        setHasNext(page_.has_next);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load NX-OS devices", err);
          setError("Unable to load NX-OS devices. Please retry.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [search, page]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="NX-OS Devices"
          description="Cisco Nexus switches collected over SSH (pyATS/Genie)."
          actions={
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, IP, role, site, rack, model, serial, OS..."
              className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-96"
            />
          }
        />

        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Devices</p>
            <p className="mt-2 text-2xl font-semibold text-white">{summary?.total ?? "--"}</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Interfaces</p>
            <p className="mt-2 text-2xl font-semibold text-slate-100">{summary?.total_interfaces ?? "--"}</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">BGP Neighbors</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">{summary?.total_bgp_neighbors ?? "--"}</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Devices in Error</p>
            <p className="mt-2 text-2xl font-semibold text-rose-200">{summary?.error_devices ?? "--"}</p>
          </div>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-left">Mgmt IP</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">Site</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Serial</th>
                  <th className="px-4 py-3 text-left">OS Version</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Last Poll</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <TableRowsSkeleton rows={8} cols={10} />
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6">
                      <EmptyState
                        icon={ServerIcon}
                        title="No devices found"
                        description="Register devices under Admin → NX-OS Devices to populate this list."
                      />
                    </td>
                  </tr>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <Link to={`/nxos/devices/${d.id}`} className="font-semibold text-primary-300 hover:text-primary-200">
                          {d.hostname || d.name}
                        </Link>
                        {d.hostname && d.hostname !== d.name ? <div className="text-xs text-slate-500">{d.name}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-100">{locationFromName(d.hostname || d.name)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">{d.mgmt_ip}</td>
                      <td className="px-4 py-3 text-slate-100">{d.role ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-100">{d.site_name ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-100">{d.model ?? "--"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{d.serial ?? "--"}</td>
                      <td className="px-4 py-3 text-slate-100">{d.os_version ?? "--"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${statusBadge[d.status] ?? statusBadge.pending}`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatDateTime(d.last_polled_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-brand-800/70 px-4 py-3 text-xs text-slate-400">
            <span>
              {total} device{total === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isLoading || !hasPrev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-[13px] font-semibold text-slate-200 transition hover:border-primary-500 disabled:cursor-not-allowed disabled:text-slate-600"
              >
                Previous
              </button>
              <span className="min-w-[80px] text-center">Page {page}</span>
              <button
                type="button"
                disabled={isLoading || !hasNext}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-[13px] font-semibold text-slate-200 transition hover:border-primary-500 disabled:cursor-not-allowed disabled:text-slate-600"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
