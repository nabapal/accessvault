import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core } from "cytoscape";

import { AppShell } from "@/components/layout/AppShell";
import { fetchIpMplsTopology } from "@/services/ipmpls";
import { locationFromName } from "@/utils/location";
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

// Structured layout: location columns (Mumbai left, Bangalore right, others far
// right) × role layers stacked top→bottom (SAR, AG3, AG2, AG1, then other/external).
const REGION: Record<string, { cx: number; width: number }> = {
  mumbai: { cx: 320, width: 500 },
  bangalore: { cx: 900, width: 500 },
  other: { cx: 1420, width: 400 }
};
const REGION_ORDER = ["mumbai", "bangalore", "other"];
const LAYER_ORDER = ["SAR", "AG3", "AG2", "AG1", "OTHER", "EXTERNAL"];

const groupOf = (name: string): string => {
  const loc = locationFromName(name);
  if (loc === "Mumbai") return "mumbai";
  if (loc === "Bangalore") return "bangalore";
  return "other";
};

const layerOf = (kind: string, role?: string | null): string => {
  if (kind === "external") return "EXTERNAL";
  const r = (role || "").toUpperCase();
  return ["SAR", "AG3", "AG2", "AG1"].includes(r) ? r : "OTHER";
};

interface XY {
  x: number;
  y: number;
}

function computePositions(nodes: { id: string; name: string; kind: string; role?: string | null }[]): Record<string, XY> {
  const colW = 130;
  const rowH = 60;
  const topY = 60;
  const layerPad = 46;
  const buckets: Record<string, Record<string, typeof nodes>> = {};
  nodes.forEach((n) => {
    const g = groupOf(n.name);
    const l = layerOf(n.kind, n.role);
    (buckets[g] ??= {});
    (buckets[g][l] ??= []).push(n);
  });
  const pos: Record<string, XY> = {};
  for (const group of REGION_ORDER) {
    const region = REGION[group];
    let y = topY;
    for (const layer of LAYER_ORDER) {
      const cell = buckets[group]?.[layer] ?? [];
      if (!cell.length) continue;
      const cols = Math.max(1, Math.min(cell.length, Math.floor(region.width / colW)));
      const rows = Math.ceil(cell.length / cols);
      cell.forEach((node, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        pos[node.id] = { x: region.cx + (col - (cols - 1) / 2) * colW, y: y + row * rowH };
      });
      y += rows * rowH + layerPad;
    }
  }
  return pos;
}

export function IpMplsTopologyPage() {
  const navigate = useNavigate();
  const [topo, setTopo] = useState<IpMplsTopology | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ name: string; detail: string } | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set());

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

  const rolesPresent = useMemo(() => {
    const set = new Set<string>();
    topo?.nodes.forEach((n) => set.add(roleKey(n.kind, n.role)));
    return Array.from(set).sort();
  }, [topo]);

  const locationsPresent = useMemo(() => {
    const set = new Set<string>();
    topo?.nodes.forEach((n) => set.add(locationFromName(n.name)));
    return Array.from(set).sort();
  }, [topo]);

  // Default to showing all roles + locations once the topology loads.
  useEffect(() => {
    setSelectedRoles(new Set(rolesPresent));
  }, [rolesPresent]);
  useEffect(() => {
    setSelectedLocations(new Set(locationsPresent));
  }, [locationsPresent]);

  const { elements, shownCount, positions } = useMemo(() => {
    if (!topo) return { elements: [], shownCount: 0, positions: {} as Record<string, XY> };
    const shownNodes = topo.nodes.filter(
      (n) => selectedRoles.has(roleKey(n.kind, n.role)) && selectedLocations.has(locationFromName(n.name))
    );
    const shownIds = new Set(shownNodes.map((n) => n.id));
    const nodes = shownNodes.map((n) => ({
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
    const edges = topo.links
      .filter((l) => shownIds.has(l.source) && shownIds.has(l.target))
      .map((l) => ({
        data: { id: `${l.source}__${l.target}`, source: l.source, target: l.target, label: l.interfaces.join(", ") }
      }));
    return { elements: [...nodes, ...edges], shownCount: shownIds.size, positions: computePositions(shownNodes) };
  }, [topo, selectedRoles, selectedLocations]);

  const layout = useMemo(
    () => ({ name: "preset", positions, fit: true, padding: 40 }),
    [positions]
  );

  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    topo?.nodes.forEach((n) => {
      const key = roleKey(n.kind, n.role);
      c[key] = (c[key] ?? 0) + 1;
    });
    return c;
  }, [topo]);

  const toggleRole = (role: string) =>
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });

  const allSelected = rolesPresent.length > 0 && rolesPresent.every((r) => selectedRoles.has(r));

  const locationCounts = useMemo(() => {
    const c: Record<string, number> = {};
    topo?.nodes.forEach((n) => {
      const loc = locationFromName(n.name);
      c[loc] = (c[loc] ?? 0) + 1;
    });
    return c;
  }, [topo]);

  const toggleLocation = (loc: string) =>
    setSelectedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc);
      else next.add(loc);
      return next;
    });

  const allLocationsSelected = locationsPresent.length > 0 && locationsPresent.every((l) => selectedLocations.has(l));

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
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Show roles:</span>
              <button
                type="button"
                onClick={() => setSelectedRoles(new Set(allSelected ? [] : rolesPresent))}
                className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                  allSelected ? "border-primary-500 bg-primary-600 text-white" : "border-brand-700 bg-brand-800/60 text-slate-200 hover:border-primary-500"
                }`}
              >
                {allSelected ? "All" : "Select all"}
              </button>
              {rolesPresent.map((r) => {
                const on = selectedRoles.has(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRole(r)}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition ${
                      on ? "border-primary-500 bg-brand-800/80 text-white" : "border-brand-700 bg-brand-900/40 text-slate-500 hover:border-primary-500/50"
                    }`}
                  >
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ROLE_COLORS[r] ?? "#38bdf8", opacity: on ? 1 : 0.4 }} />
                    {r} ({roleCounts[r] ?? 0})
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Show locations:</span>
              <button
                type="button"
                onClick={() => setSelectedLocations(new Set(allLocationsSelected ? [] : locationsPresent))}
                className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                  allLocationsSelected ? "border-primary-500 bg-primary-600 text-white" : "border-brand-700 bg-brand-800/60 text-slate-200 hover:border-primary-500"
                }`}
              >
                {allLocationsSelected ? "All" : "Select all"}
              </button>
              {locationsPresent.map((loc) => {
                const on = selectedLocations.has(loc);
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => toggleLocation(loc)}
                    className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                      on ? "border-primary-500 bg-brand-800/80 text-white" : "border-brand-700 bg-brand-900/40 text-slate-500 hover:border-primary-500/50"
                    }`}
                  >
                    {loc} ({locationCounts[loc] ?? 0})
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              Showing {shownCount} of {topo?.total_nodes ?? 0} nodes • scroll to zoom, drag to pan/move • hover to highlight • click a device to open it
            </p>
          </div>
        ) : null}

        <section className="rounded-lg border border-brand-700 bg-brand-900/60 p-2">
          {isLoading ? (
            <div className="p-10 text-center text-sm text-slate-400">Loading topology…</div>
          ) : topo && topo.nodes.length ? (
            <CytoscapeComponent
              key={`${Array.from(selectedRoles).sort().join(",")}|${Array.from(selectedLocations).sort().join(",")}`}
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
