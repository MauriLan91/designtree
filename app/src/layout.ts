// The workbench panes (US-15.3): the library and the inspector at the sides,
// the bottom panel under the canvas. Their sizes, whether they are open and
// the bottom panel's tab belong to the user, not to a design, so they live in
// local storage and are shared by every tab.

export type PanelTab = "problems" | "build" | "interrupts" | "address-map";

export interface Pane {
  /** Width of a side pane or height of the bottom panel, in px. */
  size: number;
  open: boolean;
}

/** What the side bar shows: the element library or the tree of the design (US-16.4). */
export type SideView = "library" | "outline";

export interface Layout {
  library: Pane & { view: SideView };
  inspector: Pane;
  panel: Pane & { tab: PanelTab };
  /** The graph's share of the canvas width in Split mode (US-15.8). */
  split: number;
}

export type PaneName = "library" | "inspector" | "panel";

/** The narrowest either half of the split may get, in px. */
export const SPLIT_MIN = 240;
/** The stored ratio's range; the drawn one is also kept to `SPLIT_MIN`. */
const SPLIT_RANGE = { min: 0.1, max: 0.9 };

export const clampSplit = (ratio: number) =>
  Math.round(Math.min(SPLIT_RANGE.max, Math.max(SPLIT_RANGE.min, ratio)) * 1000) / 1000;

/** The size range of each pane. The bottom panel's upper bound is also
 * capped at 60% of the window when it is drawn. */
export const LIMITS: Record<PaneName, { min: number; max: number }> = {
  library: { min: 200, max: 480 },
  inspector: { min: 240, max: 560 },
  panel: { min: 120, max: 800 },
};

export const DEFAULT_LAYOUT: Layout = {
  library: { size: 248, open: true, view: "library" },
  inspector: { size: 320, open: true },
  panel: { size: 200, open: false, tab: "problems" },
  split: 0.5,
};

const KEY = "designtree.layout";
const TABS: PanelTab[] = ["problems", "build", "interrupts", "address-map"];

export const clampSize = (pane: PaneName, size: number) =>
  Math.round(Math.min(LIMITS[pane].max, Math.max(LIMITS[pane].min, size)));

/** A layout from untrusted storage: unknown or out-of-range fields fall back
 * to the defaults, so a stale or hand-edited entry never breaks the window. */
export function parseLayout(raw: unknown): Layout {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const pane = (name: PaneName): Pane => {
    const p = typeof obj[name] === "object" && obj[name] !== null ? (obj[name] as Record<string, unknown>) : {};
    const d = DEFAULT_LAYOUT[name];
    return {
      size: typeof p.size === "number" && Number.isFinite(p.size) ? clampSize(name, p.size) : d.size,
      open: typeof p.open === "boolean" ? p.open : d.open,
    };
  };
  const tab = (obj.panel as { tab?: unknown } | undefined)?.tab;
  const view = (obj.library as { view?: unknown } | undefined)?.view;
  return {
    library: { ...pane("library"), view: view === "outline" ? "outline" : "library" },
    inspector: pane("inspector"),
    panel: { ...pane("panel"), tab: TABS.includes(tab as PanelTab) ? (tab as PanelTab) : DEFAULT_LAYOUT.panel.tab },
    split: typeof obj.split === "number" && Number.isFinite(obj.split) ? clampSplit(obj.split) : DEFAULT_LAYOUT.split,
  };
}

export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    return parseLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Storage can be blocked; the layout then lasts for this session only.
  }
}

/** How a tab shows the design: the graph, the graph beside its DTS source,
 * or the source alone (US-15.4). */
export type EditorMode = "graph" | "split" | "dts";
