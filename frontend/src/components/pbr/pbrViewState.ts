import { PbrFlowLookupResult } from "@/types";

// Session-scoped snapshot of the PBR Monitoring page so navigating away (e.g. to a
// CGNAT device via a redirect-IP double-click) and coming back restores the same
// fabric, expanded service, filters, flow-lookup result, and scroll position.
const KEY = "pbr.viewState.v1";

export interface PbrFlowSnapshot {
  fabricId: string;
  source: string;
  destination: string;
  result: PbrFlowLookupResult | null;
}

export interface PbrViewState {
  selectedFabricId?: string | null;
  expandedServiceId?: string | null;
  search?: string;
  stateFilter?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  flow?: PbrFlowSnapshot | null;
  scrollTop?: number | null; // scrollTop of the <main> content area
}

export function loadPbrView(): PbrViewState {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "{}") as PbrViewState;
  } catch {
    return {};
  }
}

export function savePbrView(patch: Partial<PbrViewState>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...loadPbrView(), ...patch }));
  } catch {
    /* sessionStorage unavailable — non-fatal */
  }
}

// The page content scrolls inside <main class="overflow-y-auto">, not the window.
export function pbrScroller(): HTMLElement | null {
  return document.querySelector("main");
}
