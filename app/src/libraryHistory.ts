// Favorite and recently used bindings of the library, by schema path. They
// live in the webview's local storage: they belong to the user, not to a
// design, and a kernel that lacks a path just does not show it.

const FAVORITES_KEY = "designtree.favorites";
const RECENTS_KEY = "designtree.recents";
export const MAX_RECENTS = 8;

export function loadList(key: "favorites" | "recents"): string[] {
  try {
    const raw = localStorage.getItem(key === "favorites" ? FAVORITES_KEY : RECENTS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function saveList(key: "favorites" | "recents", list: string[]) {
  try {
    localStorage.setItem(key === "favorites" ? FAVORITES_KEY : RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Storage can be blocked; the lists then last for this session only.
  }
}

export const toggled = (list: string[], path: string) =>
  list.includes(path) ? list.filter((p) => p !== path) : [...list, path];

/** `path` moved to the front, the list cut to [`MAX_RECENTS`]. */
export const withRecent = (list: string[], path: string) =>
  [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENTS);

/** How the library is shown (US-18.2): list or grid, and which sections
 * the user opened or closed (the rest keep their default). */
export interface LibraryPrefs {
  display: "list" | "grid";
  open: Record<string, boolean>;
}

const PREFS_KEY = "designtree.library";

export function loadPrefs(): LibraryPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const open = typeof obj.open === "object" && obj.open !== null ? (obj.open as Record<string, unknown>) : {};
    return {
      display: obj.display === "grid" ? "grid" : "list",
      open: Object.fromEntries(Object.entries(open).filter((e): e is [string, boolean] => typeof e[1] === "boolean")),
    };
  } catch {
    return { display: "list", open: {} };
  }
}

export function savePrefs(prefs: LibraryPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // As for the lists: blocked storage keeps the choice for this session.
  }
}
