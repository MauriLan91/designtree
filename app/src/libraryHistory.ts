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
