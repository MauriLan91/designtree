// Library filters (US-18.7): narrow the device list by what a device is
// (class), who makes it (vendor) and the bus it hangs from, without knowing
// a name; they combine with the search. "Fits here" is one of them: it
// keeps what the scope's bus takes, the devices made only for that bus
// first, instead of a section of everything a permissive parent allows.
import type { LibraryEntry } from "./model";
import { vendorOf } from "./libraryView";

export interface Filters {
  /** A device class id (`sensor`). */
  cls?: string;
  /** A vendor prefix (`ti`); "" for generic devices. */
  vendor?: string;
  /** A bus class (`i2c`, `spi`, `mmio`). */
  bus?: string;
  /** Keep what fits the scope on show. */
  fits: boolean;
}

export const NO_FILTERS: Filters = { fits: false };

const KEY = "designtree.libraryFilters";

/** Filters from untrusted storage; anything unexpected is dropped. */
export function parseFilters(raw: unknown): Filters {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  return { cls: text(o.cls) || undefined, vendor: text(o.vendor), bus: text(o.bus) || undefined, fits: o.fits === true };
}

export function loadFilters(): Filters {
  try {
    return parseFilters(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return NO_FILTERS;
  }
}

export function saveFilters(filters: Filters) {
  try {
    localStorage.setItem(KEY, JSON.stringify(filters));
  } catch {
    // Storage can be blocked; the filters then last for this session.
  }
}

export const activeCount = (f: Filters) => [f.cls, f.vendor, f.bus].filter((v) => v !== undefined).length + (f.fits ? 1 : 0);

/**
 * The entries the filters keep, in their order; with "Fits here" and the
 * scope's bus class `fitCls`, only those whose examples put them under
 * that bus, the ones made for fewer buses first.
 */
export function applyFilters(entries: LibraryEntry[], f: Filters, fitCls?: string | null): LibraryEntry[] {
  const kept = entries.filter(
    (e) =>
      (f.cls === undefined || (e.class || "other") === f.cls) &&
      (f.vendor === undefined || vendorOf(e) === f.vendor) &&
      (f.bus === undefined || (e.buses ?? []).includes(f.bus)),
  );
  if (!f.fits || !fitCls) return kept;
  const fitting = kept.filter((e) => e.buses?.includes(fitCls));
  // A stable sort keeps the search's order among equals.
  return fitting.map((e, i) => [e, i] as const).sort((a, b) => a[0].buses!.length - b[0].buses!.length || a[1] - b[1]).map(([e]) => e);
}

const BUS_TITLES: Record<string, string> = {
  i2c: "I²C",
  i3c: "I3C",
  spi: "SPI",
  mmio: "MMIO",
  cpus: "CPUs",
  usb: "USB",
  pci: "PCI",
  mdio: "MDIO",
  spmi: "SPMI",
  w1: "1-Wire",
  serial: "Serial",
};

export const busTitle = (bus: string) => BUS_TITLES[bus] ?? bus.toUpperCase();

/** The values a filter can take among `entries`, with how many have each,
 * most common first. */
export function facet(entries: LibraryEntry[], valuesOf: (e: LibraryEntry) => string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const v of new Set(valuesOf(e))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
