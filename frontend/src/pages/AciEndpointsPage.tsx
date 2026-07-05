import { useEffect, useState } from "react";
import { MapPinIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableRowsSkeleton } from "@/components/ui/Skeleton";
import { fetchAciFabricEndpoints } from "@/services/aci";
import { AciFabricEndpoint } from "@/types";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const learningBadges: Record<string, string> = {
  learned: "border-emerald-500/50 bg-emerald-500/15 text-emerald-100",
  static: "border-blue-500/50 bg-blue-500/15 text-blue-100",
  vmm: "border-violet-500/50 bg-violet-500/15 text-violet-100"
};

const formatLabel = (value?: string | null) => {
  if (!value) {
    return "--";
  }
  return value;
};

export function AciEndpointsPage() {
  const [endpoints, setEndpoints] = useState<AciFabricEndpoint[]>([]);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState<number>(0);
  const [hasPrev, setHasPrev] = useState<boolean>(false);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      try {
        const response = await fetchAciFabricEndpoints({
          search: search || undefined,
          page,
          pageSize
        });
        if (cancelled) {
          return;
        }

        const totalCount = response.total;
        if (totalCount === 0 && page !== 1) {
          setEndpoints([]);
          setTotal(0);
          setHasPrev(false);
          setHasNext(false);
          setPage(1);
          setError(null);
          return;
        }

        setEndpoints(response.items);
        setTotal(totalCount);
        setHasPrev(response.has_prev);
        setHasNext(response.has_next);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load ACI endpoints", err);
        setError("Unable to load Cisco ACI endpoint data. Please retry.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [search, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = endpoints.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = endpoints.length > 0 ? rangeStart + endpoints.length - 1 : 0;
  const disablePrev = isLoading || !hasPrev;
  const disableNext = isLoading || !hasNext;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Cisco ACI Endpoints"
          description="Locally-attached endpoints (MAC/IP) learned across all ACI fabrics. Tunnel-learned (remote) endpoints are excluded."
          actions={
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search MAC, IP, tenant, EPG, encap, BD, VRF, interface, fabric..."
              className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-96"
            />
          }
        />

        {error ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Endpoints</p>
            <p className="mt-2 text-2xl font-semibold text-white">{total}</p>
            <p className="mt-1 text-[13px] text-slate-400">Locally-attached MAC endpoints across all fabrics</p>
          </div>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Endpoint Directory</h2>
            <p className="text-xs text-slate-400">MAC/IP, EPG, encapsulation, and attaching interface per endpoint.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Fabric</th>
                  <th className="px-4 py-3 text-left">Tenant / App</th>
                  <th className="px-4 py-3 text-left">EPG</th>
                  <th className="px-4 py-3 text-left">MAC</th>
                  <th className="px-4 py-3 text-left">IP Address</th>
                  <th className="px-4 py-3 text-left">Encap</th>
                  <th className="px-4 py-3 text-left">BD / VRF</th>
                  <th className="px-4 py-3 text-left">Node / Interface</th>
                  <th className="px-4 py-3 text-left">Learning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <TableRowsSkeleton rows={8} cols={9} />
                ) : endpoints.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6">
                      <EmptyState
                        icon={MapPinIcon}
                        title="No endpoints match"
                        description="Try a different search, or wait for the next ACI poll to populate endpoints."
                      />
                    </td>
                  </tr>
                ) : (
                  endpoints.map((endpoint) => (
                    <tr key={endpoint.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{endpoint.fabric_name ?? "--"}</div>
                        <div className="text-xs text-slate-500">{endpoint.fabric_ip ?? "--"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-100">{formatLabel(endpoint.tenant)}</div>
                        <div className="text-xs text-slate-500">{formatLabel(endpoint.app_profile)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(endpoint.epg)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-100">{formatLabel(endpoint.mac)}</td>
                      <td className="px-4 py-3 text-slate-100">
                        {endpoint.ip_addresses.length > 0 ? (
                          <div className="space-y-0.5">
                            {endpoint.ip_addresses.map((ip) => (
                              <div key={ip} className="font-mono text-xs">
                                {ip}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(endpoint.encap)}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-100">{formatLabel(endpoint.bridge_domain)}</div>
                        <div className="text-xs text-slate-500">{formatLabel(endpoint.vrf)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-100">
                          {endpoint.nodes.length > 0 ? `Node ${endpoint.nodes.join(", ")}` : "--"}
                        </div>
                        <div className="text-xs text-slate-500">{formatLabel(endpoint.interface)}</div>
                      </td>
                      <td className="px-4 py-3">
                        {endpoint.learning_source ? (
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                              learningBadges[endpoint.learning_source.toLowerCase()] ??
                              "border-slate-500/50 bg-slate-500/15 text-slate-200"
                            }`}
                          >
                            {endpoint.learning_source}
                          </span>
                        ) : (
                          <span className="text-slate-500">--</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-brand-800/70 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-slate-300">
              <span>
                {total > 0
                  ? `Showing ${rangeStart}-${rangeEnd} of ${total} endpoints`
                  : isLoading
                  ? "Loading Cisco ACI endpoints…"
                  : "No endpoints to display"}
              </span>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="uppercase tracking-wide">Rows</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    const nextSize = Number.parseInt(event.target.value, 10) || DEFAULT_PAGE_SIZE;
                    setPageSize(nextSize);
                    setPage(1);
                  }}
                  className="rounded-md border border-brand-700 bg-brand-900/70 px-2 py-1 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-[13px] font-semibold text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:border-brand-800 disabled:bg-brand-900/40 disabled:text-slate-600"
                disabled={disablePrev}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Previous
              </button>
              <span className="min-w-[110px] text-center text-[13px] text-slate-400">
                Page {total > 0 ? page : 1} of {total > 0 ? totalPages : 1}
              </span>
              <button
                type="button"
                className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1 text-[13px] font-semibold text-slate-200 transition hover:border-primary-500 hover:text-white disabled:cursor-not-allowed disabled:border-brand-800 disabled:bg-brand-900/40 disabled:text-slate-600"
                disabled={disableNext}
                onClick={() => setPage((prev) => prev + 1)}
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
