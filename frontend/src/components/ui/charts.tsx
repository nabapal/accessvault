// Dependency-free SVG charts (donut + radial gauge) styled for the dark theme.

// Shared categorical palette (hex so it can drive SVG stroke/fill directly).
export const CHART_PALETTE = [
  "#2dd4bf", // teal / primary
  "#8b5cf6", // violet
  "#3b82f6", // blue
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#10b981", // emerald
  "#f43f5e", // rose
  "#a3e635", // lime
  "#e879f9", // fuchsia
  "#94a3b8" // slate
];

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

interface DonutProps {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerValue?: string | number;
  centerLabel?: string;
}

// A multi-segment donut. Segments start at 12 o'clock and go clockwise.
export function Donut({ data, size = 180, thickness = 22, centerValue, centerLabel }: DonutProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = data
    .filter((d) => d.value > 0)
    .map((d, i) => {
      const frac = total > 0 ? d.value / total : 0;
      const dash = frac * circumference;
      const seg = {
        color: d.color ?? CHART_PALETTE[i % CHART_PALETTE.length],
        dasharray: `${dash} ${circumference - dash}`,
        dashoffset: -offset
      };
      offset += dash;
      return seg;
    });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel ?? "Donut chart"}>
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={s.dasharray}
              strokeDashoffset={s.dashoffset}
              strokeLinecap="butt"
            />
          ))}
      </g>
      {centerValue !== undefined ? (
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-white text-xl font-semibold">
          {centerValue}
        </text>
      ) : null}
      {centerLabel ? (
        <text x={cx} y={cy + 16} textAnchor="middle" className="fill-slate-400 text-[10px] uppercase tracking-wide">
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}

// A simple legend to accompany a Donut.
export function DonutLegend({ data }: { data: DonutSlice[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <ul className="space-y-1.5">
      {data
        .filter((d) => d.value > 0)
        .map((d, i) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <li key={d.label} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: d.color ?? CHART_PALETTE[i % CHART_PALETTE.length] }}
              />
              <span className="flex-1 truncate text-slate-300" title={d.label}>
                {d.label}
              </span>
              <span className="tabular-nums text-slate-400">
                {d.value} <span className="text-xs text-slate-500">{pct}%</span>
              </span>
            </li>
          );
        })}
    </ul>
  );
}

type GaugeTone = "good" | "warn" | "bad" | "default";
const GAUGE_COLOR: Record<GaugeTone, string> = {
  good: "#10b981",
  warn: "#f59e0b",
  bad: "#f43f5e",
  default: "#2dd4bf"
};

interface RadialGaugeProps {
  value: number; // numerator
  max: number; // denominator
  size?: number;
  thickness?: number;
  label?: string;
  tone?: GaugeTone;
}

// A single-ratio radial gauge showing value/max as a percentage.
export function RadialGauge({ value, max, size = 140, thickness = 12, label, tone = "default" }: RadialGaugeProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;
  const color = GAUGE_COLOR[tone];

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? "Gauge"}: ${pct}%`}>
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={thickness} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round"
          />
        </g>
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-white text-2xl font-semibold">
          {pct}%
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" className="fill-slate-400 text-[10px] tabular-nums">
          {value.toLocaleString()} / {max.toLocaleString()}
        </text>
      </svg>
      {label ? <p className="mt-1 text-sm text-slate-300">{label}</p> : null}
    </div>
  );
}
