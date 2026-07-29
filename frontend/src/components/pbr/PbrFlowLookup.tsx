import { FormEvent, useState } from "react";
import { isAxiosError } from "axios";

import { pbrFlowLookup } from "@/services/pbr";
import { PbrFlowCandidate, PbrFlowLookupResult } from "@/types";
import { PbrServiceDetailView } from "./PbrServiceDetailView";

const shortName = (dn: string) => dn.split("/brc-").pop()?.split("/").pop() ?? dn;
const prefixLen = (cidr: string) => cidr.split("/")[1] ?? "";

// A matched flow renders the full service (EPGs, topology, node cards) plus the
// consumer/provider match basis — parity with the prototype's flow-lookup result.
function MatchedFlowCard({ candidate }: { candidate: PbrFlowCandidate }) {
  const consumerPrefix = candidate.src_side === "consumer" ? candidate.src_prefix : candidate.dst_prefix;
  const providerPrefix = candidate.src_side === "consumer" ? candidate.dst_prefix : candidate.src_prefix;
  return (
    <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/5">
      <div className="border-b border-emerald-500/30 px-4 py-2">
        <div className="text-sm font-semibold text-emerald-300">Matched — {shortName(candidate.contract_dn)}</div>
        <div className="text-xs text-slate-400">
          both source and destination fall on opposite sides of the same service — a genuine end-to-end match
          {candidate.used_default_route ? " (via default route)" : ""}
        </div>
      </div>
      {candidate.service_id ? <PbrServiceDetailView serviceId={candidate.service_id} /> : null}
      <div className="border-t border-emerald-500/30 px-4 py-2 font-mono text-[11px] text-slate-400">
        Consumer-side match: <span className="text-teal-300">{consumerPrefix}</span> (/{prefixLen(consumerPrefix)}) ·
        Provider-side match: <span className="text-amber-300">{providerPrefix}</span> (/{prefixLen(providerPrefix)})
      </div>
    </div>
  );
}

// Light client-side validation mirroring the server rules (SDD §5.3 / §10.2). The
// server re-validates authoritatively; this is just fast feedback.
function clientValidate(source: string, destination: string): string | null {
  const check = (value: string, label: string) => {
    const v = value.trim();
    if (!v) {
      return `${label} is required.`;
    }
    if (v.includes("/")) {
      return `${label} must be a single host address, not a prefix/CIDR.`;
    }
    return null;
  };
  return check(source, "Source address") ?? check(destination, "Destination address");
}

export function PbrFlowLookup({ fabricId }: { fabricId: string }) {
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
      const res = await pbrFlowLookup(fabricId, source.trim(), destination.trim());
      setResult(res);
    } catch (err) {
      // Surface the server's actionable 422 message (authoritative validation).
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
        Identify which PBR service handles a source → destination flow. Longest-prefix match against scope-valid
        (import-security) subnets; ties are surfaced, never silently resolved.
      </p>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Source IP
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. 10.10.0.5"
            className="w-48 rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Destination IP
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. 172.16.0.9"
            className="w-48 rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-primary-500 bg-primary-500/20 px-4 py-2 text-sm font-semibold text-primary-100 transition hover:bg-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Looking up…" : "Look up flow"}
        </button>
      </form>

      {error ? (
        <div className="mt-3 rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-3">
          {!result.matched ? (
            <p className="rounded border border-slate-500/40 bg-slate-500/10 px-3 py-2 text-sm text-slate-300">
              {result.message ?? "No scope-valid subnet match for this flow."}
            </p>
          ) : (
            <>
              {result.ambiguous ? (
                <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {result.message ?? "Multiple candidate services matched — all shown below."}
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
