import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { fetchIpMplsTopology } from "@/services/ipmpls";
import { IpMplsTopology, IpMplsTopologyNode } from "@/types";

const W = 1000;
const H = 680;

const ROLE_COLORS: Record<string, string> = {
  SAR: "#22d3ee",
  AG1: "#f59e0b",
  AG2: "#34d399",
  AG3: "#c084fc",
  CRR: "#f472b6",
  external: "#64748b"
};

const colorFor = (node: IpMplsTopologyNode): string => {
  if (node.kind === "external") return ROLE_COLORS.external;
  return ROLE_COLORS[(node.role || "").toUpperCase()] ?? "#38bdf8";
};

interface Pt {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

// Fruchterman–Reingold force layout, computed once per dataset.
function computeLayout(topo: IpMplsTopology): Map<string, Pt> {
  const nodes = topo.nodes;
  const pos = new Map<string, Pt>();
  const n = Math.max(nodes.length, 1);
  const radius = Math.min(W, H) * 0.4;
  nodes.forEach((node, i) => {
    const a = (2 * Math.PI * i) / n;
    pos.set(node.id, { x: W / 2 + Math.cos(a) * radius, y: H / 2 + Math.sin(a) * radius, fx: 0, fy: 0 });
  });
  const pairs = topo.links
    .map((l) => [l.source, l.target] as const)
    .filter(([a, b]) => pos.has(a) && pos.has(b));
  const k = Math.sqrt((W * H) / n);
  const iterations = 320;
  for (let it = 0; it < iterations; it++) {
    const cooling = 1 - it / iterations;
    for (const p of pos.values()) {
      p.fx = 0;
      p.fy = 0;
    }
    for (let i = 0; i < nodes.length; i++) {
      const pi = pos.get(nodes[i].id)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const pj = pos.get(nodes[j].id)!;
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          d2 = 0.01;
          dx = Math.random();
          dy = Math.random();
        }
        const d = Math.sqrt(d2);
        const f = (k * k) / d2;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        pi.fx += ux;
        pi.fy += uy;
        pj.fx -= ux;
        pj.fy -= uy;
      }
    }
    for (const [a, b] of pairs) {
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k;
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      pa.fx -= ux;
      pa.fy -= uy;
      pb.fx += ux;
      pb.fy += uy;
    }
    const maxStep = 12 * cooling + 1;
    for (const p of pos.values()) {
      p.fx += (W / 2 - p.x) * 0.012;
      p.fy += (H / 2 - p.y) * 0.012;
      const disp = Math.sqrt(p.fx * p.fx + p.fy * p.fy) || 0.01;
      p.x += (p.fx / disp) * Math.min(disp, maxStep);
      p.y += (p.fy / disp) * Math.min(disp, maxStep);
      p.x = Math.max(24, Math.min(W - 24, p.x));
      p.y = Math.max(24, Math.min(H - 24, p.y));
    }
  }
  return pos;
}

export function IpMplsTopologyPage() {
  const navigate = useNavigate();
  const [topo, setTopo] = useState<IpMplsTopology | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchIpMplsTopology("isis");
        if (!cancelled) {
          setTopo(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load topology", err);
          setError("Unable to load topology. Please retry.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pos = useMemo(() => (topo ? computeLayout(topo) : new Map<string, Pt>()), [topo]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    topo?.links.forEach((l) => {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    });
    return m;
  }, [topo]);

  const nodeById = useMemo(() => new Map((topo?.nodes ?? []).map((n) => [n.id, n])), [topo]);
  const rolesPresent = useMemo(() => {
    const set = new Set<string>();
    topo?.nodes.forEach((n) => set.add(n.kind === "external" ? "external" : (n.role || "other").toUpperCase()));
    return Array.from(set);
  }, [topo]);

  const isDim = (id: string) => hover !== null && id !== hover && !(adjacency.get(hover)?.has(id) ?? false);

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">IP-MPLS Topology</h1>
            <p className="mt-1 text-sm text-slate-300">
              Link-state adjacency graph built from collected ISIS neighbors across all devices.
            </p>
          </div>
          {topo ? (
            <div className="flex gap-3 text-sm">
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-2 text-center">
                <div className="text-lg font-semibold text-white">{topo.total_nodes}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Nodes</div>
              </div>
              <div className="rounded-lg border border-brand-700 bg-brand-900/60 px-4 py-2 text-center">
                <div className="text-lg font-semibold text-primary-200">{topo.total_links}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-400">Links</div>
              </div>
            </div>
          ) : null}
        </header>

        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        {rolesPresent.length ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
            {rolesPresent.map((r) => (
              <span key={r} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: ROLE_COLORS[r] ?? "#38bdf8" }} />
                {r}
              </span>
            ))}
            <span className="text-slate-500">• hover a node to highlight its links • click a device to open it</span>
          </div>
        ) : null}

        <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-2">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-slate-400">Computing topology…</div>
          ) : topo && topo.nodes.length ? (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="IP-MPLS topology">
              {topo.links.map((l, i) => {
                const a = pos.get(l.source);
                const b = pos.get(l.target);
                if (!a || !b) return null;
                const active = hover !== null && (l.source === hover || l.target === hover);
                const dim = hover !== null && !active;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={active ? "#22d3ee" : "#334155"}
                    strokeWidth={active ? 1.8 : 1}
                    strokeOpacity={dim ? 0.12 : active ? 0.9 : 0.45}
                  />
                );
              })}
              {topo.nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const dim = isDim(n.id);
                const isDevice = n.kind === "device";
                const r = isDevice ? 7 : 4.5;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: isDevice ? "pointer" : "default", opacity: dim ? 0.25 : 1 }}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => isDevice && n.device_id && navigate(`/ipmpls/devices/${n.device_id}`)}
                  >
                    <circle r={r} fill={colorFor(n)} stroke="#0b1325" strokeWidth={1.5} />
                    {isDevice || n.id === hover ? (
                      <text x={r + 3} y={3} fontSize={9} fill="#cbd5e1" className="select-none">
                        {n.name}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="p-10 text-center text-sm text-slate-400">
              No topology yet. Register IP-MPLS devices and let them poll (ISIS adjacencies build the graph).
            </div>
          )}
        </section>

        {hover && nodeById.get(hover) ? (
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-3 text-sm text-slate-300">
            <span className="font-semibold text-white">{nodeById.get(hover)!.name}</span>
            {nodeById.get(hover)!.kind === "device" ? (
              <> · {nodeById.get(hover)!.role ?? "--"} · {nodeById.get(hover)!.site ?? "--"}</>
            ) : (
              <> · external neighbor</>
            )}
            {" · "}
            {adjacency.get(hover)?.size ?? 0} adjacencies
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
