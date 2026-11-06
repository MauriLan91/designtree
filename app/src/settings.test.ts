import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isCombo, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("falls back to the defaults for nothing, junk or arrays", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ theme: "neon", editorMode: 3, updates: "yes", dtcPath: "dtc" })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields", () => {
    const s = parseSettings({ theme: "dark", editorMode: "graph", dtcPath: "/opt/dtc/bin/dtc", updates: false });
    expect(s).toMatchObject({ theme: "dark", editorMode: "graph", dtcPath: "/opt/dtc/bin/dtc", updates: false });
  });

  it("keeps only well-formed shortcut overrides", () => {
    const s = parseSettings({
      shortcuts: { build: "Ctrl+Shift+B", fit: "", layout: "Alt+L", "../x": "Ctrl+X", save: 5 },
    });
    expect(s.shortcuts).toEqual({ build: "Ctrl+Shift+B", fit: "" });
    // The clipboard and tab shortcuts are not for commands.
    expect(parseSettings({ shortcuts: { fit: "Ctrl+W", layout: "Ctrl+C" } }).shortcuts).toEqual({});
  });
});

describe("isCombo", () => {
  it("accepts what comboOf produces and nothing else", () => {
    for (const ok of ["Ctrl+S", "Ctrl+Shift+Z", "Ctrl+,", "Ctrl+1", "F1", "F12"]) expect(isCombo(ok)).toBe(true);
    for (const bad of ["S", "Ctrl+", "Ctrl+Tab", "Shift+S", "F13", "Ctrl+s"]) expect(isCombo(bad)).toBe(false);
  });
});
