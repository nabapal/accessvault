import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { fetchAciFabricNodes, fetchAciFabricSummary } from "@/services/aci";
import { AciFabricNode, AciFabricSummary, AciNodeRole } from "@/types";

const ROLE_FILTERS: { label: string; value: AciNodeRole | "all" }[] = [
  { label: "All Roles", value: "all" },
  { label: "Leaf", value: "leaf" },
  { label: "Spine", value: "spine" },
  { label: "Controller", value: "controller" },
  { label: "Unspecified", value: "unspecified" }
];

const roleBadges: Record<AciNodeRole, string> = {
  leaf: "border-emerald-500/50 bg-emerald-500/15 text-emerald-100",
  spine: "border-blue-500/50 bg-blue-500/15 text-blue-100",
  controller: "border-amber-500/50 bg-amber-500/15 text-amber-100",
  unspecified: "border-slate-500/50 bg-slate-500/15 text-slate-200"
};

const stateBadges: Record<string, string> = {
  active: "border-emerald-600/50 bg-emerald-500/15 text-emerald-100",
  unknown: "border-slate-600/50 bg-slate-600/20 text-slate-200",
  down: "border-rose-600/50 bg-rose-500/15 text-rose-100"
};

const heartbeatBadge = {
  ok: "border-slate-600/50 bg-slate-700/30 text-slate-200",
  delayed: "border-rose-500/50 bg-rose-500/15 text-rose-100"
};

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

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

const formatLabel = (value?: string | null) => {
  if (!value) {
    return "--";
  }
  return value;
};

