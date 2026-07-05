import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core } from "cytoscape";

import { AppShell } from "@/components/layout/AppShell";
import { fetchIpMplsTopology } from "@/services/ipmpls";
import { IpMplsTopology } from "@/types";

const ROLE_COLORS: Record<string, string> = {
  SAR: "#22d3ee",
  AG1: "#f59e0b",
  AG2: "#34d399",
  AG3: "#c084fc",
  CRR: "#f472b6",
  external: "#64748b"
};

const roleKey = (kind: string, role?: string | null) =>
  kind === "external" ? "external" : (role || "OTHER").toUpperCase();

const cyStylesheet = [
  {
    selector: "node",
    style: {
      "background-color": "#38bdf8",
      label: "data(label)",
      color: "#cbd5e1",
      "font-size": 8,
      "text-valign": "center",
      "text-halign": "right",
      "text-margin-x": 3,
      width: 16,
      height: 16,
      "border-width": 1.5,
      "border-color": "#0b1325"
    }
  },
  { selector: "node[kind = 'external']", style: { width: 10, height: 10, "background-color": ROLE_COLORS.external, "font-size": 7 } },
  ...Object.entries(ROLE_COLORS).map(([role, color]) => ({
    selector: `node[roleKey = '${role}']`,
    style: { "background-color": color }
  })),
  {
    selector: "edge",
    style: {
      width: 1.2,
      "line-color": "#334155",
      "curve-style": "bezier",
      opacity: 0.5
    }
  },
  { selector: "node.dim", style: { opacity: 0.2 } },
  { selector: "edge.dim", style: { opacity: 0.08 } },
  { selector: "node.hl", style: { "border-color": "#22d3ee", "border-width": 3 } },
  { selector: "edge.hl", style: { "line-color": "#22d3ee", width: 2.4, opacity: 1 } }
];

const layout = {
  name: "cose",
  animate: false,
  idealEdgeLength: 90,
  nodeRepulsion: 9000,
  nodeOverlap: 20,
  gravity: 0.3,
  padding: 24,
  randomize: true
};

export function IpMplsTopologyPage() {
  const navigate = useNavigate();
  const [topo, setTopo] = useState<IpMplsTopology | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ name: string; detail: string } | null>(null);

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

  const elements = useMemo(() => {
    if (!topo) return [];
    const nodes = topo.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.name,
        kind: n.kind,
        roleKey: roleKey(n.kind, n.role),
        role: n.role ?? "",
        site: n.site ?? "",
        deviceId: n.device_id ?? ""
      }
    }));
    const edges = topo.links.map((l) => ({
      data: {
        id: `${l.source}__${l.target}`,
        source: l.source,
        target: l.target,
        label: l.interfaces.join(", ")
      }
    }));
    return [...nodes, ...edges];
  }, [topo]);

  const rolesPresent = useMemo(() => {
    const set = new Set<string>();
    topo?.nodes.forEach((n) => set.add(roleKey(n.kind, n.role)));
    return Array.from(set);
  }, [topo]);

  const registerCy = (cy: Core) => {
    cy.on("tap", "node", (evt) => {
      const d = evt.target.data();
      if (d.deviceId) navigate(`/ipmpls/devices/${d.deviceId}`);
    });
    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      const neighborhood = node.closedNeighborhood();
      cy.elements().addClass("dim");
      neighborhood.removeClass("dim").addClass("hl");
      const d = node.data();
      setSelected({
        name: d.label,
        detail:
          d.kind === "device"
            ? `${d.role || "--"} · ${d.site || "--"} · ${node.degree(false)} adjacencies`
            : `external neighbor · ${node.degree(false)} adjacencies`
      });
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("dim hl");
      setSelected(null);
    });
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">IP-MPLS Topology</h1>
            <p className="mt-1 text-sm text-slate-300">
              Link-state adjacency graph (Cytoscape) built from collected ISIS neighbors across all devices.
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
            <span className="text-slate-500">• scroll to zoom, drag to pan/move • hover to highlight • click a device to open it</span>
          </div>
        ) : null}

        <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-2">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-slate-400">Loading topology…</div>
          ) : topo && topo.nodes.length ? (
            <CytoscapeComponent
              elements={elements}
              stylesheet={cyStylesheet}
              layout={layout}
              cy={registerCy}
              style={{ width: "100%", height: "680px" }}
              wheelSensitivity={0.2}
            />
          ) : (
            <div className="p-10 text-center text-sm text-slate-400">
              No topology yet. Register IP-MPLS devices and let them poll (ISIS adjacencies build the graph).
            </div>
          )}
        </section>

        {selected ? (
          <div className="rounded-lg border border-brand-700 bg-brand-900/60 p-3 text-sm text-slate-300">
            <span className="font-semibold text-white">{selected.name}</span> · {selected.detail}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
