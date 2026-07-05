import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ViewfinderCircleIcon } from "@heroicons/react/24/outline";

import { AppShell } from "@/components/layout/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { TableRowsSkeleton } from "@/components/ui/Skeleton";
import { fetchAciFreePorts } from "@/services/aci";
import { AciFreePortNode, AciFreePortReport } from "@/types";

type QuickFilter = "all" | "has-free" | "zero" | "high";
type SortKey = "fabric" | "node" | "name" | "free" | "excluded" | "sfp";

const ACCENTS = [
  "border-t-primary-500",
  "border-t-emerald-500",
  "border-t-amber-500",
  "border-t-blue-500",
  "border-t-violet-500"
];

const roleBadge = (role: string) => {
  const r = role.toLowerCase();
  if (r === "spine") {
    return "border-violet-500/40 bg-violet-500/10 text-violet-200";
  }
  if (r.includes("remote")) {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
};

export function AciFreePortsPage() {
  const [report, setReport] = useState<AciFreePortReport | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [fabricFilter, setFabricFilter] = useState<string>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchAciFreePorts();
        if (!cancelled) {
          setReport(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load ACI free ports", err);
          setError("Unable to load Cisco ACI free-port data. Please retry.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const fabricAccent = useMemo(() => {
    const map = new Map<string, string>();
    (report?.fabrics ?? []).forEach((fabric, index) => {
      map.set(fabric.fabric_name, ACCENTS[index % ACCENTS.length]);
    });
    return map;
  }, [report]);

  const visibleNodes = useMemo(() => {
    if (!report) {
      return [];
    }
    let rows = [...report.nodes];
    if (fabricFilter !== "all") {
      rows = rows.filter((row) => (row.fabric_name ?? "") === fabricFilter);
    }
    if (quickFilter === "has-free") {
      rows = rows.filter((row) => row.free > 0);
    } else if (quickFilter === "zero") {
      rows = rows.filter((row) => row.free === 0);
    } else if (quickFilter === "high") {
      rows = rows.filter((row) => row.free > 15);
    }
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((row) =>
        `${row.name} ${row.node_id} ${row.model ?? ""} ${row.fabric_name ?? ""}`.toLowerCase().includes(q)
      );
    }
    if (sortKey) {
      const dir = sortAsc ? 1 : -1;
      rows.sort((a, b) => {
        const pick = (row: AciFreePortNode) => {
          switch (sortKey) {
            case "fabric":
              return (row.fabric_name ?? "").toLowerCase();
            case "node":
              return Number.parseInt(row.node_id, 10) || 0;
            case "name":
              return row.name.toLowerCase();
            case "free":
              return row.free;
            case "excluded":
              return row.excluded;
            case "sfp":
              return row.sfp_missing;
            default:
              return 0;
          }
        };
        const va = pick(a);
        const vb = pick(b);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
    }
    return rows;
  }, [report, fabricFilter, quickFilter, search, sortKey, sortAsc]);

  const toggleRow = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(visibleNodes.filter((n) => n.free > 0).map((n) => n.node_uuid)));
  const collapseAll = () => setExpanded(new Set());

  const applySort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const quickButtons: { label: string; value: QuickFilter }[] = [
    { label: "Has free", value: "has-free" },
    { label: "Zero free", value: "zero" },
    { label: ">15 free", value: "high" }
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="ACI Free Access Ports"
          description="Free = operSt:down · operStQual:sfp-missing · fabric uplinks excluded — aggregated across all ACI fabrics."
          actions={
            <div className="rounded-lg border border-primary-500/30 bg-primary-500/10 px-6 py-3 text-right">
              <p className="text-3xl font-semibold text-primary-200">{report ? report.total_free.toLocaleString() : "--"}</p>
              <p className="text-[11px] uppercase tracking-wide text-primary-300">Free Access Ports</p>
            </div>
          }
        />

        {error ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        {/* Fabric summary cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading && !report ? (
            <div className="col-span-full rounded-lg border border-brand-700 bg-brand-900/60 p-4 text-sm text-slate-400">
              Loading free-port report…
            </div>
          ) : (
            (report?.fabrics ?? []).map((fabric) => {
              const pct = fabric.sfp_missing > 0 ? Math.round((fabric.free / fabric.sfp_missing) * 100) : 0;
              const isActive = fabricFilter === fabric.fabric_name;
              return (
                <button
                  key={fabric.fabric_name}
                  type="button"
                  onClick={() => setFabricFilter(isActive ? "all" : fabric.fabric_name)}
                  className={`rounded-lg border border-t-2 ${fabricAccent.get(fabric.fabric_name) ?? "border-t-primary-500"} bg-brand-900/60 p-4 text-left transition hover:bg-brand-800/50 ${
                    isActive ? "border-primary-500/60 bg-brand-800/60" : "border-brand-700"
                  }`}
                >
                  <div className="font-semibold text-white">{fabric.fabric_name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{fabric.fabric_ip ?? "--"}</div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-xl font-semibold text-primary-200">{fabric.free}</div>
                      <div className="text-[10px] text-slate-500">free access</div>
                    </div>
                    <div>
                      <div className="text-xl font-semibold text-slate-300">{fabric.excluded}</div>
                      <div className="text-[10px] text-slate-500">uplinks excl.</div>
                    </div>
                    <div>
                      <div className="text-xl font-semibold text-slate-400">{fabric.sfp_missing}</div>
                      <div className="text-[10px] text-slate-500">sfp-missing</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded bg-brand-700">
                    <div className="h-full rounded bg-primary-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">
                    {fabric.nodes_with_free} / {fabric.total_nodes} nodes have free ports
                  </div>
                </button>
              );
            })
          )}
        </section>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setFabricFilter("all");
              setQuickFilter("all");
            }}
            className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
              fabricFilter === "all" && quickFilter === "all"
                ? "border-primary-500 bg-primary-600 text-white"
                : "border-brand-700 bg-brand-800/60 text-slate-200 hover:border-primary-500"
            }`}
          >
            All Fabrics
          </button>
          {(report?.fabrics ?? []).map((fabric) => (
            <button
              key={fabric.fabric_name}
              type="button"
              onClick={() => setFabricFilter(fabric.fabric_name)}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                fabricFilter === fabric.fabric_name
                  ? "border-primary-500 bg-primary-600 text-white"
                  : "border-brand-700 bg-brand-800/60 text-slate-200 hover:border-primary-500"
              }`}
            >
              {fabric.fabric_name}
            </button>
          ))}
          {quickButtons.map((button) => (
            <button
              key={button.value}
              type="button"
              onClick={() => setQuickFilter((prev) => (prev === button.value ? "all" : button.value))}
              className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                quickFilter === button.value
                  ? "border-primary-500 bg-primary-600 text-white"
                  : "border-brand-700 bg-brand-800/60 text-slate-200 hover:border-primary-500"
              }`}
            >
              {button.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search node / model…"
              className="w-56 rounded-md border border-brand-700 bg-brand-900/70 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={expandAll}
              className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-primary-500"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-primary-500"
            >
              Collapse
            </button>
          </div>
        </div>

        {/* Per-switch table */}
        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="cursor-pointer px-4 py-3 text-left" onClick={() => applySort("fabric")}>Fabric</th>
                  <th className="cursor-pointer px-4 py-3 text-left" onClick={() => applySort("node")}>Node</th>
                  <th className="cursor-pointer px-4 py-3 text-left" onClick={() => applySort("name")}>Hostname</th>
                  <th className="px-4 py-3 text-left">Model</th>
                  <th className="px-4 py-3 text-left">Role</th>
                  <th className="cursor-pointer px-4 py-3 text-right" onClick={() => applySort("free")}>Free</th>
                  <th className="cursor-pointer px-4 py-3 text-right" onClick={() => applySort("excluded")}>Excl.</th>
                  <th className="cursor-pointer px-4 py-3 text-right" onClick={() => applySort("sfp")}>SFP miss.</th>
                  <th className="px-4 py-3 text-left">Free port list <span className="font-normal normal-case text-slate-500">(click row)</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading && !report ? (
                  <TableRowsSkeleton rows={8} cols={9} />
                ) : visibleNodes.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6">
                      <EmptyState
                        icon={ViewfinderCircleIcon}
                        title="No switches match"
                        description="Adjust the filters, or wait for the next ACI poll to refresh the free-port report."
                      />
                    </td>
                  </tr>
                ) : (
                  visibleNodes.map((node) => {
                    const isOpen = expanded.has(node.node_uuid);
                    return (
                      <tr
                        key={node.node_uuid}
                        className={`cursor-pointer hover:bg-brand-800/40 ${node.free === 0 ? "opacity-60" : ""}`}
                        onClick={() => node.free > 0 && toggleRow(node.node_uuid)}
                      >
                        <td className="px-4 py-3 text-slate-300">{node.fabric_name ?? "--"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{node.node_id}</td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/telco/aci/nodes/${node.node_uuid}`}
                            className="font-medium text-primary-300 hover:text-primary-200"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {node.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{node.model ?? "--"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] uppercase tracking-wide ${roleBadge(node.role)}`}>
                            {node.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-mono text-lg font-semibold ${node.free > 0 ? "text-primary-200" : "text-slate-600"}`}>
                            {node.free}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">{node.excluded}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-500">{node.sfp_missing}</td>
                        <td className="px-4 py-3">
                          {node.free === 0 ? (
                            <span className="font-mono text-xs text-slate-600">no free ports</span>
                          ) : isOpen ? (
                            <div className="flex flex-wrap gap-1">
                              {node.free_ports.map((port) => (
                                <span
                                  key={port}
                                  className="rounded border border-primary-500/20 bg-primary-500/10 px-1.5 py-0.5 font-mono text-[10px] text-primary-200"
                                >
                                  {port}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="font-mono text-xs text-slate-400">{node.free_ports.length} ports · show ▾</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {report ? (
                <tfoot className="border-t border-brand-700 bg-brand-900/70 text-slate-300">
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-xs uppercase tracking-wide text-slate-500">
                      Total — {report.total_fabrics} fabrics · {report.total_nodes} switches
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-primary-200">{report.total_free}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-400">{report.total_excluded}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500">{report.total_sfp_missing}</td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
