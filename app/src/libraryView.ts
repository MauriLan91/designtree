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
  /** Drawn without a header row: the one list of search matches. */
  headless?: boolean;
  /** Sub-sections drawn under the header instead of `entries` (a big
   * class by vendor, US-18.6); `entries` still holds them all. */
  children?: Section[];
  /** 1 for a sub-section, indented under its parent's header. */
  depth?: number;
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
export const openByDefault = (id: string) => !id.startsWith("category:") && !id.startsWith("class:");

/** A category name as a header: `interrupt-controller` → `Interrupt controller`. */
export function categoryTitle(category: string): string {
  const words = category.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The sections of the whole library, before a query is typed. */
export function browseSections(entries: LibraryEntry[], favorites: LibraryEntry[], recents: LibraryEntry[]): Section[] {
  return [...historySections(favorites, recents), ...categorySections(entries)];
}

export function historySections(favorites: LibraryEntry[], recents: LibraryEntry[]): Section[] {
  return [
    ...(favorites.length ? [{ id: "favorites", title: "Favorites", entries: favorites }] : []),
    ...(recents.length ? [{ id: "recents", title: "Recent", entries: recents }] : []),
  ];
}

/** One section per category, in name order. */
export function categorySections(entries: LibraryEntry[]): Section[] {
  const byCategory = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    const list = byCategory.get(e.category);
    if (list) list.push(e);
    else byCategory.set(e.category, [e]);
  }
  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
  return categories.map((c) => ({ id: `category:${c}`, title: categoryTitle(c), category: c, entries: byCategory.get(c)! }));
}

/** The rows to draw: a header per section and, for an open one, its
 * sub-sections or its entries one per row or `columns` per row. */
export function layoutRows(sections: Section[], isOpen: (id: string) => boolean, display: Display, columns: number): Row[] {
  const per = display === "grid" ? Math.max(1, columns) : 1;
  const rows: Row[] = [];
  const add = (section: Section) => {
    const open = section.headless || isOpen(section.id);
    if (!section.headless) rows.push({ type: "header", section, open });
    if (!open) return;
    if (section.children) return section.children.forEach(add);
    for (let i = 0; i < section.entries.length; i += per) {
      rows.push({ type: "entries", section, entries: section.entries.slice(i, i + per) });
    }
  };
  sections.forEach(add);
  return rows;
}

// ---------------------------------------------------------------------------
// Device classes (US-18.6)

/** The classes of `designtree_bindings::classes::CLASSES`, in its order. */
export const CLASSES: [string, string][] = [
  ["cpu", "CPU"],
  ["memory", "Memory"],
  ["clock-reset", "Clock and reset"],
  ["power", "Power"],
  ["interrupt-dma", "Interrupts and DMA"],
  ["bus", "Bus"],
  ["serial", "Serial and messaging"],
  ["gpio", "GPIO, pins and LEDs"],
  ["storage", "Storage"],
  ["network", "Network"],
  ["display", "Display and video"],
  ["audio", "Audio"],
  ["sensor", "Sensor"],
  ["input", "Input"],
  ["security", "Security"],
  ["platform", "SoC and platform"],
  ["other", "Other"],
];

/** A binding category whose icon stands for each class in its header. */
const CLASS_ICONS: Record<string, string> = {
  cpu: "cpu",
  memory: "memory-controllers",
  "clock-reset": "clock",
  power: "power",
  "interrupt-dma": "interrupt-controller",
  bus: "bus",
  serial: "serial",
  gpio: "gpio",
  storage: "mtd",
};

/** Above this many entries a class is split by vendor. */
export const VENDOR_SPLIT = 200;

/** The vendor prefix of an entry's compatible (`st` of `st,stm32-uart`);
 * "" for a generic one (`ns16550a`, `simple-bus`). */
export const vendorOf = (e: LibraryEntry) => {
  const c = e.compatible ?? "";
  const comma = c.indexOf(",");
  return comma > 0 ? c.slice(0, comma) : "";
};

/**
 * The device list grouped by class, in the classes' order. Board and SoC
 * schemas are left out: their compatibles go on the root node. A class of
 * more than `VENDOR_SPLIT` entries opens onto one sub-section per vendor,
 * the generic entries first.
 */
export function classSections(entries: LibraryEntry[], vendorName: (prefix: string) => string = (v) => v): Section[] {
  const byClass = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    if (e.root) continue;
    const c = e.class || "other";
    const list = byClass.get(c);
    if (list) list.push(e);
    else byClass.set(c, [e]);
  }
  const known = new Set(CLASSES.map(([id]) => id));
  const order = [...CLASSES, ...[...byClass.keys()].filter((c) => !known.has(c)).map((c): [string, string] => [c, categoryTitle(c)])];
  return order
    .filter(([id]) => byClass.has(id))
    .map(([id, title]) => {
      const list = byClass.get(id)!;
      const section: Section = { id: `class:${id}`, title, category: CLASS_ICONS[id] ?? id, entries: list };
      if (list.length > VENDOR_SPLIT) section.children = vendorSections(section, vendorName);
      return section;
    });
}

function vendorSections(parent: Section, vendorName: (prefix: string) => string): Section[] {
  const byVendor = new Map<string, LibraryEntry[]>();
  for (const e of parent.entries) {
    const v = vendorOf(e);
    const list = byVendor.get(v);
    if (list) list.push(e);
    else byVendor.set(v, [e]);
  }
  const title = (v: string) => (v ? vendorName(v) : "Generic");
  return [...byVendor.keys()]
    .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : title(a).localeCompare(title(b))))
    .map((v) => ({ id: `${parent.id}/vendor:${v}`, title: title(v), category: parent.category, entries: byVendor.get(v)!, depth: 1 }));
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
