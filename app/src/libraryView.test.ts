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
