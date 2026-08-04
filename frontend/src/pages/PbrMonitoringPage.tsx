import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowsRightLeftIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableRowsSkeleton } from "@/components/ui/Skeleton";
import { PbrFlowLookup } from "@/components/pbr/PbrFlowLookup";
import { PbrServiceDetailView } from "@/components/pbr/PbrServiceDetailView";
import { fetchPbrFabrics, fetchPbrServices } from "@/services/pbr";
import { PbrFabric, PbrService, PbrServiceState } from "@/types";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STATE_STYLES: Record<PbrServiceState, string> = {
  healthy: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  degraded: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  down: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  unknown: "border-slate-500/40 bg-slate-500/10 text-slate-300"
};

const formatLabel = (value?: string | null) => (value ? value : "--");

const formatPct = (value?: number | null) =>
  value === undefined || value === null ? "N/A" : `${Math.round(value)}%`;

const formatStale = (value?: string | null) => {
  if (!value) {
    return "never";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export function PbrMonitoringPage() {
  const [fabrics, setFabrics] = useState<PbrFabric[]>([]);
  const [selectedFabricId, setSelectedFabricId] = useState<string | null>(null);
  const [fabricsLoading, setFabricsLoading] = useState<boolean>(true);
  const [fabricsError, setFabricsError] = useState<string | null>(null);

  const [services, setServices] = useState<PbrService[]>([]);
  const [search, setSearch] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<PbrServiceState | "all">("all");
  const [sort, setSort] = useState<"health" | "name" | "state">("health");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState<number>(0);
  const [hasPrev, setHasPrev] = useState<boolean>(false);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const [servicesLoading, setServicesLoading] = useState<boolean>(false);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setFabricsLoading(true);
      try {
        const data = await fetchPbrFabrics();
        if (cancelled) {
          return;
        }
        setFabrics(data);
        setFabricsError(null);
        setSelectedFabricId((prev) => prev ?? (data.length > 0 ? data[0].fabric_job_id : null));
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load PBR fabrics", err);
        setFabricsError("Unable to load PBR fabrics. Please retry.");
      } finally {
        if (!cancelled) {
          setFabricsLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedFabricId) {
      setServices([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setServicesLoading(true);
      try {
        const response = await fetchPbrServices(selectedFabricId, {
          search: search || undefined,
          state: stateFilter === "all" ? undefined : stateFilter,
          sort,
          page,
          pageSize
        });
        if (cancelled) {
          return;
        }
        if (response.total === 0 && page !== 1) {
          setServices([]);
          setTotal(0);
          setHasPrev(false);
          setHasNext(false);
          setPage(1);
          setServicesError(null);
          return;
        }
        setServices(response.items);
        setTotal(response.total);
        setHasPrev(response.has_prev);
        setHasNext(response.has_next);
        setServicesError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load PBR services", err);
        setServicesError("Unable to load PBR services for this fabric. Please retry.");
      } finally {
        if (!cancelled) {
          setServicesLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedFabricId, search, stateFilter, sort, page, pageSize]);

  const selectedFabric = useMemo(
    () => fabrics.find((f) => f.fabric_job_id === selectedFabricId) ?? null,
    [fabrics, selectedFabricId]
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = services.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = services.length > 0 ? rangeStart + services.length - 1 : 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="PBR Flow Monitoring"
          description="Cross-fabric health of ACI Policy-Based Redirect service graphs — read-only visibility into deployed L4–L7 services."
        />

        {fabricsError ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{fabricsError}</div>
        ) : null}

        {/* Fabric health dashboard */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fabricsLoading ? (
            <div className="col-span-full rounded-lg border border-brand-700 bg-brand-900/50 p-6 text-sm text-slate-400">
              Loading fabrics…
            </div>
          ) : fabrics.length === 0 ? (
            <div className="col-span-full">
              <EmptyState
                icon={ArrowsRightLeftIcon}
                title="No ACI fabrics onboarded"
                description="Onboard an ACI fabric under Admin → Fabric Onboarding; PBR data appears after the next poll."
              />
            </div>
          ) : (
            fabrics.map((fabric) => {
              const isActive = fabric.fabric_job_id === selectedFabricId;
              return (
                <button
                  key={fabric.fabric_job_id}
                  type="button"
                  onClick={() => {
                    setSelectedFabricId(fabric.fabric_job_id);
                    setPage(1);
                  }}
                  className={`rounded-lg border p-4 text-left transition ${
                    isActive
                      ? "border-primary-500 bg-brand-800/60"
                      : "border-brand-700 bg-brand-900/60 hover:border-primary-500/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">{fabric.name}</p>
                    <span className="font-mono text-lg font-semibold text-primary-200">
                      {formatPct(fabric.avg_health_pct)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{fabric.target_host}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">
                      {fabric.healthy_count} healthy
                    </span>
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                      {fabric.degraded_count} warning
                    </span>
                    <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-rose-200">
                      {fabric.down_count} failed
                    </span>
                    <span className="rounded border border-slate-500/40 bg-slate-500/10 px-1.5 py-0.5 text-slate-300">
                      {fabric.service_count} total
                    </span>
                  </div>
                  {fabric.is_stale ? (
                    <p className="mt-2 text-[11px] text-amber-300/80">
                      ⚠ stale as of {formatStale(fabric.stale_as_of)}
                    </p>
                  ) : null}
                </button>
              );
            })
          )}
        </section>

        {/* IP-flow lookup — defaults to all fabrics; a dropdown can scope to one. */}
        <PbrFlowLookup fabrics={fabrics} />

        {/* Service browser */}
        {selectedFabric ? (
          <section className="rounded-lg border border-brand-700 bg-brand-900/60">
            <div className="flex flex-col gap-3 border-b border-brand-800/70 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">
                  {selectedFabric.name} — PBR service graphs
                </h2>
                <p className="text-xs text-slate-400">
                  Deployed contract + graph pairs (vnsGraphInst ∩ vnsLDevCtx), with computed health.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder="Search contract / graph…"
                  className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-64"
                />
                <select
                  value={stateFilter}
                  onChange={(event) => {
                    setStateFilter(event.target.value as PbrServiceState | "all");
                    setPage(1);
                  }}
                  className="rounded-md border border-brand-700 bg-brand-900/70 px-2 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="all">All states</option>
                  <option value="healthy">Healthy</option>
                  <option value="degraded">Warning</option>
                  <option value="down">Failed</option>
                  <option value="unknown">Unknown</option>
                </select>
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value as "health" | "name" | "state");
                    setPage(1);
                  }}
                  className="rounded-md border border-brand-700 bg-brand-900/70 px-2 py-2 text-sm text-slate-100 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="health">Sort: health ↑</option>
                  <option value="name">Sort: name</option>
                  <option value="state">Sort: state</option>
                </select>
              </div>
            </div>

            {selectedFabric.is_stale ? (
              <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                Showing last-known state — data is stale as of {formatStale(selectedFabric.stale_as_of)}.
              </div>
            ) : null}

            {servicesError ? (
              <div className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
                {servicesError}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-3 text-left">Health</th>
                    <th className="px-4 py-3 text-left">Contract</th>
                    <th className="px-4 py-3 text-left">Graph</th>
                    <th className="px-4 py-3 text-left">Consumer EPG</th>
                    <th className="px-4 py-3 text-left">Provider EPG</th>
                    <th className="px-4 py-3 text-left">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60 text-slate-200">
                  {servicesLoading ? (
                    <TableRowsSkeleton rows={8} cols={6} />
                  ) : services.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6">
                        <EmptyState
                          icon={ArrowsRightLeftIcon}
                          title="No PBR services match"
                          description="Adjust the search/filter, or wait for the next ACI poll to populate PBR services."
                        />
                      </td>
                    </tr>
                  ) : (
                    services.map((svc) => {
                      const expanded = expandedServiceId === svc.id;
                      return (
                        <Fragment key={svc.id}>
                          <tr
                            className="cursor-pointer hover:bg-brand-800/40"
                            onClick={() => setExpandedServiceId(expanded ? null : svc.id)}
                          >
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATE_STYLES[svc.state]}`}>
                                {formatPct(svc.health_pct)}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-100">
                              <span className="mr-1 text-slate-500">{expanded ? "▾" : "▸"}</span>
                              {formatLabel(svc.contract_name ?? svc.contract_dn)}
                            </td>
                            <td className="px-4 py-3 text-slate-100">{formatLabel(svc.graph_name ?? svc.graph_dn)}</td>
                            <td className="px-4 py-3 text-slate-300">{formatLabel(svc.consumer_epg_name)}</td>
                            <td className="px-4 py-3 text-slate-300">{formatLabel(svc.provider_epg_name)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${STATE_STYLES[svc.state]}`}>
                                {svc.state}
                              </span>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr>
                              <td colSpan={6} className="p-0">
                                <PbrServiceDetailView serviceId={svc.id} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-brand-800/70 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 text-slate-300">
                <span>
                  {total > 0
                    ? `Showing ${rangeStart}-${rangeEnd} of ${total} services`
                    : servicesLoading
                    ? "Loading PBR services…"
                    : "No services to display"}
                </span>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="uppercase tracking-wide">Rows</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number.parseInt(event.target.value, 10) || DEFAULT_PAGE_SIZE);
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
                  disabled={servicesLoading || !hasPrev}
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
                  disabled={servicesLoading || !hasNext}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
