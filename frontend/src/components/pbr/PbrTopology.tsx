import { useId } from "react";

import { PbrNode, PbrServiceDetail } from "@/types";

// Palette matched to the prototype (NetverseAI_PBR_Flow_Console_19.html).
const TEAL = "#4fd1c5";
const AMBER = "#fbbf24";
const GREEN = "#34d399";
const RED = "#f87171";
const GRAY = "#4a5a78";
const INK = "#dbe4f3";
const DIM = "#7e8ba3";

const BOX_W = 240;
const BOX_H = 126;
const CLOUD_W = 210;
const CLOUD_H = 96;
const GAP = 72;
const PAD = 24;

function nodeStatus(n: PbrNode): "live" | "faulty" | "bypassed" | "unknown" {
  if (n.bypassed) return "bypassed";
  if (n.live_status === "faulty") return "faulty";
  if (n.live_status === "live") return "live";
  return "unknown";
}
function combine(a: string, b: string): "live" | "faulty" | "bypassed" | "unknown" {
  if (a === "faulty" || b === "faulty") return "faulty";
  if (a === "bypassed" || b === "bypassed") return "bypassed";
  if (a === "live" && b === "live") return "live";
  return "unknown";
}
const arrowColor = (s: string) => (s === "faulty" ? RED : s === "bypassed" ? AMBER : s === "live" ? GREEN : GRAY);
const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/**
 * Node-by-node PBR topology (Consumer EPG → node(s) → Provider EPG), ported from the
 * prototype. Every <defs> marker id is namespaced with a per-instance useId() so
 * multiple diagrams rendered at once never collide on url(#…) refs (SDD §11).
 */
export function PbrTopology({ service }: { service: PbrServiceDetail }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const marker = (s: string) => `${uid}-${s}`;
  const nodes = service.nodes ?? [];
  if (!nodes.length) return null;

  const anyBypassed = nodes.some((n) => n.bypassed);
  const cy = anyBypassed ? 150 : 100;

  const consEpg = service.consumer_epgs?.[0];
  const provEpg = service.provider_epgs?.[0];

  const parts: JSX.Element[] = [];
  let x = PAD;

  // consumer cloud
  parts.push(cloud(`c-${uid}`, x, cy, consEpg?.epg ?? service.consumer_epg_name ?? "Consumer EPG", consEpg?.l3out ?? "", TEAL, uid));
  x += CLOUD_W;

  // arrow into first node (consumer VLAN of node 0)
  const firstLabel = encap(nodes[0]?.detail?.consumer_lif_encap);
  parts.push(arrow(`a0-${uid}`, x, cy, GAP, nodeStatus(nodes[0]), firstLabel, marker));
  x += GAP;

  nodes.forEach((n, i) => {
    const startX = x;
    parts.push(nodeBox(`n${i}-${uid}`, x, cy - BOX_H / 2, n, uid));
    x += BOX_W;
    const endX = x;

    if (n.bypassed) {
      const topY = cy - BOX_H / 2 - 8;
      const arcY = topY - 34;
      parts.push(
        <g key={`arc${i}-${uid}`}>
          <path
            d={`M${startX},${topY} Q${(startX + endX) / 2},${arcY} ${endX},${topY}`}
            fill="none"
            stroke={AMBER}
            strokeWidth={2}
            strokeDasharray="6,4"
            markerEnd={`url(#${marker("bypass")})`}
          />
          <rect x={(startX + endX) / 2 - 62} y={arcY - 9} width={124} height={16} rx={4} fill="#0a1119" stroke={AMBER} />
          <text x={(startX + endX) / 2} y={arcY + 3} textAnchor="middle" fontSize="9" fontWeight={700} fill={AMBER}>
            BYPASSED — skips node
          </text>
        </g>
      );
    }

    const isLast = i === nodes.length - 1;
    const status = isLast ? nodeStatus(n) : combine(nodeStatus(n), nodeStatus(nodes[i + 1]));
    let label: string | [string, string] | null;
    if (isLast) {
      label = encap(n.detail?.provider_lif_encap);
    } else {
      const out = encap(n.detail?.provider_lif_encap);
      const inn = encap(nodes[i + 1].detail?.consumer_lif_encap);
      if (out && inn && out !== inn) label = [`${out} (out)`, `${inn} (in)`];
      else label = out || inn || null;
    }
    const gap = Array.isArray(label) ? GAP + 56 : GAP;
    parts.push(arrow(`a${i + 1}-${uid}`, x, cy, gap, status, label, marker));
    x += gap;
  });

  parts.push(cloud(`p-${uid}`, x, cy, provEpg?.epg ?? service.provider_epg_name ?? "Provider EPG", provEpg?.l3out ?? "", AMBER, uid));
  x += CLOUD_W;

  const totalW = x + PAD;
  const totalH = cy + Math.max(CLOUD_H, BOX_H) / 2 + 40;

  return (
    <div className="overflow-x-auto rounded-md border border-brand-800/70 bg-brand-950/40 p-2">
      <svg viewBox={`0 0 ${totalW} ${totalH}`} width="100%" height={totalH} style={{ minWidth: Math.max(totalW, 760) }}>
        <defs>
          {(["arrow", "fault", "live", "bypass"] as const).map((s) => (
            <marker key={s} id={marker(s === "arrow" ? "arrow" : s)} markerWidth="9" markerHeight="9" refX="7" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" fill={s === "fault" ? RED : s === "live" ? GREEN : s === "bypass" ? AMBER : GRAY} />
            </marker>
          ))}
        </defs>
        {parts}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9.5px] text-slate-500">
        <span><span style={{ color: TEAL }}>●</span> Consumer EPG</span>
        <span><span style={{ color: AMBER }}>●</span> Provider EPG / L1 node</span>
        <span><span style={{ color: GREEN }}>→</span> hop confirmed live (learned/resolved)</span>
        <span><span style={{ color: RED }}>⚠</span> redirect dest — not learned / fault</span>
        <span><span style={{ color: TEAL }}>⇄</span> L1 redirect interface (transparent)</span>
        <span><span style={{ color: AMBER }}>↳</span> threshold breached — node bypassed</span>
      </div>
    </div>
  );
}

