import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";

import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { fetchNxosTopology } from "@/services/nxos";
import { locationFromName } from "@/utils/location";
import { NxosTopology, NxosTopologyLink, NxosTopologyNode } from "@/types";

const ROLE_COLOR: Record<string, string> = {
  Nexus: "#2dd4bf",
  external: "#64748b"
};
const roleColor = (role?: string | null, kind?: string) =>
  kind === "external" ? ROLE_COLOR.external : ROLE_COLOR[role ?? ""] ?? "#3b82f6";

interface LinkInfo {
  a: NxosTopologyNode;
  b: NxosTopologyNode;
  link: NxosTopologyLink;
}

export function NxosTopologyPage() {
  const navigate = useNavigate();
  const [topo, setTopo] = useState<NxosTopology | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set());
  const [locFilter, setLocFilter] = useState<Set<string>>(new Set());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const graphWrapRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await fetchNxosTopology();
        if (!cancelled) {
          setTopo(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load NX-OS topology", err);
          setError("Unable to load NX-OS topology.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nodeById = useMemo(() => {
    const m = new Map<string, NxosTopologyNode>();
    topo?.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [topo]);

  const roles = useMemo(() => {
    const s = new Set<string>();
    topo?.nodes.forEach((n) => n.kind === "device" && s.add(n.role ?? "unknown"));
    return [...s].sort();
  }, [topo]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    topo?.nodes.forEach((n) => n.kind === "device" && s.add(locationFromName(n.name)));
    return [...s].sort();
  }, [topo]);

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    topo?.nodes.forEach((n) => {
      if (n.kind === "external") return; // add later if attached to a visible link
      if (roleFilter.size && !roleFilter.has(n.role ?? "unknown")) return;
      if (locFilter.size && !locFilter.has(locationFromName(n.name))) return;
      ids.add(n.id);
    });
    return ids;
  }, [topo, roleFilter, locFilter]);

  const shownLinks = useMemo(() => {
    if (!topo) return [] as NxosTopologyLink[];
    return topo.links.filter((l) => visibleNodeIds.has(l.source) || visibleNodeIds.has(l.target));
  }, [topo, visibleNodeIds]);

  const elements = useMemo<ElementDefinition[]>(() => {
    if (!topo) return [];
    const nodeIds = new Set(visibleNodeIds);
    // include external/other endpoints attached to shown links
    shownLinks.forEach((l) => {
      nodeIds.add(l.source);
      nodeIds.add(l.target);
    });
    const els: ElementDefinition[] = [];
    nodeIds.forEach((id) => {
      const n = nodeById.get(id);
      if (!n) return;
      els.push({
        data: { id: n.id, label: n.name, color: roleColor(n.role, n.kind), kind: n.kind }
      });
    });
    shownLinks.forEach((l, idx) => {
      els.push({
        data: {
          id: `e${idx}`,
          source: l.source,
          target: l.target,
          width: Math.min(2 + l.count / 4, 8),
          key: `${l.source}__${l.target}`
        }
      });
    });
    return els;
  }, [topo, shownLinks, visibleNodeIds, nodeById]);

  const linkByKey = useMemo(() => {
    const m = new Map<string, NxosTopologyLink>();
    shownLinks.forEach((l) => m.set(`${l.source}__${l.target}`, l));
    return m;
  }, [shownLinks]);

  // Bind edge/node handlers once per cy via a ref that always sees fresh data.
  const dataRef = useRef({ linkByKey, nodeById });
  dataRef.current = { linkByKey, nodeById };

  const registerCy = (cy: Core) => {
    cyRef.current = cy;
    cy.removeListener("tap");
    cy.on("tap", "edge", (evt) => {
      const key = evt.target.data("key") as string;
      const link = dataRef.current.linkByKey.get(key);
      if (!link) return;
      const a = dataRef.current.nodeById.get(link.source);
      const b = dataRef.current.nodeById.get(link.target);
      if (a && b) setLinkInfo({ a, b, link });
    });
    cy.on("tap", "node", (evt) => {
      const n = dataRef.current.nodeById.get(evt.target.id());
      if (n?.kind === "device" && n.device_id) navigate(`/nxos/devices/${n.device_id}`);
    });
  };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };

  const enterFullscreen = () => {
    const el = graphWrapRef.current;
    if (el?.requestFullscreen) el.requestFullscreen();
  };
  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setTimeout(() => cyRef.current?.resize(), 100);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? "border-primary-500 bg-primary-600 text-white" : "border-brand-700 bg-brand-900/70 text-slate-300 hover:border-primary-500/60"
    }`;

  return (
    <AppShell>
      <div className="space-y-4">
        <PageHeader
          title="NX-OS Topology"
          description="Layer-2 adjacency graph from CDP + LLDP. Click a link for detail; click a device to open it."
          actions={
            <button
              type="button"
              onClick={enterFullscreen}
              className="rounded-md border border-brand-700 bg-brand-800/60 px-3 py-2 text-sm text-slate-200 transition hover:border-primary-500"
            >
              Fullscreen
            </button>
          }
        />

        {error ? <div className="rounded border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div> : null}

        <div className="flex flex-wrap gap-4">
          {roles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Role</span>
              {roles.map((r) => (
                <button key={r} type="button" className={chip(roleFilter.has(r))} onClick={() => toggle(roleFilter, r, setRoleFilter)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {locations.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Location</span>
              {locations.map((l) => (
                <button key={l} type="button" className={chip(locFilter.has(l))} onClick={() => toggle(locFilter, l, setLocFilter)}>
                  {l}
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={graphWrapRef} className="relative rounded-lg border border-brand-700 bg-brand-950/40">
          {isLoading ? (
            <div className="flex h-[680px] items-center justify-center text-sm text-slate-400">Loading topology…</div>
          ) : (
            <>
              <CytoscapeComponent
                key={`${[...roleFilter].join(",")}|${[...locFilter].join(",")}`}
                elements={elements}
                cy={registerCy}
                layout={{ name: "cose", animate: false, nodeRepulsion: 8000, idealEdgeLength: 120 } as any}
                style={{ width: "100%", height: isFullscreen ? "100vh" : "680px" }}
                stylesheet={[
                  {
                    selector: "node",
                    style: {
                      "background-color": "data(color)",
                      label: "data(label)",
                      color: "#e2e8f0",
                      "font-size": 9,
                      "text-valign": "bottom",
                      "text-margin-y": 3,
                      width: 22,
                      height: 22
                    }
                  },
                  { selector: 'node[kind = "external"]', style: { shape: "diamond", opacity: 0.8 } },
                  {
                    selector: "edge",
                    style: {
                      width: "data(width)",
                      "line-color": "#475569",
                      "curve-style": "haystack",
                      opacity: 0.7
                    }
                  }
                ]}
              />
              <div className="pointer-events-none absolute left-3 top-3 rounded bg-brand-900/80 px-2 py-1 text-[11px] text-slate-400">
                {topo?.total_nodes ?? 0} nodes · {shownLinks.length} links shown
              </div>
            </>
          )}

          {linkInfo && (
            <div className="absolute bottom-4 right-4 z-50 w-[24rem] max-w-[90vw] max-h-[70vh] overflow-auto rounded-lg border border-brand-700 bg-brand-900/95 p-4 shadow-xl shadow-black/40">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Link detail</h3>
                <button type="button" onClick={() => setLinkInfo(null)} className="text-slate-400 hover:text-white">
                  ✕
                </button>
              </div>
              <p className="text-sm text-slate-200">
                <span className="font-semibold text-primary-300">{linkInfo.a.name}</span>
                {"  ↔  "}
                <span className="font-semibold text-primary-300">{linkInfo.b.name}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {linkInfo.link.discovered_by.map((p) => (
                  <span key={p} className="rounded border border-primary-500/50 bg-primary-500/15 px-1.5 py-0.5 text-[10px] uppercase text-primary-100">
                    {p}
                  </span>
                ))}
                <span className="rounded border border-brand-700 px-1.5 py-0.5 text-[10px] text-slate-300">{linkInfo.link.count} adjacencies</span>
              </div>
              {linkInfo.link.interfaces.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Interfaces</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {linkInfo.link.interfaces.map((i) => (
                      <span key={i} className="rounded bg-brand-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-200">
                        {i}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
