// The user's settings (US-15.5), kept as one JSON object in the app's config
// directory (local storage outside the app). What is read back is untrusted:
// a hand edit or an older version may have written anything, so every field
// is checked and falls back to its default.
import { backend, inTauri } from "./backend";
import { RESERVED_SHORTCUTS } from "./commands";
import type { EditorMode } from "./layout";

export type Theme = "system" | "light" | "dark";

export interface Settings {
  theme: Theme;
  /** The mode new tabs start in; switching a tab's mode updates it. */
  editorMode: EditorMode;
  /** The dtc to build with; null for dtc from PATH. */
  dtcPath: string | null;
  /** Check for a new release once a day. */
  updates: boolean;
  /** Shortcut overrides by command id; "" removes a command's shortcut. */
  shortcuts: Record<string, string>;
  /** Nodes snap to the canvas grid while dragged (US-9.6). */
  snapToGrid: boolean;
  /** Grid spacing in canvas pixels. */
  gridSize: number;
}

export const GRID_SIZES = [10, 15, 20, 25, 30, 40, 50] as const;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  editorMode: "split",
  dtcPath: null,
  updates: true,
  shortcuts: {},
  snapToGrid: false,
  gridSize: 20,
};

const STORAGE_KEY = "designtree.settings";

/** A shortcut as commands declare it: Ctrl or Ctrl+Shift with one key, or a function key. */
export const isCombo = (s: string) => /^(Ctrl\+(Shift\+)?[A-Z0-9,.;'/\\[\]=`-]|F([1-9]|1[0-2]))$/.test(s);

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export function parseSettings(raw: unknown): Settings {
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const shortcuts: Record<string, string> = {};
  if (typeof obj.shortcuts === "object" && obj.shortcuts !== null) {
    for (const [id, combo] of Object.entries(obj.shortcuts)) {
      const valid = typeof combo === "string" && (combo === "" || (isCombo(combo) && !RESERVED_SHORTCUTS.has(combo)));
      if (/^[a-z0-9-]{1,64}$/.test(id) && valid) {
        shortcuts[id] = combo;
      }
    }
  }
  return {
    theme: oneOf(obj.theme, ["system", "light", "dark"], DEFAULT_SETTINGS.theme),
    editorMode: oneOf(obj.editorMode, ["graph", "split", "dts"], DEFAULT_SETTINGS.editorMode),
    // Only an absolute path; the backend checks it names a file before using it.
    dtcPath: typeof obj.dtcPath === "string" && obj.dtcPath.startsWith("/") ? obj.dtcPath : null,
    updates: typeof obj.updates === "boolean" ? obj.updates : DEFAULT_SETTINGS.updates,
    shortcuts,
    snapToGrid: typeof obj.snapToGrid === "boolean" ? obj.snapToGrid : DEFAULT_SETTINGS.snapToGrid,
    gridSize: GRID_SIZES.includes(obj.gridSize as (typeof GRID_SIZES)[number]) ? (obj.gridSize as number) : DEFAULT_SETTINGS.gridSize,
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = inTauri ? await backend.readSettings() : JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parseSettings(raw ?? legacySettings());
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** What earlier versions kept in local storage, for a first start with
 * settings: the update opt-out and the last editor mode. */
function legacySettings(): Partial<Settings> {
  try {
    const legacy: Partial<Settings> = {};
    if (localStorage.getItem("designtree.updates.off") === "true") legacy.updates = false;
    const mode = localStorage.getItem("designtree.editorMode");
    if (mode) legacy.editorMode = mode as EditorMode;
    return legacy;
  } catch {
    return {};
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (inTauri) return backend.writeSettings(settings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Without storage the settings last for this session.
  }
}
