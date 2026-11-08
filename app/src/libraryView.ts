// The library grouped into sections (US-18.2): favorites, recents and one
// collapsible section per category, drawn as a list or a grid. Thousands of
// entries make a long list, so the sections are flattened into rows of
// known height that the side bar draws only where they are in view.
import type { LibraryEntry } from "./model";

export type Display = "list" | "grid";

export interface Section {
  /** `favorites`, `recents`, `matches` or `category:<name>`. */
  id: string;
  title: string;
  /** The binding category whose icon the header shows. */
  category?: string;
  entries: LibraryEntry[];
}

export type Row =
  | { type: "header"; section: Section; open: boolean }
  | { type: "entries"; section: Section; entries: LibraryEntry[] };

export const HEADER_HEIGHT = 32;
export const LIST_ROW_HEIGHT = 54;
export const GRID_ROW_HEIGHT = 96;
/** Narrowest grid tile, gap included. */
export const TILE_WIDTH = 100;

/** Favorites and recents start open; a category opens when asked to, as a
 * library of a hundred categories is read by its headers first. */
export const openByDefault = (id: string) => !id.startsWith("category:");

/** A category name as a header: `interrupt-controller` → `Interrupt controller`. */
export function categoryTitle(category: string): string {
  const words = category.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The sections of the whole library, before a query is typed. */
export function browseSections(entries: LibraryEntry[], favorites: LibraryEntry[], recents: LibraryEntry[]): Section[] {
  const byCategory = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    const list = byCategory.get(e.category);
    if (list) list.push(e);
    else byCategory.set(e.category, [e]);
  }
  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
  return [
    ...(favorites.length ? [{ id: "favorites", title: "Favorites", entries: favorites }] : []),
    ...(recents.length ? [{ id: "recents", title: "Recent", entries: recents }] : []),
    ...categories.map((c) => ({ id: `category:${c}`, title: categoryTitle(c), category: c, entries: byCategory.get(c)! })),
  ];
}

/** The rows to draw: a header per section and, for an open one, its
 * entries one per row or `columns` per row. */
export function layoutRows(sections: Section[], isOpen: (id: string) => boolean, display: Display, columns: number): Row[] {
  const per = display === "grid" ? Math.max(1, columns) : 1;
  const rows: Row[] = [];
  for (const section of sections) {
    const open = isOpen(section.id);
    rows.push({ type: "header", section, open });
    if (!open) continue;
    for (let i = 0; i < section.entries.length; i += per) {
      rows.push({ type: "entries", section, entries: section.entries.slice(i, i + per) });
    }
  }
  return rows;
}

export function rowHeight(row: Row, display: Display): number {
  if (row.type === "header") return HEADER_HEIGHT;
  return display === "grid" ? GRID_ROW_HEIGHT : LIST_ROW_HEIGHT;
}

/** The top of every row, and the total height as the last element. */
export function rowOffsets(rows: Row[], display: Display): number[] {
  const tops = new Array<number>(rows.length + 1);
  tops[0] = 0;
  rows.forEach((r, i) => (tops[i + 1] = tops[i] + rowHeight(r, display)));
  return tops;
}

/** The rows that overlap [top, top + height), as [first, end). */
export function visibleRange(offsets: number[], top: number, height: number): [number, number] {
  const count = offsets.length - 1;
  // The last row starting at or above `top`.
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= top) lo = mid;
    else hi = mid - 1;
  }
  let end = lo;
  while (end < count && offsets[end] < top + height) end++;
  return [Math.min(lo, count), end];
}
