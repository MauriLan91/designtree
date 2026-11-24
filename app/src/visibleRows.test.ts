import { describe, expect, it } from "vitest";
import { visibleRange } from "./visibleRows";

describe("visibleRange", () => {
  it("draws the rows in view and a margin around them", () => {
    // 10,000 rows of 20 px in a 400 px view scrolled to row 500.
    expect(visibleRange(10_000, 400, 0, 10_000, 20)).toEqual({ start: 488, end: 532 });
    // The list starts 100 px into the scroller, under a toolbar.
    expect(visibleRange(0, 400, 100, 10_000, 20)).toEqual({ start: 0, end: 27 });
  });

  it("stays inside the list", () => {
    expect(visibleRange(0, 400, 0, 5, 20)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(1_000_000, 400, 0, 50, 20)).toEqual({ start: 50, end: 50 });
    expect(visibleRange(0, 400, 0, 0, 20)).toEqual({ start: 0, end: 0 });
  });
});
