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
