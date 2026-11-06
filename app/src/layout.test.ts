import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, clampSize, parseLayout } from "./layout";

describe("parseLayout", () => {
  it("falls back to the defaults for nothing or junk", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("wide")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout({ library: { size: "big", open: 1 }, panel: { tab: "terminal" } })).toEqual(DEFAULT_LAYOUT);
  });

  it("keeps valid fields and clamps sizes into range", () => {
    const layout = parseLayout({
      library: { size: 9000, open: false },
      inspector: { size: 10 },
      panel: { size: 300, open: true, tab: "build" },
    });
    expect(layout.library).toEqual({ size: 480, open: false });
    expect(layout.inspector).toEqual({ size: 240, open: true });
    expect(layout.panel).toEqual({ size: 300, open: true, tab: "build" });
  });
});

describe("clampSize", () => {
  it("rounds and bounds each pane", () => {
    expect(clampSize("library", 300.6)).toBe(301);
    expect(clampSize("panel", 50)).toBe(120);
  });
});

describe("loadEditorMode", () => {
  it("starts in split mode without a saved choice", async () => {
    const { loadEditorMode } = await import("./layout");
    // No localStorage under Node: the fallback applies.
    expect(loadEditorMode()).toBe("split");
  });
});
