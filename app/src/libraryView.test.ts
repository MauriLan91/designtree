import { describe, expect, it } from "vitest";
import { browseSections, categoryTitle, layoutRows, openByDefault, rowOffsets, visibleRange } from "./libraryView";
import type { LibraryEntry } from "./model";

const e = (category: string, compatible: string): LibraryEntry => ({ path: `${category}/x.yaml`, category, compatible });
const all = [e("serial", "ns16550a"), e("arm", "arm,cortex-a7"), e("serial", "ns16550"), e("arm", "arm,cortex-a9"), e("arm", "arm,cortex-a15")];

describe("library sections", () => {
  it("put favorites and recents before the categories, in name order", () => {
    const sections = browseSections(all, [all[1]], []);
    expect(sections.map((s) => s.id)).toEqual(["favorites", "category:arm", "category:serial"]);
    expect(sections[1].entries.map((x) => x.compatible)).toEqual(["arm,cortex-a7", "arm,cortex-a9", "arm,cortex-a15"]);
    expect(categoryTitle("interrupt-controller")).toBe("Interrupt controller");
    expect(openByDefault("favorites")).toBe(true);
    expect(openByDefault("category:arm")).toBe(false);
  });

  it("lay out headers and rows of entries, closed sections folded", () => {
    const sections = browseSections(all, [], []);
    const open = (id: string) => id === "category:arm";
    const list = layoutRows(sections, open, "list", 3);
    expect(list.map((r) => (r.type === "header" ? r.section.id : r.entries.length))).toEqual(["category:arm", 1, 1, 1, "category:serial"]);
    const grid = layoutRows(sections, open, "grid", 2);
    expect(grid.map((r) => (r.type === "header" ? r.section.id : r.entries.length))).toEqual(["category:arm", 2, 1, "category:serial"]);
    // Search matches are one list without a header, always open.
    const matches = layoutRows([{ id: "matches", title: "Matches", entries: all, headless: true }], () => false, "list", 1);
    expect(matches.map((r) => r.type)).toEqual(["entries", "entries", "entries", "entries", "entries"]);
  });

  it("find the rows in view", () => {
    const rows = layoutRows(browseSections(all, [], []), () => true, "list", 1);
    const tops = rowOffsets(rows, "list");
    // header 32, then rows of 54
    expect(tops.slice(0, 4)).toEqual([0, 32, 86, 140]);
    expect(visibleRange(tops, 0, 40)).toEqual([0, 2]);
    expect(visibleRange(tops, 100, 50)).toEqual([2, 4]);
    expect(visibleRange(tops, 10_000, 50)).toEqual([rows.length, rows.length]);
  });
});

describe("device classes (US-18.6)", () => {
  const entry = (cls: string, compatible?: string, root = false): LibraryEntry => ({ path: `${cls}/x.yaml`, category: cls, class: cls, compatible, root });

  it("groups by class in the classes' order, without board schemas", async () => {
    const { classSections } = await import("./libraryView");
    const sections = classSections([entry("serial", "ns16550a"), entry("cpu", "arm,cortex-a7"), entry("platform", "acme,board", true), entry("weird", "x,y")]);
    expect(sections.map((s) => [s.id, s.title, s.entries.length])).toEqual([
      ["class:cpu", "CPU", 1],
      ["class:serial", "Serial and messaging", 1],
      ["class:weird", "Weird", 1],
    ]);
  });

  it("splits a big class by vendor, generic entries first", async () => {
    const { classSections, layoutRows, VENDOR_SPLIT } = await import("./libraryView");
    const many = Array.from({ length: VENDOR_SPLIT + 1 }, (_, i) => entry("sensor", i % 3 === 0 ? `adi,ad${i}` : i % 3 === 1 ? `ti,tmp${i}` : `lm${i}`));
    const [sensors] = classSections(many, (v) => ({ adi: "Analog Devices", ti: "Texas Instruments" })[v] ?? v);
    expect(sensors.entries).toHaveLength(VENDOR_SPLIT + 1);
    expect(sensors.children!.map((s) => s.title)).toEqual(["Generic", "Analog Devices", "Texas Instruments"]);
    const rows = layoutRows([sensors], (id) => id === "class:sensor", "list", 1);
    expect(rows.map((r) => (r.type === "header" ? r.section.title : "entry"))).toEqual(["Sensor", "Generic", "Analog Devices", "Texas Instruments"]);
  });
});
