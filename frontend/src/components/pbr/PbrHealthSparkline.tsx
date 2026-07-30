import { useMemo } from "react";

import { PbrHealthSample, PbrServiceState } from "@/types";

// Reuse the app's established STATUS palette (not a new categorical palette) — the
// accent follows the service's current health state, shipped alongside a text trend
// summary so identity/trend is never conveyed by color alone (dataviz a11y pass).
const STATE_COLOR: Record<PbrServiceState, string> = {
  healthy: "#34d399",
  degraded: "#fbbf24",
  down: "#fb7185",
  unknown: "#64748b"
};

const W = 220;
const H = 44;
const PAD = 4;

function trendSummary(samples: PbrHealthSample[]): string {
  const pts = samples.map((s) => s.health_pct).filter((v): v is number => v !== null && v !== undefined);
  if (pts.length < 2) {
    return "not enough history yet";
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  const delta = Math.round(last - first);
  if (delta >= 5) {
    return `recovering (+${delta} pts across last ${pts.length})`;
  }
  if (delta <= -5) {
    return `declining (${delta} pts across last ${pts.length})`;
  }
  return `steady across last ${pts.length}`;
}

/** Compact health-trend sparkline (single series → no legend; the heading names it). */
export function PbrHealthSparkline({
  samples,
  state
}: {
  samples: PbrHealthSample[];
  state: PbrServiceState;
}) {
  const color = STATE_COLOR[state] ?? STATE_COLOR.unknown;

  const path = useMemo(() => {
    const pts = samples
      .map((s) => s.health_pct)
      .filter((v): v is number => v !== null && v !== undefined);
    if (pts.length < 2) {
      return null;
    }
    const stepX = (W - PAD * 2) / (pts.length - 1);
    // Health is always 0–100, so use a fixed domain (comparable across services).
    const y = (v: number) => PAD + (1 - v / 100) * (H - PAD * 2);
    return pts.map((v, i) => `${i === 0 ? "M" : "L"} ${PAD + i * stepX} ${y(v)}`).join(" ");
  }, [samples]);

  const last = useMemo(() => {
    const pts = samples.map((s) => s.health_pct).filter((v): v is number => v !== null && v !== undefined);
    return pts.length ? pts[pts.length - 1] : null;
  }, [samples]);

  return (
    <div className="flex items-center gap-4">
      <svg width={W} height={H} role="img" aria-label="Service health trend">
        {/* recessive baseline at 100% and 0% */}
        <line x1={PAD} y1={PAD} x2={W - PAD} y2={PAD} stroke="#1e293b" strokeWidth={1} />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#1e293b" strokeWidth={1} />
        {path ? (
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ) : (
          <text x={W / 2} y={H / 2 + 3} textAnchor="middle" fontSize="10" fill="#64748b">
            collecting history…
          </text>
        )}
      </svg>
      <div className="text-xs">
        <div className="font-mono text-base font-semibold" style={{ color }}>
          {last === null ? "N/A" : `${Math.round(last)}%`}
        </div>
        <div className="text-slate-400">{trendSummary(samples)}</div>
      </div>
    </div>
  );
}
