import { describe, expect, it } from "vitest";
import { COLUMN_GAP, GRID_GAP, LEVEL_GAP, align, distribute, grid, layered, mostReferenced, star, tree, type Box } from "./tidy";

const box = (id: string, x = 0, y = 0, width = 200, height = 80): Box => ({ id, x, y, width, height });

describe("layered layout", () => {
  // uart -> clock, uart -> gic, timer -> gic; led alone.
  const boxes = [box("uart"), box("clock"), box("gic"), box("timer"), box("led")];
  const links = [
    { id: "a", source: "uart", target: "clock" },
    { id: "b", source: "uart", target: "gic" },
    { id: "c", source: "timer", target: "gic" },
  ];
  const { positions, routes } = layered(boxes, links, { x: 100, y: 50 });

  it("puts providers right of their consumers", () => {
    const x = (id: string) => positions.get(id)!.x;
    expect(x("uart")).toBe(100);
    expect(x("timer")).toBe(100);
    expect(x("clock")).toBe(100 + 200 + COLUMN_GAP);
    expect(x("gic")).toBe(x("clock"));
  });

  it("puts boxes without references below", () => {
    const bottom = Math.max(...["uart", "clock", "gic", "timer"].map((id) => positions.get(id)!.y + 80));
    expect(positions.get("led")!.y).toBeGreaterThan(bottom);
    expect(positions.get("led")!.x).toBe(100);
  });

  it("turns each reference in the gap right of its consumer, apart", () => {
    const gap = [100 + 200, 100 + 200 + COLUMN_GAP];
    const xs = ["a", "b", "c"].map((id) => routes.get(id)!);
    for (const x of xs) expect(x > gap[0] && x < gap[1]).toBe(true);
    expect(new Set(xs).size).toBe(3);
  });

  it("survives a cycle", () => {
    const loop = layered([box("a"), box("b")], [
      { id: "1", source: "a", target: "b" },
      { id: "2", source: "b", target: "a" },
    ], { x: 0, y: 0 });
    expect(loop.positions.get("a")!.x).not.toBe(loop.positions.get("b")!.x);
  });
});

describe("align and distribute", () => {
  const boxes = [box("a", 0, 0, 100, 40), box("b", 300, 100, 50, 20), box("c", 120, 60, 80, 80)];

  it("line boxes up", () => {
    expect(align(boxes, "left").get("b")).toEqual({ x: 0, y: 100 });
    expect(align(boxes, "right").get("a")).toEqual({ x: 250, y: 0 });
    expect(align(boxes, "middle").get("c")).toEqual({ x: 120, y: 30 });
  });

  it("space boxes evenly between the outer ones", () => {
    const out = distribute(boxes, "horizontal");
    // span 0..350, sizes 230, two gaps of 60
    expect(out.get("a")).toEqual({ x: 0, y: 0 });
    expect(out.get("c")).toEqual({ x: 160, y: 60 });
    expect(out.get("b")).toEqual({ x: 300, y: 100 });
  });
});

describe("tidy edge cases", () => {
  it("leaves references that skip a column or go back as curves", () => {
    const { routes } = layered([box("a"), box("b"), box("c")], [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "ac", source: "a", target: "c" },
      { id: "ca", source: "c", target: "a" },
    ], { x: 0, y: 0 });
    expect([...routes.keys()].sort()).toEqual(["ab", "bc"]);
  });

  it("widens a busy gap so its runs stay apart", () => {
    const many = Array.from({ length: 30 }, (_, i) => box(`d${i}`));
    const { positions, routes } = layered([...many, box("gic")], many.map((d) => ({ id: d.id, source: d.id, target: "gic" })), { x: 0, y: 0 });
    const xs = [...routes.values()].sort((a, b) => a - b);
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(12);
    expect(xs[0]).toBeGreaterThan(200);
    expect(xs[xs.length - 1]).toBeLessThan(positions.get("gic")!.x);
  });

  it("never overlaps boxes when distributing", () => {
    const out = distribute([box("a", 0, 0, 500, 10), box("b", 100, 0, 50, 10), box("c", 200, 0, 50, 10)], "horizontal");
    expect(out.get("b")!.x).toBeGreaterThanOrEqual(500);
    expect(out.get("c")!.x).toBeGreaterThanOrEqual(out.get("b")!.x + 50);
  });
});