function cloud(key: string, x: number, cy: number, title: string, sub: string, color: string, uid: string) {
  return (
    <g key={key}>
      <rect x={x} y={cy - CLOUD_H / 2} width={CLOUD_W} height={CLOUD_H} rx={CLOUD_H / 2} fill="#0e1622" stroke={color} strokeWidth={1.6} />
      <text x={x + CLOUD_W / 2} y={cy - 8} textAnchor="middle" fontSize="12.5" fontWeight={700} fill={color}>
        {trunc(title, 24)}
      </text>
      <text x={x + CLOUD_W / 2} y={cy + 14} textAnchor="middle" fontFamily="monospace" fontSize="9.5" fill="#9aa7bd">
        {trunc(sub, 26)}
      </text>
    </g>
  );
}

function nodeBox(key: string, x: number, y: number, n: PbrNode, uid: string) {
  const d = n.detail;
  const layerColor = d.device_layer === "L1" ? AMBER : TEAL;
  const status = nodeStatus(n);
  const border = status === "bypassed" ? AMBER : status === "faulty" ? RED : layerColor;
  const opacity = n.bypassed ? 0.55 : 1;
  const hp = n.health_pct;
  const hcolor = n.bypassed ? AMBER : hp == null ? DIM : hp >= 90 ? GREEN : hp >= 50 ? AMBER : RED;
  const hlabel = n.bypassed ? "BYPASS" : hp == null ? "N/A" : `${Math.round(hp)}%`;

  const destLines: { text: string; color: string }[] = [];
  if (d.device_layer === "L1") {
    const inIf = d.redirect_interfaces?.consumer?.[0]?.interface;
    const outIf = d.redirect_interfaces?.provider?.[0]?.interface;
    if (inIf) destLines.push({ text: `⇄ in: ${inIf}`, color: TEAL });
    if (outIf) destLines.push({ text: `⇄ out: ${outIf}`, color: AMBER });
    if (!destLines.length) destLines.push({ text: "no interface data", color: DIM });
  } else {
    const dests = d.redirect_dests ?? [];
    const inD = dests.filter((r) => r.side === "in");
    const outD = dests.filter((r) => r.side === "out");
    // Prefer one IN + one OUT (labelled) so direction is clear; else first two.
    const picks: { r: (typeof dests)[number]; lbl: string }[] =
      inD.length || outD.length
        ? [...(inD[0] ? [{ r: inD[0], lbl: "in " }] : []), ...(outD[0] ? [{ r: outD[0], lbl: "out " }] : [])]
        : dests.slice(0, 2).map((r) => ({ r, lbl: "" }));
    if (!picks.length) destLines.push({ text: "no redirect dest", color: DIM });
    else picks.forEach(({ r, lbl }) => destLines.push({ text: `${lbl}${r.active ? "→ " : "⚠ "}${r.ip}`, color: r.active ? GREEN : RED }));
  }
  const policyLine = [d.consumer_redirect_policy && `in:${d.consumer_redirect_policy}`, d.provider_redirect_policy && `out:${d.provider_redirect_policy}`]
    .filter(Boolean)
    .join("  ");

  return (
    <g key={key} opacity={opacity}>
      <rect x={x} y={y} width={BOX_W} height={BOX_H} rx={8} fill="#131b29" stroke={border} strokeWidth={status === "faulty" || n.bypassed ? 2.2 : 1.6} strokeDasharray={status === "faulty" || n.bypassed ? "5,3" : undefined} />
      <rect x={x} y={y} width={46} height={18} rx={4} fill={layerColor} opacity={0.18} />
      <text x={x + 23} y={y + 13} textAnchor="middle" fontFamily="monospace" fontSize="9.5" fontWeight={700} fill={layerColor}>{d.node}</text>
      <text x={x + 70} y={y + 13} textAnchor="middle" fontFamily="monospace" fontSize="9" fill={DIM}>{d.device_layer}</text>
      <rect x={x + BOX_W - 52} y={y} width={52} height={18} rx={4} fill={hcolor} opacity={0.18} />
      <text x={x + BOX_W - 26} y={y + 13} textAnchor="middle" fontFamily="monospace" fontSize="9.5" fontWeight={700} fill={hcolor}>{hlabel}</text>
      <text x={x + BOX_W / 2} y={y + 40} textAnchor="middle" fontSize="12.5" fontWeight={700} fill={INK}>{trunc(d.devgrp || d.node || "", 26)}</text>
      <text x={x + BOX_W / 2} y={y + 60} textAnchor="middle" fontFamily="monospace" fontSize="9" fill={DIM}>{d.leafs?.length ? `Leaf ${d.leafs.join(",")}` : ""}</text>
      <text x={x + BOX_W / 2} y={y + 76} textAnchor="middle" fontFamily="monospace" fontSize="8.5" fill="#59688a">{trunc(policyLine, 34)}</text>
      {n.bypassed ? (
        <>
          <text x={x + BOX_W / 2} y={y + 98} textAnchor="middle" fontFamily="monospace" fontSize="8.5" fontWeight={700} fill={AMBER}>
            {`active ${d.threshold.active_pct ?? 0}% < min ${d.threshold.min}%`}
          </text>
          <text x={x + BOX_W / 2} y={y + 113} textAnchor="middle" fontFamily="monospace" fontSize="8" fill={DIM}>traffic diverted around node</text>
        </>
      ) : (
        destLines.map((l, i) => (
          <text key={i} x={x + BOX_W / 2} y={y + 98 + i * 14} textAnchor="middle" fontFamily="monospace" fontSize="9" fill={l.color}>
            {trunc(l.text, 32)}
          </text>
        ))
      )}
    </g>
  );
}

function arrow(
  key: string,
  xStart: number,
  cy: number,
  gap: number,
  status: string,
  label: string | [string, string] | null,
  marker: (s: string) => string
) {
  const color = arrowColor(status);
  const m = status === "faulty" ? "fault" : status === "bypassed" ? "bypass" : status === "live" ? "live" : "arrow";
  const x2 = xStart + gap - 6;
  const labels = label == null ? [] : Array.isArray(label) ? label : [label];
  return (
    <g key={key}>
      <line x1={xStart} y1={cy} x2={x2} y2={cy} stroke={color} strokeWidth={2} strokeDasharray={status === "bypassed" ? "4,4" : undefined} markerEnd={`url(#${marker(m)})`} />
      {labels.map((t, i) => (
        <text key={i} x={xStart + gap / 2} y={cy - 8 - (labels.length - 1 - i) * 12} textAnchor="middle" fontFamily="monospace" fontSize="9" fill={DIM}>
          {t}
        </text>
      ))}
    </g>
  );
}

function encap(v?: string | null): string | null {
  if (!v || v === "unknown") return null;
  return v;
}
