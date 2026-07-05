import { useEffect, useState } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { fetchAciFabricVlans } from "@/services/aci";
import { AciFabricVlan } from "@/types";

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const formatLabel = (value?: string | null) => {
  if (value === undefined || value === null || value === "") {
    return "--";
  }
  return value;
};

export function AciVlansPage() {
  const [vlans, setVlans] = useState<AciFabricVlan[]>([]);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState<number>(0);
  const [hasPrev, setHasPrev] = useState<boolean>(false);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      try {
        const response = await fetchAciFabricVlans({
          search: search || undefined,
          page,
          pageSize
        });
        if (cancelled) {
          return;
        }

        const totalCount = response.total;
        if (totalCount === 0 && page !== 1) {
          setVlans([]);
          setTotal(0);
          setHasPrev(false);
          setHasNext(false);
          setPage(1);
          setError(null);
          return;
        }

        setVlans(response.items);
        setTotal(totalCount);
        setHasPrev(response.has_prev);
        setHasNext(response.has_next);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load ACI VLANs", err);
        setError("Unable to load Cisco ACI VLAN data. Please retry.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [search, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = vlans.length > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = vlans.length > 0 ? rangeStart + vlans.length - 1 : 0;
  const disablePrev = isLoading || !hasPrev;
  const disableNext = isLoading || !hasNext;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">Cisco ACI VLAN Inventory</h1>
            <p className="mt-1 text-sm text-slate-300">
              Deployed access VLANs per fabric, mapped to EPG / bridge domain / VRF, with leaf deployment count.
            </p>
          </div>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search VLAN, EPG, tenant, BD, VRF, fabric..."
            className="w-full rounded-md border border-brand-700 bg-brand-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 sm:w-96"
          />
        </header>

        {error ? (
          <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">VLANs</p>
            <p className="mt-2 text-2xl font-semibold text-white">{total}</p>
            <p className="mt-1 text-[13px] text-slate-400">Distinct deployed access VLANs across all fabrics</p>
          </div>
        </section>

        <section className="rounded-lg border border-brand-700 bg-brand-900/60">
          <div className="border-b border-brand-800/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-100">VLAN Directory</h2>
            <p className="text-xs text-slate-400">VLAN ID, encapsulation, EPG binding, bridge domain, VRF, and leaf spread.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-brand-800/70 text-sm">
              <thead className="bg-brand-900/70 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">Fabric</th>
                  <th className="px-4 py-3 text-left">VLAN</th>
                  <th className="px-4 py-3 text-left">EPG</th>
                  <th className="px-4 py-3 text-left">Tenant / App</th>
                  <th className="px-4 py-3 text-left">Bridge Domain</th>
                  <th className="px-4 py-3 text-left">VRF</th>
                  <th className="px-4 py-3 text-left">VXLAN</th>
                  <th className="px-4 py-3 text-right">Nodes</th>
                  <th className="px-4 py-3 text-left">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/60 text-slate-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-400">
                      Loading Cisco ACI VLANs…
                    </td>
                  </tr>
                ) : vlans.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-sm text-slate-400">
                      No VLANs match the current filters.
                    </td>
                  </tr>
                ) : (
                  vlans.map((vlan) => (
                    <tr key={vlan.id} className="hover:bg-brand-800/40">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-100">{vlan.fabric_name ?? "--"}</div>
                        <div className="text-xs text-slate-500">{vlan.fabric_ip ?? "--"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-base font-semibold text-primary-200">{vlan.vlan_id ?? "--"}</div>
                        {vlan.mode ? <div className="text-[11px] uppercase tracking-wide text-slate-500">{vlan.mode}</div> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(vlan.epg)}</td>
                      <td className="px-4 py-3">
                        <div className="text-slate-100">{formatLabel(vlan.tenant)}</div>
                        <div className="text-xs text-slate-500">{formatLabel(vlan.app_profile)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(vlan.bridge_domain)}</td>
                      <td className="px-4 py-3 text-slate-100">{formatLabel(vlan.vrf)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{formatLabel(vlan.fab_encap)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm font-semibold text-slate-100">{vlan.node_count}</span>
                        {vlan.nodes.length > 0 ? (
                          <div className="text-[11px] text-slate-500">{vlan.nodes.join(", ")}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide ${
                            (vlan.oper_state ?? "").toLowerCase() === "up"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                              : "border-slate-500/40 bg-slate-500/10 text-slate-300"
                          }`}
                        >
                          {vlan.oper_state ?? "--"}
                        </span>
                      </td>
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
                  ? `Showing ${rangeStart}-${rangeEnd} of ${total} VLANs`
                  : isLoading
                  ? "Loading Cisco ACI VLANs…"
                  : "No VLANs to display"}
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
