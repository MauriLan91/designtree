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

export interface Layout {
  library: Pane;
  inspector: Pane;
  panel: Pane & { tab: PanelTab };
}

export type PaneName = keyof Layout;

/** The size range of each pane. The bottom panel's upper bound is also
 * capped at 60% of the window when it is drawn. */
export const LIMITS: Record<PaneName, { min: number; max: number }> = {
  library: { min: 200, max: 480 },
  inspector: { min: 240, max: 560 },
  panel: { min: 120, max: 800 },
};

export const DEFAULT_LAYOUT: Layout = {
  library: { size: 248, open: true },
  inspector: { size: 320, open: true },
  panel: { size: 200, open: false, tab: "problems" },
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
  return {
    library: pane("library"),
    inspector: pane("inspector"),
    panel: { ...pane("panel"), tab: TABS.includes(tab as PanelTab) ? (tab as PanelTab) : DEFAULT_LAYOUT.panel.tab },
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
const MODES: EditorMode[] = ["graph", "split", "dts"];
const MODE_KEY = "designtree.editorMode";

/** The mode last chosen, which new tabs start in. */
export function loadEditorMode(): EditorMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return MODES.includes(raw as EditorMode) ? (raw as EditorMode) : "split";
  } catch {
    return "split";
  }
}

export function saveEditorMode(mode: EditorMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // As for the layout: without storage the choice lasts for this session.
  }
}
