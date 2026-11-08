import { describe, expect, it } from "vitest";
import { COLUMN_GAP, align, distribute, layered, type Box } from "./tidy";

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
