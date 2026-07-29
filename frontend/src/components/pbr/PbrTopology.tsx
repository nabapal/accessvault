import { useId } from "react";

import { PbrNode, PbrNodeStatus, PbrServiceDetail } from "@/types";

// Colors per node/arrow live status (SDD §5.4 / prototype nodeLiveStatus).
const STATUS_COLOR: Record<PbrNodeStatus, string> = {
  live: "#34d399", // emerald
  faulty: "#fb7185", // rose
  bypassed: "#94a3b8", // slate (ghosted)
  permit: "#fbbf24", // amber (informational, distinct from bypass)
  unknown: "#64748b" // slate-gray
};

const BOX_W = 180;
const BOX_H = 96;
const GAP = 96; // horizontal gap between boxes (room for arrow + VLAN label)
const PAD = 24;
const ROW_Y = 40;

interface EndpointBox {
  kind: "epg";
  title: string;
  subtitle: string;
}
interface NodeBox {
  kind: "node";
  node: PbrNode;
}
type Box = EndpointBox | NodeBox;

const fmtPct = (v?: number | null) => (v === undefined || v === null ? "—" : `${Math.round(v)}%`);
const fmt = (v?: string | null) => (v ? v : "—");

function vlanLabel(left?: string | null, right?: string | null): string {
  const l = left ?? null;
  const r = right ?? null;
  if (l && r && l !== r) {
    return `vlan ${l} → ${r}`; // divergent VLAN across the hop (e.g. L1→L3) — SDD §5.4
  }
  const v = l ?? r;
  return v ? `vlan ${v}` : "";
}

/**
 * Node-by-node PBR topology: Consumer EPG → node(s) → Provider EPG.
 *
 * Every <defs> id is namespaced with a per-instance uid from React.useId() so that
 * multiple diagrams rendered simultaneously never collide on `url(#…)` marker refs —
 * the exact bug called out in SDD §11 (duplicate ids silently dropped shapes from all
 * but the first diagram).
 */
export function PbrTopology({ service }: { service: PbrServiceDetail }) {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, ""); // colons are awkward in url(#…) refs
  const markerId = (status: PbrNodeStatus) => `${uid}-arrow-${status}`;

  const nodes = service.nodes ?? [];
  const boxes: Box[] = [
    { kind: "epg", title: "Consumer EPG", subtitle: fmt(service.consumer_epg_name ?? service.consumer_epg_dn) },
    ...nodes.map<NodeBox>((node) => ({ kind: "node", node })),
    { kind: "epg", title: "Provider EPG", subtitle: fmt(service.provider_epg_name ?? service.provider_epg_dn) }
  ];

  const width = PAD * 2 + boxes.length * BOX_W + (boxes.length - 1) * GAP;
  const height = ROW_Y + BOX_H + 56;
  const statuses: PbrNodeStatus[] = ["live", "faulty", "bypassed", "permit", "unknown"];

  const boxX = (i: number) => PAD + i * (BOX_W + GAP);

  // Arrow between box i and i+1. Color/status derived from the downstream node when
  // present, else the upstream node, else unknown. VLAN label reflects both sides.
  const arrowFor = (i: number) => {
    const from = boxes[i];
    const to = boxes[i + 1];
    const downstream = to.kind === "node" ? to.node : null;
    const upstream = from.kind === "node" ? from.node : null;
    const status: PbrNodeStatus = downstream?.live_status ?? upstream?.live_status ?? "unknown";
    const left = upstream ? upstream.provider_vlan : null; // leaving the upstream node
    const right = downstream ? downstream.consumer_vlan : null; // entering the downstream node
    return { status, label: vlanLabel(left, right) };
  };

  return (
    <div className="overflow-x-auto rounded-md border border-brand-800/70 bg-brand-950/40 p-2">
      <svg width={width} height={height} role="img" aria-label="PBR topology diagram">
        <defs>
          {statuses.map((s) => (
            <marker
              key={s}
              id={markerId(s)}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={STATUS_COLOR[s]} />
            </marker>
          ))}
        </defs>

        {/* arrows */}
        {boxes.slice(0, -1).map((_, i) => {
          const { status, label } = arrowFor(i);
          const x1 = boxX(i) + BOX_W;
          const x2 = boxX(i + 1);
          const y = ROW_Y + BOX_H / 2;
          const isBypassed = status === "bypassed";
          return (
            <g key={`arrow-${i}`}>
              <line
                x1={x1}
                y1={y}
                x2={x2 - 2}
                y2={y}
                stroke={STATUS_COLOR[status]}
                strokeWidth={2}
                strokeDasharray={isBypassed ? "5 4" : undefined}
                markerEnd={`url(#${markerId(status)})`}
              />
              {label ? (
                <text
                  x={(x1 + x2) / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#94a3b8"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* boxes */}
        {boxes.map((box, i) => {
          const x = boxX(i);
          if (box.kind === "epg") {
            return (
              <g key={`box-${i}`}>
                <rect x={x} y={ROW_Y} width={BOX_W} height={BOX_H} rx={10} fill="#1e293b" stroke="#475569" />
                <text x={x + BOX_W / 2} y={ROW_Y + 26} textAnchor="middle" fontSize="11" fill="#94a3b8">
                  {box.title}
                </text>
                <text x={x + BOX_W / 2} y={ROW_Y + 50} textAnchor="middle" fontSize="12" fill="#e2e8f0">
                  {truncate(box.subtitle, 24)}
                </text>
              </g>
            );
          }
          const node = box.node;
          const color = STATUS_COLOR[node.live_status];
          const ghosted = node.live_status === "bypassed";
          return (
            <g key={`box-${i}`} opacity={ghosted ? 0.55 : 1}>
              <rect
                x={x}
                y={ROW_Y}
                width={BOX_W}
                height={BOX_H}
                rx={10}
                fill="#0f172a"
                stroke={color}
                strokeWidth={2}
                strokeDasharray={ghosted ? "6 4" : undefined}
              />
              <text x={x + 12} y={ROW_Y + 22} fontSize="12" fontWeight="600" fill="#e2e8f0">
                {truncate(node.name ?? "node", 20)}
              </text>
              <text x={x + 12} y={ROW_Y + 40} fontSize="10" fill="#94a3b8">
                {node.layer} · {truncate(node.device_group_name ?? node.device_group_dn ?? "—", 20)}
              </text>
              {/* health % badge */}
              <text x={x + BOX_W - 12} y={ROW_Y + 22} textAnchor="end" fontSize="12" fontWeight="700" fill={color}>
                {fmtPct(node.health_pct)}
              </text>
              <text x={x + 12} y={ROW_Y + 58} fontSize="10" fill={color}>
                {statusLabel(node)}
              </text>
              {node.leaf || node.path ? (
                <text x={x + 12} y={ROW_Y + 76} fontSize="9" fill="#64748b">
                  {truncate([node.leaf, node.path].filter(Boolean).join(" "), 24)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function statusLabel(node: PbrNode): string {
  switch (node.live_status) {
    case "bypassed":
      return "⤳ bypassed by design";
    case "permit":
      return "permit (threshold breached)";
    case "faulty":
      return "faulty";
    case "live":
      return "live";
    default:
      return "unknown";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
