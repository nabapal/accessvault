import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { fetchAciFabricSummaryDetails } from "@/services/aci";
import { AciFabricSummaryDetails, AciFabricSummaryFabric } from "@/types";

const ROLE_LABELS: Record<string, string> = {
  leaf: "Leaf",
  spine: "Spine",
  controller: "Controller",
  unspecified: "Unspecified"
};

type RoleTotals = {
  leaf: number;
  spine: number;
  controller: number;
  unspecified: number;
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return "--";
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const formatBreakdown = (record: Record<string, number>, labelMap?: Record<string, string>) => {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return "--";
  }
  return entries.map(([label, count]) => `${labelMap?.[label] ?? label}: ${count}`).join(", ");
};

export function AciFabricSummaryPage() {
  const [data, setData] = useState<AciFabricSummaryDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFabric, setSelectedFabric] = useState<string>("all");
  const [fabricOptions, setFabricOptions] = useState<AciFabricSummaryFabric[]>([]);

  const loadData = async (fabricFilter?: string) => {
    setIsLoading(true);
    try {
      const response = await fetchAciFabricSummaryDetails({
        fabric: fabricFilter ? fabricFilter.trim() : undefined
      });
      if (!fabricFilter) {
        const sortedFabrics = [...response.fabrics].sort((a, b) => {
          const nameA = (a.fabric_name || "").toLowerCase();
          const nameB = (b.fabric_name || "").toLowerCase();
          return nameA.localeCompare(nameB);
        });
        setFabricOptions(sortedFabrics);
      }
      setData(response);
      setError(null);
    } catch (err) {
      console.error("Failed to load fabric summary", err);
      setError("Unable to load Cisco ACI fabric summary. Please retry.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const fabricFilter = selectedFabric === "all" ? undefined : selectedFabric;
    void loadData(fabricFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFabric]);

  const aggregatedRoleTotals = useMemo<RoleTotals>(() => {
    const totals: RoleTotals = { leaf: 0, spine: 0, controller: 0, unspecified: 0 };
    if (!data) {
      return totals;
    }
    for (const fabric of data.fabrics) {
      for (const [role, count] of Object.entries(fabric.by_role)) {
        const key = role.toLowerCase();
        switch (key) {
          case "leaf":
            totals.leaf += count;
            break;
          case "spine":
            totals.spine += count;
            break;
          case "controller":
            totals.controller += count;
            break;
          case "unspecified":
            totals.unspecified += count;
            break;
          default:
            totals.unspecified += count;
            break;
        }
      }
    }
    return totals;
  }, [data]);

  const aggregatedModelEntries = useMemo<Array<[string, number]>>(() => {
    if (!data) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const fabric of data.fabrics) {
      for (const [model, count] of Object.entries(fabric.by_model)) {
        const key = model || "unknown";
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const aggregatedVersionEntries = useMemo<Array<[string, number]>>(() => {
    if (!data) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const fabric of data.fabrics) {
      for (const [version, count] of Object.entries(fabric.by_version)) {
        const key = version || "unknown";
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const aggregatedStateEntries = useMemo<Array<[string, number]>>(() => {
    if (!data) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const fabric of data.fabrics) {
      for (const [state, count] of Object.entries(fabric.by_fabric_state)) {
        const key = state || "unknown";
        counts.set(key, (counts.get(key) ?? 0) + count);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Cisco ACI Fabric Summary</h1>
            <p className="mt-1 text-sm text-slate-300">
              Aggregated view of fabrics, hardware models, software versions, and health state by onboarding context.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/telco/aci"
              className="inline-flex items-center gap-2 rounded-md border border-primary-500/60 bg-primary-500/15 px-4 py-2 text-sm font-semibold text-primary-100 transition hover:border-primary-400 hover:bg-primary-500/25"
            >
              View Fabric Directory
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Fabric Filter</h2>
          <div className="mt-3 overflow-x-auto">
            <div className="flex min-h-[42px] items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedFabric("all")}
                className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:ring-offset-transparent ${
                  selectedFabric === "all"
                    ? "border-primary-500 bg-primary-600 text-white"
                    : "border-brand-700 bg-brand-900/70 text-slate-200 hover:border-primary-500/60 hover:text-white"
                }`}
              >
                All Fabrics
              </button>
              {fabricOptions.map((fabric) => {
                const value = fabric.fabric_name;
                const isActive = selectedFabric === value;
                return (
                  <button
                    key={`${fabric.fabric_job_id ?? value}`}
                    type="button"
                    onClick={() => setSelectedFabric(value)}
                    className={`whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:ring-offset-transparent ${
                      isActive
                        ? "border-primary-500 bg-primary-600 text-white"
                        : "border-brand-700 bg-brand-900/70 text-slate-200 hover:border-primary-500/60 hover:text-white"
                    }`}
                    title={fabric.fabric_ip ? `${fabric.fabric_name} • ${fabric.fabric_ip}` : fabric.fabric_name}
                  >
                    {fabric.fabric_name}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Fabrics</p>
            <p className="mt-2 text-2xl font-semibold text-white">{data ? data.total_fabrics : "--"}</p>
            <p className="mt-1 text-[13px] text-slate-400">Fabrics matching current filters</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Total Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-white">{data ? data.total_nodes : "--"}</p>
            <p className="mt-1 text-[13px] text-slate-400">Nodes represented across filtered fabrics</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Leaf Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">{data ? aggregatedRoleTotals.leaf : "--"}</p>
            <p className="mt-1 text-[13px] text-slate-400">Leaf roles included in the selection</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Spine Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-blue-200">{data ? aggregatedRoleTotals.spine : "--"}</p>
            <p className="mt-1 text-[13px] text-slate-400">Spine roles included in the selection</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Controller Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-amber-200">{data ? aggregatedRoleTotals.controller : "--"}</p>
            <p className="mt-1 text-[13px] text-slate-400">Controllers across current filters</p>
          </div>
        </section>


        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60">
            <div className="border-b border-brand-800/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-100">Software Versions</h2>
              <p className="text-xs text-slate-400">Version counts across the filtered fabrics.</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Version</th>
                    <th className="px-4 py-2 text-right">Nodes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60 text-slate-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        Loading version breakdown…
                      </td>
                    </tr>
                  ) : aggregatedVersionEntries.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        No version data for the current filters.
                      </td>
                    </tr>
                  ) : (
                    aggregatedVersionEntries.map(([version, count]) => (
                      <tr key={version}>
                        <td className="px-4 py-2 text-slate-100">{version}</td>
                        <td className="px-4 py-2 text-right text-slate-100">{count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-brand-700 bg-brand-900/60">
            <div className="border-b border-brand-800/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-100">Node State Breakdown</h2>
              <p className="text-xs text-slate-400">Operational states aggregated across filters.</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left">State</th>
                    <th className="px-4 py-2 text-right">Nodes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60 text-slate-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        Loading state breakdown…
                      </td>
                    </tr>
                  ) : aggregatedStateEntries.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        No state data for the current filters.
                      </td>
                    </tr>
                  ) : (
                    aggregatedStateEntries.map(([state, count]) => (
                      <tr key={state}>
                        <td className="px-4 py-2 text-slate-100">{state}</td>
                        <td className="px-4 py-2 text-right text-slate-100">{count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-brand-700 bg-brand-900/60">
            <div className="border-b border-brand-800/70 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-100">Models</h2>
              <p className="text-xs text-slate-400">Hardware models represented in the selection.</p>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full divide-y divide-brand-800/70 text-sm">
                <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Model</th>
                    <th className="px-4 py-2 text-right">Nodes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-800/60 text-slate-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        Loading model breakdown…
                      </td>
                    </tr>
                  ) : aggregatedModelEntries.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="px-4 py-4 text-center text-slate-400">
                        No model data for the current filters.
                      </td>
                    </tr>
                  ) : (
                    aggregatedModelEntries.map(([model, count]) => (
                      <tr key={model}>
                        <td className="px-4 py-2 text-slate-100">{model}</td>
                        <td className="px-4 py-2 text-right text-slate-100">{count}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Fabric Overview</h2>
            <p className="text-xs text-slate-400">Summaries of every onboarded fabric including role, model, and state distributions.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Fabric</th>
                  <th className="px-4 py-3 text-left">Nodes</th>
                  <th className="px-4 py-3 text-left">Delayed</th>
                  <th className="px-4 py-3 text-left">Roles</th>
                  <th className="px-4 py-3 text-left">Models</th>
                  <th className="px-4 py-3 text-left">Versions</th>
                  <th className="px-4 py-3 text-left">Fabric States</th>
                  <th className="px-4 py-3 text-left">Last Sync</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">
                      Loading Cisco ACI fabric summaries…
                    </td>
                  </tr>
                ) : !data || data.fabrics.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-400">
                      No fabrics match the current filters.
                    </td>
                  </tr>
                ) : (
                  data.fabrics.map((fabric) => (
                    <tr key={`${fabric.fabric_job_id ?? fabric.fabric_name}`} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">{fabric.fabric_name}</div>
                        <div className="text-xs text-slate-400">{fabric.fabric_ip ?? "--"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{fabric.total_nodes}</td>
                      <td className="px-4 py-3 text-amber-200">{fabric.delayed_heartbeat}</td>
                      <td className="px-4 py-3 text-slate-100">{formatBreakdown(fabric.by_role, ROLE_LABELS)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatBreakdown(fabric.by_model)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatBreakdown(fabric.by_version)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatBreakdown(fabric.by_fabric_state)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatDate(fabric.last_polled_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