describe("grid", () => {
  it("fills square rows of equal cells in reading order", () => {
    const boxes = [box("c", 0, 100), box("a", 0, 0), box("b", 300, 0), box("d", 300, 100, 100, 40), box("e", 0, 200)];
    const p = grid(boxes, { x: 10, y: 20 });
    expect(p.get("a")).toEqual({ x: 10, y: 20 });
    expect(p.get("b")).toEqual({ x: 10 + 200 + GRID_GAP, y: 20 });
    expect(p.get("d")).toEqual({ x: 10, y: 20 + 80 + GRID_GAP });
    expect(p.get("e")).toEqual({ x: 10 + 200 + GRID_GAP, y: 20 + 80 + GRID_GAP });
  });
});

describe("tree", () => {
  // root > (cpus > cpu0, cpu1), soc; "hidden" is a parent not among the boxes.
  const parent: Record<string, string> = { cpus: "root", cpu0: "cpus", cpu1: "cpus", soc: "hidden", hidden: "root" };
  const boxes = [box("root"), box("cpus", 0), box("soc", 500), box("cpu0", 0), box("cpu1", 300)];
  const parentOf = (id: string) => parent[id];

  it("hangs children a level down, centred under their parent", () => {
    const p = tree(boxes, parentOf, { x: 0, y: 0 }, "vertical");
    expect(p.get("root")!.y).toBe(0);
    expect(p.get("cpus")!.y).toBe(80 + LEVEL_GAP);
    // soc's parent is not on show: it hangs from root, its nearest ancestor.
    expect(p.get("soc")!.y).toBe(80 + LEVEL_GAP);
    expect(p.get("cpu0")!.y).toBe(2 * (80 + LEVEL_GAP));
    const centre = (id: string) => p.get(id)!.x + 100;
    expect(centre("cpus")).toBe((centre("cpu0") + centre("cpu1")) / 2);
    expect(p.get("cpu1")!.x - p.get("cpu0")!.x).toBe(200 + GRID_GAP);
    expect(p.get("soc")!.x).toBeGreaterThan(p.get("cpu1")!.x);
  });

  it("runs left to right when horizontal", () => {
    const p = tree(boxes, parentOf, { x: 0, y: 0 }, "horizontal");
    expect(p.get("root")!.x).toBe(0);
    expect(p.get("cpus")!.x).toBe(200 + LEVEL_GAP);
    expect(p.get("cpu1")!.y - p.get("cpu0")!.y).toBe(80 + GRID_GAP);
  });

  it("survives a cycle in the parents", () => {
    const p = tree([box("a"), box("b")], (id) => (id === "a" ? "x" : id === "x" ? "a" : undefined), { x: 0, y: 0 }, "vertical");
    expect(p.size).toBe(2);
  });
});

describe("star", () => {
  const boxes = [box("gic", 400, 400), box("uart", 0, 0), box("timer", 800, 0), box("i2c", 0, 800)];
  const links = [
    { id: "1", source: "uart", target: "gic" },
    { id: "2", source: "timer", target: "gic" },
    { id: "3", source: "uart", target: "timer" },
  ];

  it("centres on the most referenced box", () => {
    expect(mostReferenced(boxes, links)).toBe("gic");
  });

  it("rings the others around the centre, which stays put, without overlaps", () => {
    const p = star(boxes, "gic");
    expect(p.get("gic")).toEqual({ x: 400, y: 400 });
    const all = boxes.map((b) => ({ ...b, ...p.get(b.id)! }));
    for (const a of all)
      for (const b of all)
        if (a.id < b.id) {
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart, `${a.id} and ${b.id}`).toBe(true);
        }
  });
});
