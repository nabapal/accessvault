import { FormEvent, useState } from "react";
import { isAxiosError } from "axios";

import { pbrFlowLookup } from "@/services/pbr";
import { PbrFlowCandidate, PbrFlowLookupResult, PbrServiceState } from "@/types";
import { PbrServiceDetailView } from "./PbrServiceDetailView";

const shortName = (dn: string) => dn.split("/brc-").pop()?.split("/").pop() ?? dn;
const prefixLen = (cidr?: string | null) => (cidr ? cidr.split("/")[1] ?? "" : "");
const fmt = (v?: string | null) => v || "—";

const STATE_TEXT: Record<PbrServiceState, string> = {
  healthy: "text-emerald-300",
  degraded: "text-amber-300",
  down: "text-rose-300",
  unknown: "text-slate-400"
};

// Light client-side validation mirroring the server rules (SDD §5.3).
function clientValidate(source: string, destination: string): string | null {
  const check = (value: string, label: string) => {
    const v = value.trim();
    if (!v) return `${label} is required.`;
    if (v.includes("/")) return `${label} must be a single host address, not a prefix/CIDR.`;
    return null;
  };
  return check(source, "Source address") ?? check(destination, "Destination address");
}

function EpgSide({
  label,
  accent,
  l3out,
  epg,
  subnet,
  isDefault,
  side
}: {
  label: string;
  accent: string;
  l3out?: string | null;
  epg?: string | null;
  subnet?: string | null;
  isDefault: boolean;
  side: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>{label}</div>
      <div className="mt-1 font-mono text-[13px] text-slate-200">
        {fmt(l3out)} <span className="text-slate-500">/</span> {fmt(epg)} <span className="text-emerald-300">✓ selected</span>
        <span className="text-slate-500"> — {side}</span>
        {isDefault ? <span className="text-slate-500"> · via default route</span> : null}
      </div>
      {subnet ? (
        <div className="mt-1">
          <span className="rounded border border-brand-700 bg-brand-800/60 px-1.5 py-0.5 font-mono text-[11px]" style={{ color: accent }}>
            {subnet}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// A matched flow shows only the best-matching consumer/provider EPG (not all EPGs/pools),
// names the ACI fabric it came from, then the topology + node cards.
function MatchedFlowCard({ candidate }: { candidate: PbrFlowCandidate }) {
  const note = candidate.used_default_route
    ? "one IP matched a specific pool; the other falls under the default-route (0.0.0.0/0 · ::/0) pool of the same contract's opposite side"
    : "both source and destination fall on opposite sides of the same service — a genuine end-to-end match";
  return (
    <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/5">
      <div className="border-b border-emerald-500/30 px-4 py-2">
        <div className="text-sm font-semibold text-emerald-300">
          Matched — {candidate.contract_name ?? shortName(candidate.contract_dn)}
        </div>
        <div className="text-xs text-slate-400">
          <span className="font-semibold text-slate-200">{fmt(candidate.fabric_name)}</span> · service graph{" "}
          {fmt(candidate.graph_name)} · status{" "}
          <span className={STATE_TEXT[candidate.state ?? "unknown"]}>{(candidate.state ?? "unknown").toUpperCase()}</span> · {note}
        </div>
      </div>

      <div className="grid gap-4 px-4 py-3 lg:grid-cols-2">
        <EpgSide label="Consumer External EPG" accent="#4fd1c5" l3out={candidate.consumer_l3out} epg={candidate.consumer_epg} subnet={candidate.consumer_subnet} isDefault={candidate.consumer_default} side="consumer" />
        <EpgSide label="Provider External EPG" accent="#fbbf24" l3out={candidate.provider_l3out} epg={candidate.provider_epg} subnet={candidate.provider_subnet} isDefault={candidate.provider_default} side="provider" />
      </div>

      {candidate.service_id ? <PbrServiceDetailView serviceId={candidate.service_id} hideEpgBlock /> : null}

      <div className="border-t border-emerald-500/30 px-4 py-2 font-mono text-[11px] text-slate-400">
        Consumer-side match: <span className="text-teal-300">{fmt(candidate.consumer_subnet)}</span> (/{prefixLen(candidate.consumer_subnet)}) ·
        Provider-side match: <span className="text-amber-300">{fmt(candidate.provider_subnet)}</span> (/{prefixLen(candidate.provider_subnet)}) ·
        fabric tenant {fmt(candidate.fabric_tenant)}
      </div>
    </div>
  );
}

export function PbrFlowLookup() {
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [result, setResult] = useState<PbrFlowLookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    const clientError = clientValidate(source, destination);
    if (clientError) {
      setError(clientError);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await pbrFlowLookup(source.trim(), destination.trim());
      setResult(res);
    } catch (err) {
      if (isAxiosError(err) && err.response?.data?.detail) {
        setError(String(err.response.data.detail));
      } else {
        console.error("Flow lookup failed", err);
        setError("Flow lookup failed. Please retry.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
      <h2 className="text-sm font-semibold text-slate-100">IP-flow lookup</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        Identify which PBR service handles a source → destination flow, across <b>all fabrics</b>. Longest-prefix match
        against scope-valid (import-security) subnets; ties are surfaced, never silently resolved.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Source IP
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. 10.61.145.70"
            className="w-56 rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Destination IP
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. 64:ff9b::1"
            className="w-56 rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-primary-500 bg-primary-500/20 px-4 py-2 text-sm font-semibold text-primary-100 transition hover:bg-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Looking up…" : "Identify flow"}
        </button>
      </form>

      {error ? (
        <div className="mt-3 rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-3">
          {!result.matched ? (
            <p className="rounded border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-sm text-slate-300">
              {result.message ?? "No scope-valid subnet match for this flow in any fabric."}
            </p>
          ) : (
            <>
              {result.match_count > 1 ? (
                <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {result.match_count} matching service graphs — the same source/destination resolves to more than one
                  service; all are shown below.
                </p>
              ) : null}
              {result.candidates.map((c, idx) => (
                <MatchedFlowCard key={`${c.service_id ?? "svc"}-${idx}`} candidate={c} />
              ))}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