export function AciInventoryPage() {
  const [nodes, setNodes] = useState<AciFabricNode[]>([]);
  const [summary, setSummary] = useState<AciFabricSummary | null>(null);
  const [roleFilter, setRoleFilter] = useState<"all" | AciNodeRole>("all");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState<number>(0);
  const [hasPrev, setHasPrev] = useState<boolean>(false);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [summaryResponse, nodesResponse] = await Promise.all([
        fetchAciFabricSummary(),
        fetchAciFabricNodes({
          role: roleFilter === "all" ? undefined : roleFilter,
          search: search || undefined,
          page,
          pageSize
        })
      ]);

      const totalCount = nodesResponse.total;
      const lastPage = totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;

      if (totalCount > 0 && page > lastPage) {
        setSummary(summaryResponse);
        setPage(lastPage);
        setError(null);
        return;
      }

      if (totalCount === 0 && page !== 1) {
        setSummary(summaryResponse);
        setNodes([]);
        setTotal(0);
        setHasPrev(false);
        setHasNext(false);
        setPage(1);
        setError(null);
        return;
      }

      setSummary(summaryResponse);
      setNodes(nodesResponse.items);
      setTotal(totalCount);
      setHasPrev(nodesResponse.has_prev);
      setHasNext(nodesResponse.has_next);
      setError(null);
    } catch (err) {
      console.error("Failed to load ACI fabric data", err);
      setError("Unable to load Cisco ACI fabric data. Please retry.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, search, page, pageSize]);

  const filteredSummary = useMemo(() => {
    if (!summary) {
      return null;
    }
    return summary;
  }, [summary]);

  const fabricStateEntries = useMemo(() => {
    if (!filteredSummary) {
      return [];
    }
    return Object.entries(filteredSummary.by_fabric_state).sort((a, b) => b[1] - a[1]);
  }, [filteredSummary]);

  const versionEntries = useMemo(() => {
    if (!filteredSummary) {
      return [];
    }
    return Object.entries(filteredSummary.by_version).sort((a, b) => b[1] - a[1]);
  }, [filteredSummary]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = nodes.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = nodes.length > 0 ? rangeStart + nodes.length - 1 : 0;
  const disablePrev = isLoading || !hasPrev;
  const disableNext = isLoading || !hasNext;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Cisco ACI Fabric Inventory</h1>
            <p className="mt-1 text-sm text-slate-300">
              Leaf, spine, and controller visibility sourced from APIC fabricNode telemetry.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-md border border-brand-700 bg-brand-800/60 p-1 text-xs font-medium">
              {ROLE_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => {
                    setRoleFilter(filter.value);
                    setPage(1);
                  }}
                  className={`rounded px-3 py-1 transition ${
                    roleFilter === filter.value ? "bg-primary-600 text-white" : "text-slate-200 hover:bg-brand-700"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, IP, serial, model, fabric..."
              className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-72"
            />
          </div>
        </header>

        {error ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Fabric Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-white">{filteredSummary?.total ?? "--"}</p>
            <p className="mt-1 text-[13px] text-slate-400">Tracked leaf, spine, and controller nodes</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Leaf Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">
              {filteredSummary?.leaf_count ?? "--"}
            </p>
            <p className="mt-1 text-[13px] text-slate-400">Active tenant-facing switches</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Spine Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-blue-200">
              {filteredSummary?.spine_count ?? "--"}
            </p>
            <p className="mt-1 text-[13px] text-slate-400">Backbone connectivity layer</p>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Controller Nodes</p>
            <p className="mt-2 text-2xl font-semibold text-amber-200">
              {filteredSummary?.controller_count ?? "--"}
            </p>
            <p className="mt-1 text-[13px] text-slate-400">Centralized fabric policy controllers</p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <h2 className="text-sm font-semibold text-slate-100">Fabric State Breakdown</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {fabricStateEntries.length > 0 ? (
                fabricStateEntries.map(([state, count]) => (
                  <li key={state} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                          stateBadges[state] ?? stateBadges.unknown
                        }`}
                      >
                        {state}
                      </span>
                    </span>
                    <span className="font-semibold text-white">{count}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-500">No data</li>
              )}
            </ul>
          </div>
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <h2 className="text-sm font-semibold text-slate-100">Software Versions</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {versionEntries.length > 0 ? (
                versionEntries.map(([version, count]) => (
                  <li key={version} className="flex items-center justify-between">
                    <span>{version}</span>
                    <span className="font-semibold text-white">{count}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-slate-500">No data</li>
              )}
            </ul>
          </div>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">Fabric Node Directory</h2>
            <p className="text-xs text-slate-400">High-level hardware inventory with state and software context.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Fabric Name / IP</th>
                  <th className="px-4 py-3 text-left">Node Name</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="px-4 py-3 text-left">IP / DN</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Serial</th>
                  <th className="px-4 py-3 text-left">Version</th>
                  <th className="px-4 py-3 text-left">Fabric State</th>
                  <th className="px-4 py-3 text-left">Heartbeat</th>
                  <th className="px-4 py-3 text-left">Last Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-400">
                      Loading Cisco ACI fabric nodes…
                    </td>
                  </tr>
                ) : nodes.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-sm text-slate-400">
                      No nodes match the current filters.
                    </td>
                  </tr>
                ) : (
                  nodes.map((node) => (
                    <tr key={node.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{node.fabric_name ?? "--"}</div>
                        <div className="text-xs text-slate-500">{node.fabric_ip ?? "--"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">
                          <Link
                            to={`/telco/aci/nodes/${node.id}`}
                            className="text-primary-300 hover:text-primary-200"
                          >
                            {node.name}
                          </Link>
                        </div>
                        <div className="text-xs text-slate-400">Node ID: {node.node_id}</div>
                        {node.pod ? <div className="text-xs text-slate-500">{node.pod}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${roleBadges[node.role]}`}
                        >
                          {node.role}
                        </span>
                        {node.node_type ? (
                          <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{node.node_type}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div>{formatLabel(node.address)}</div>
                        <div className="text-xs text-slate-500">{node.distinguished_name}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(node.model)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(node.serial)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(node.version)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            stateBadges[node.fabric_state || "unknown"] ?? stateBadges.unknown
                          }`}
                        >
                          {node.fabric_state || "unknown"}
                        </span>
                        {node.admin_state ? (
                          <div className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">Admin: {node.admin_state}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                            node.delayed_heartbeat ? heartbeatBadge.delayed : heartbeatBadge.ok
                          }`}
                        >
                          {node.delayed_heartbeat ? "Delayed" : "Normal"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatDate(node.last_state_change_at)}</td>
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
                  ? `Showing ${rangeStart}-${rangeEnd} of ${total} nodes`
                  : isLoading
                  ? "Loading Cisco ACI fabric nodes…"
                  : "No nodes to display"}
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
