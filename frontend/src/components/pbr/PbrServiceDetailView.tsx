import { useEffect, useState } from "react";

import { fetchPbrBlastRadius, fetchPbrHealthHistory, fetchPbrServiceDetail } from "@/services/pbr";
import { PbrBlastRadius, PbrHealthHistory, PbrNode, PbrServiceDetail, PbrThresholdAction } from "@/types";
import { PbrHealthSparkline } from "./PbrHealthSparkline";
import { PbrTopology } from "./PbrTopology";

const fmt = (v?: string | null) => (v ? v : "—");
const fmtPct = (v?: number | null) => (v === undefined || v === null ? "N/A" : `${Math.round(v)}%`);

const STATUS_TEXT: Record<string, string> = {
  live: "text-emerald-300",
  faulty: "text-rose-300",
  bypassed: "text-slate-300",
  permit: "text-amber-300",
  unknown: "text-slate-400"
};

// Threshold config summary — L1 is informational only (SDD §9.1); the three-way down
// action is surfaced literally (SDD §9.3) so permit is never shown as a graceful bypass.
function thresholdSummary(node: PbrNode): string {
  if (!node.threshold_enable) {
    return "threshold disabled";
  }
  const action: PbrThresholdAction = node.threshold_down_action;
  const min = node.min_threshold_pct ?? "—";
  if (node.layer === "L1") {
    return `min ${min}% · action ${action} (informational — L1)`;
  }
  return `min ${min}% · down action ${action}`;
}

export function PbrServiceDetailView({ serviceId }: { serviceId: string }) {
  const [detail, setDetail] = useState<PbrServiceDetail | null>(null);
  const [blast, setBlast] = useState<PbrBlastRadius | null>(null);
  const [history, setHistory] = useState<PbrHealthHistory | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [d, b, h] = await Promise.all([
          fetchPbrServiceDetail(serviceId),
          fetchPbrBlastRadius(serviceId),
          fetchPbrHealthHistory(serviceId, 24 * 7)
        ]);
        if (cancelled) {
          return;
        }
        setDetail(d);
        setBlast(b);
        setHistory(h);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load PBR service detail", err);
        setError("Unable to load service detail. Please retry.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  if (loading) {
    return <div className="px-4 py-4 text-sm text-slate-400">Loading service detail…</div>;
  }
  if (error) {
    return <div className="px-4 py-3 text-sm text-rose-200">{error}</div>;
  }
  if (!detail) {
    return null;
  }

  return (
    <div className="space-y-4 border-t border-brand-800/70 bg-brand-950/30 px-4 py-4">
      {/* Health trend (durable history, Phase 4 — replaces prototype localStorage) */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Health trend (last 7 days)
        </h3>
        <PbrHealthSparkline samples={history?.samples ?? []} state={detail.state} />
      </div>

      {/* Topology */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Topology</h3>
        <PbrTopology service={detail} />
      </div>

      {/* Per-node health breakdown */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Node health breakdown</h3>
        <div className="overflow-x-auto rounded-md border border-brand-800/70">
          <table className="min-w-full divide-y divide-brand-800/70 text-sm">
            <thead className="bg-brand-900/70 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Node</th>
                <th className="px-3 py-2 text-left">Layer</th>
                <th className="px-3 py-2 text-left">Device group</th>
                <th className="px-3 py-2 text-left">Redirect dests</th>
                <th className="px-3 py-2 text-left">Threshold</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-800/60 text-slate-200">
              {detail.nodes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-3 text-center text-slate-500">
                    No nodes ingested for this service yet.
                  </td>
                </tr>
              ) : (
                detail.nodes.map((node) => (
                  <tr key={node.id}>
                    <td className="px-3 py-2 font-medium text-slate-100">{fmt(node.name)}</td>
                    <td className="px-3 py-2">{node.layer}</td>
                    <td className="px-3 py-2 text-slate-300">{fmt(node.device_group_name ?? node.device_group_dn)}</td>
                    <td className="px-3 py-2 text-slate-300">
                      {node.layer === "L1"
                        ? "—"
                        : `${node.learned_dest_count}/${node.configured_dest_count} learned`}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{thresholdSummary(node)}</td>
                    <td className={`px-3 py-2 text-xs font-semibold ${STATUS_TEXT[node.live_status]}`}>
                      {node.live_status}
                      {node.bypassed ? " (by design)" : ""}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${STATUS_TEXT[node.live_status]}`}>
                      {fmtPct(node.health_pct)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Blast radius */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Blast radius — services sharing a device group in this fabric
        </h3>
        {!blast || blast.items.length === 0 ? (
          <p className="rounded-md border border-brand-800/70 bg-brand-900/40 px-3 py-2 text-sm text-slate-400">
            No other PBR service in this fabric shares a device group — touching this device should be isolated to this
            service.
          </p>
        ) : (
          <ul className="space-y-1">
            {blast.items.map((item) => (
              <li
                key={item.service_id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-brand-800/70 bg-brand-900/40 px-3 py-2 text-sm"
              >
                <span className="font-medium text-slate-100">{fmt(item.contract_name)}</span>
                <span className="text-slate-500">/ {fmt(item.graph_name)}</span>
                <span className={`text-xs ${STATUS_TEXT[item.state]}`}>{item.state} · {fmtPct(item.health_pct)}</span>
                <span className="text-[11px] text-slate-500">
                  shares: {item.shared_device_groups.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
