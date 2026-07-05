import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { fetchIpMplsDevices, fetchIpMplsSummary } from "@/services/ipmpls";
import { parseApiDate } from "@/utils/datetime";
import { IpMplsDevice, IpMplsPlatform, IpMplsSummary } from "@/types";

const PLATFORM_FILTERS: { label: string; value: IpMplsPlatform | "all" }[] = [
  { label: "All", value: "all" },
  { label: "IOS-XR", value: "iosxr" },
  { label: "IOS-XE", value: "iosxe" }
];

const platformBadge: Record<string, string> = {
  iosxr: "border-blue-500/50 bg-blue-500/15 text-blue-100",
  iosxe: "border-emerald-500/50 bg-emerald-500/15 text-emerald-100",
  unknown: "border-slate-500/50 bg-slate-500/15 text-slate-200"
};

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

export function IpMplsDevicesPage() {
  const [devices, setDevices] = useState<IpMplsDevice[]>([]);
  const [summary, setSummary] = useState<IpMplsSummary | null>(null);
  const [platform, setPlatform] = useState<IpMplsPlatform | "all">("all");
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
          fetchIpMplsSummary(),
          fetchIpMplsDevices({
            platform: platform === "all" ? undefined : platform,
            search: search || undefined,
            page,
            pageSize: DEFAULT_PAGE_SIZE
          })
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
          console.error("Failed to load IP-MPLS devices", err);
          setError("Unable to load IP-MPLS devices. Please retry.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [platform, search, page]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">IP-MPLS Devices</h1>
            <p className="mt-1 text-sm text-slate-300">Cisco IOS-XE and IOS-XR routers collected over SSH.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-md border border-brand-700 bg-brand-800/60 p-1 text-xs font-medium">
              {PLATFORM_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => {
                    setPlatform(f.value);
                    setPage(1);
                  }}
                  className={`rounded px-3 py-1 transition ${
                    platform === f.value ? "bg-primary-600 text-white" : "text-slate-200 hover:bg-brand-700"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, hostname, IP, model, serial..."
              className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-80"
            />
          </div>
        </header>

        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Devices</p>
            <p className="mt-2 text-2xl font-semibold text-white">{summary?.total ?? "--"}</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">IOS-XR</p>
            <p className="mt-2 text-2xl font-semibold text-blue-200">{summary?.by_platform?.iosxr ?? 0}</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">IOS-XE</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">{summary?.by_platform?.iosxe ?? 0}</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Interfaces</p>
            <p className="mt-2 text-2xl font-semibold text-slate-100">{summary?.total_interfaces ?? "--"}</p>
          </div>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Device</th>
                  <th className="px-4 py-3 text-left">Mgmt IP</th>
                  <th className="px-4 py-3 text-left">Platform</th>
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
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-400">Loading devices…</td>
                  </tr>
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-400">
                      No devices found. Register devices under Admin → IP-MPLS Devices.
                    </td>
                  </tr>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <Link to={`/ipmpls/devices/${d.id}`} className="font-semibold text-primary-300 hover:text-primary-200">
                          {d.hostname || d.name}
                        </Link>
                        {d.hostname && d.hostname !== d.name ? (
                          <div className="text-xs text-slate-500">{d.name}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">{d.mgmt_ip}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${platformBadge[d.platform] ?? platformBadge.unknown}`}>
                          {d.platform}
                        </span>
                      </td>
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
            <span>{total} device{total === 1 ? "" : "s"}</span>
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
