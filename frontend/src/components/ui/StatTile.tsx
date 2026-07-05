import { ComponentType } from "react";

export type StatTone = "default" | "good" | "warn" | "bad";

const TONE: Record<StatTone, { value: string; icon: string; ring: string }> = {
  default: { value: "text-white", icon: "text-primary-300 bg-primary-500/15", ring: "border-brand-700" },
  good: { value: "text-emerald-300", icon: "text-emerald-300 bg-emerald-500/15", ring: "border-emerald-600/40" },
  warn: { value: "text-amber-300", icon: "text-amber-300 bg-amber-500/15", ring: "border-amber-600/40" },
  bad: { value: "text-rose-300", icon: "text-rose-300 bg-rose-500/15", ring: "border-rose-600/40" }
};

interface StatTileProps {
  label: string;
  value: number | string;
  hint?: string;
  tone?: StatTone;
  icon?: ComponentType<{ className?: string }>;
}

// A KPI tile with an icon chip and tone-based accent (used across dashboards).
export function StatTile({ label, value, hint, tone = "default", icon: Icon }: StatTileProps) {
  const t = TONE[tone];
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <div className={`rounded-lg border bg-brand-900/60 p-4 ${t.ring}`}>
      <div className="flex items-start justify-between">
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        {Icon ? (
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${t.icon}`}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <p className={`mt-2 text-2xl font-semibold ${t.value}`}>{display}</p>
      {hint ? <p className="mt-1 text-[13px] text-slate-500">{hint}</p> : null}
    </div>
  );
}
