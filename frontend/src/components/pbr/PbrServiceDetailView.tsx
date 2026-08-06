import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { fetchPbrBlastRadius, fetchPbrHealthHistory, fetchPbrServiceDetail } from "@/services/pbr";
import { resolveCgnatDeviceByIp } from "@/services/cgnat";
import { toast } from "@/components/ui/toast";
import { PbrBlastRadius, PbrEpgGroup, PbrHealthHistory, PbrNode, PbrRedirectDestDetail, PbrServiceDetail } from "@/types";
import { PbrHealthSparkline } from "./PbrHealthSparkline";
import { PbrTopology } from "./PbrTopology";

const dash = <span className="text-slate-600">—</span>;
const fmt = (v?: string | null) => (v ? <>{v}</> : dash);
const pct = (v?: number | null) => (v === undefined || v === null ? "N/A" : `${Math.round(v)}%`);

// Per-node health breakdown metric, matching the prototype's computeServiceHealth text.
function metric(n: PbrNode): string {
  if (n.bypassed) {
    const t = n.detail.threshold;
    return `bypassed by design (active ${t.active_pct ?? 0}% < min ${t.min}%, down action: ${t.action})`;
  }
  if (n.detail.device_layer === "L1") return "interface config resolved";
  return `${n.learned_dest_count}/${n.configured_dest_count} redirect IPs learned`;
}

