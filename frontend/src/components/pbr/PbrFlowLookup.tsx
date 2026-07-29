import { FormEvent, useState } from "react";
import { isAxiosError } from "axios";

import { pbrFlowLookup } from "@/services/pbr";
import { PbrFlowLookupResult } from "@/types";

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
        <div className="mt-3 space-y-2">
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
              <ul className="space-y-1">
                {result.candidates.map((c, idx) => (
                  <li
                    key={`${c.service_id ?? "svc"}-${idx}`}
                    className="rounded-md border border-brand-800/70 bg-brand-900/40 px-3 py-2 text-sm"
                  >
                    <div className="font-medium text-slate-100">{c.contract_dn}</div>
                    <div className="text-xs text-slate-400">
                      {c.src_prefix} → {c.dst_prefix}
                      {c.used_default_route ? " · via default route" : " · specific subnet"}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