function EpgBlock({ title, groups, accent }: { title: string; groups: PbrEpgGroup[]; accent: string }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: accent }}>{title}</h4>
      {groups.length === 0 ? (
        <span className="text-sm text-slate-500">none on record</span>
      ) : (
        <div className="space-y-3">
          {groups.map((g, i) => (
            <div key={i}>
              <div className="font-mono text-[13px] text-slate-200">
                {g.l3out} <span className="text-slate-500">/</span> {g.epg}
              </div>
              {/* Only "External Subnets for the External EPG" (scope contains
                  import-security) are shown — the classification-valid set. */}
              <div className="mt-1 flex flex-wrap gap-1">
                {g.subnets.length === 0 ? (
                  <span className="text-xs text-slate-500">no scope-valid subnets on record</span>
                ) : (
                  g.subnets.map((s) => (
                    <span key={s} className="rounded border border-brand-700 bg-brand-800/60 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                      {s}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-brand-800/40 py-1 text-sm last:border-0">
      <span className="text-slate-500">{k}</span>
      <span className="text-right font-mono text-[12px] text-slate-200">{children}</span>
    </div>
  );
}

function ThresholdRows({ n }: { n: PbrNode }) {
  const t = n.detail.threshold;
  if (!t.enable) {
    return <KV k="Threshold"><span className="text-slate-500">not enabled on this redirect policy</span></KV>;
  }
  const cfg = `min ${t.min}% / max ${t.max}% → down action: ${t.action}`;
  return (
    <>
      <KV k="Threshold">{cfg}</KV>
      {n.detail.device_layer === "L1" ? (
        <KV k="Active %"><span className="text-slate-500">not available for L1 members in this environment</span></KV>
      ) : t.active_pct !== undefined && t.active_pct !== null ? (
        <KV k="Active %">
          <span className={t.breached ? "font-semibold text-amber-300" : "font-semibold text-emerald-300"}>
            {t.active_pct}%{t.breached ? " — below min" : ""}
          </span>
        </KV>
      ) : null}
      {n.bypassed ? (
        <div className="mt-1.5 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
          ⚠ THRESHOLD BREACHED — active {t.active_pct ?? 0}% fell below min {t.min}%. Down Action = <b>{t.action}</b>:
          traffic no longer passes through this node; service continues without it.
        </div>
      ) : t.action === "deny" && t.breached ? (
        <div className="mt-1.5 rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
          ⚠ THRESHOLD BREACHED — Down Action = deny: traffic through this node is being dropped, not bypassed.
        </div>
      ) : null}
    </>
  );
}

function DestIp({ ip, className, onOpen }: { ip: string; className: string; onOpen?: (ip: string) => void }) {
  return (
    <span
      className={`${className} cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid`}
      title="Double-click to open the matching CGNAT inventory device"
      onDoubleClick={() => onOpen?.(ip)}
    >
      {ip}
    </span>
  );
}

function DestLine({ r, onOpen }: { r: PbrRedirectDestDetail; onOpen?: (ip: string) => void }) {
  return r.active ? (
    <div>
      <DestIp ip={r.ip} className="font-semibold text-emerald-300" onOpen={onOpen} />{" "}
      <span className="text-slate-500">({r.learned_mac}, learned)</span>
    </div>
  ) : (
    <div className="text-rose-300">
      <DestIp ip={r.ip} className="font-semibold" onOpen={onOpen} /> (not learned — no active endpoint, possible fault)
    </div>
  );
}

const ifaceLine = (r: { interface?: string | null; device?: string | null }, i: number) => (
  <div key={i}>{r.interface} <span className="text-slate-500">({r.device})</span></div>
);

function NodeCard({ n, onOpenIp }: { n: PbrNode; onOpenIp?: (ip: string) => void }) {
  const d = n.detail;
  const isL1 = d.device_layer === "L1";
  const dests = d.redirect_dests ?? [];
  const inDests = dests.filter((r) => r.side === "in");
  const outDests = dests.filter((r) => r.side === "out");
  const destsHaveSide = inDests.length > 0 || outDests.length > 0;
  const consIf = d.redirect_interfaces?.consumer ?? [];
  const provIf = d.redirect_interfaces?.provider ?? [];
  return (
    <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-3">
      <div className="mb-2 flex items-center justify-between border-b border-brand-800/70 pb-2">
        <span className="text-sm font-semibold text-slate-100">{d.node} · {d.devgrp}</span>
        <span className="rounded border border-brand-600 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{d.device_layer}</span>
      </div>
      <KV k="Leaf/path">{d.leafs?.length ? d.leafs.join(", ") : dash}</KV>
      <KV k="Consumer BD">{fmt(d.consumer_bd)}</KV>
      <KV k="Consumer VRF">{fmt(d.consumer_vrf)}</KV>
      <KV k="Consumer VLAN">{fmt(d.consumer_lif_encap)}</KV>
      <KV k="Provider BD">{fmt(d.provider_bd)}</KV>
      <KV k="Provider L3Out">{d.provider_l3out ? d.provider_l3out.filter(Boolean).join("/") : dash}</KV>
      <KV k="Provider VRF">{fmt(d.provider_vrf)}</KV>
      <KV k="Provider VLAN">{fmt(d.provider_lif_encap)}</KV>
      <KV k="Redirect policy">
        {[d.consumer_redirect_policy && `in: ${d.consumer_redirect_policy}`, d.provider_redirect_policy && `out: ${d.provider_redirect_policy}`]
          .filter(Boolean)
          .join(" / ") || dash}
      </KV>
      <ThresholdRows n={n} />
      {/* IN and OUT as separate rows. */}
      {isL1 ? (
        !consIf.length && !provIf.length ? (
          <KV k="Redirect interface"><span className="text-slate-500">no interface data</span></KV>
        ) : (
          <>
            <KV k="Redirect interface (in)"><div className="text-right">{consIf.length ? consIf.map(ifaceLine) : dash}</div></KV>
            <KV k="Redirect interface (out)"><div className="text-right">{provIf.length ? provIf.map(ifaceLine) : dash}</div></KV>
          </>
        )
      ) : dests.length === 0 ? (
        <KV k="Redirect dest">{dash}</KV>
      ) : destsHaveSide ? (
        <>
          <KV k="Redirect dest (in)"><div className="text-right">{inDests.length ? inDests.map((r, i) => <DestLine key={i} r={r} onOpen={onOpenIp} />) : dash}</div></KV>
          <KV k="Redirect dest (out)"><div className="text-right">{outDests.length ? outDests.map((r, i) => <DestLine key={i} r={r} onOpen={onOpenIp} />) : dash}</div></KV>
        </>
      ) : (
        <KV k="Redirect dest"><div className="text-right">{dests.map((r, i) => <DestLine key={i} r={r} onOpen={onOpenIp} />)}</div></KV>
      )}
    </div>
  );
}

export function PbrServiceDetailView({ serviceId, hideEpgBlock }: { serviceId: string; hideEpgBlock?: boolean }) {
  const navigate = useNavigate();
  // Double-click a redirect IP -> open the matching CGNAT device, or toast if unknown.
  const openIp = async (ip: string) => {
    try {
      const res = await resolveCgnatDeviceByIp(ip);
      if (res.found && res.device_id) {
        navigate(`/cgnat/devices/${res.device_id}`);
      } else {
        toast.warning("Not in CGNAT inventory", `${ip} is not present in our CGNAT inventory.`);
      }
    } catch {
      toast.error("Lookup failed", `Could not resolve ${ip} against the CGNAT inventory.`);
    }
  };

  const [detail, setDetail] = useState<PbrServiceDetail | null>(null);
  const [blast, setBlast] = useState<PbrBlastRadius | null>(null);
  const [history, setHistory] = useState<PbrHealthHistory | null>(null);
  const [loading, setLoading] = useState(true);
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
        if (cancelled) return;
        setDetail(d);
        setBlast(b);
        setHistory(h);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load PBR service detail", err);
        setError("Unable to load service detail. Please retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  if (loading) return <div className="px-4 py-4 text-sm text-slate-400">Loading service detail…</div>;
  if (error) return <div className="px-4 py-3 text-sm text-rose-200">{error}</div>;
  if (!detail) return null;

  return (
    <div className="space-y-5 border-t border-brand-800/70 bg-brand-950/30 px-4 py-4">
      {/* External EPGs + subnets (hidden in flow-lookup, which shows only the matched EPG) */}
      {hideEpgBlock ? null : (
        <div className="grid gap-6 lg:grid-cols-2">
          <EpgBlock title="Consumer External EPG(s)" groups={detail.consumer_epgs} accent="#4fd1c5" />
          <EpgBlock title="Provider External EPG(s)" groups={detail.provider_epgs} accent="#fbbf24" />
        </div>
      )}

      {/* Health breakdown + trend */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Health breakdown ({pct(detail.health_pct)} overall)
        </h4>
        <div className="max-w-xl rounded-lg border border-brand-700 bg-brand-900/60 p-3">
          {detail.nodes.length === 0 ? (
            <div className="text-sm text-slate-500">no redirect IPs/interfaces configured on any node</div>
          ) : (
            detail.nodes.map((n) => (
              <div key={n.id} className="flex justify-between gap-3 border-b border-brand-800/40 py-1 text-sm last:border-0">
                <span className="text-slate-400">{n.detail.node} ({n.detail.device_layer})</span>
                <span className="text-right text-slate-200">{metric(n)} — {pct(n.health_pct)}</span>
              </div>
            ))
          )}
          <div className="mt-3"><PbrHealthSparkline samples={history?.samples ?? []} state={detail.state} /></div>
        </div>
      </div>

      {/* Blast radius */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Blast radius — what else shares this device group
        </h4>
        {!blast || blast.items.length === 0 ? (
          <p className="rounded-md border border-brand-800/70 bg-brand-900/40 px-3 py-2 text-sm text-slate-400">
            No other PBR service in this fabric shares a device group — touching this device should be isolated to this service.
          </p>
        ) : (
          <>
            <p className="mb-1 text-xs text-amber-300/80">⚠ {blast.items.length} other service(s) share a device group with this one</p>
            <ul className="space-y-1">
              {blast.items.map((item) => (
                <li key={item.service_id} className="flex flex-wrap items-center gap-2 rounded-md border border-brand-800/70 bg-brand-900/40 px-3 py-2 text-sm">
                  <span className="font-medium text-slate-100">{item.contract_name}</span>
                  <span className="text-slate-500">/ {item.graph_name}</span>
                  <span className="ml-auto text-[11px] text-slate-500">via device group {item.shared_device_groups.join(", ")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Topology */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          PBR topology — {detail.nodes.length} node chain
        </h4>
        <PbrTopology service={detail} />
      </div>

      {/* Node detail cards */}
      {detail.nodes.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {detail.nodes.map((n) => <NodeCard key={n.id} n={n} onOpenIp={openIp} />)}
        </div>
      ) : null}
    </div>
  );
}
