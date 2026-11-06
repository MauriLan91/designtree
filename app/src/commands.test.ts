import { describe, expect, it } from "vitest";
import { comboOf, menusOf, pickOf, shortcutClashes, tooltipOf, withShortcuts, type Command } from "./commands";

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({ id, title: id, run: () => {}, ...extra });

describe("menusOf", () => {
  it("orders menus as the menu bar does and drops empty ones", () => {
    const menus = menusOf([cmd("help", { menu: "Help" }), cmd("new", { menu: "File" }), cmd("palette-only")]);
    expect(menus.map((m) => m.name)).toEqual(["File", "Help"]);
  });

  it("groups by group number and keeps registry order inside a group", () => {
    const [file] = menusOf([
      cmd("save", { menu: "File", group: 2 }),
      cmd("new", { menu: "File" }),
      cmd("open", { menu: "File", group: 1 }),
      cmd("import", { menu: "File", group: 1 }),
    ]);
    expect(file.groups.map((g) => g.map((c) => c.id))).toEqual([["new"], ["open", "import"], ["save"]]);
  });
});

describe("comboOf", () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("names Ctrl and Ctrl+Shift combinations the way commands declare them", () => {
    expect(comboOf(key("s", { ctrlKey: true }))).toBe("Ctrl+S");
    expect(comboOf(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Z");
    expect(comboOf(key("b", { metaKey: true }))).toBe("Ctrl+B");
    expect(comboOf(key("F1"))).toBe("F1");
  });

  it("names Shift+digit and Shift+punctuation by the key, not the character", () => {
    expect(comboOf({ ...key("!", { ctrlKey: true, shiftKey: true }), code: "Digit1" })).toBe("Ctrl+Shift+1");
    expect(comboOf({ ...key("<", { ctrlKey: true, shiftKey: true }), code: "Comma" })).toBe("Ctrl+Shift+,");
    expect(comboOf({ ...key("L", { ctrlKey: true, shiftKey: true }), code: "KeyL" })).toBe("Ctrl+Shift+L");
  });

  it("leaves plain typing, Alt combinations and named keys alone", () => {
    expect(comboOf(key("s"))).toBeNull();
    expect(comboOf(key("f", { altKey: true }))).toBeNull();
    expect(comboOf(key("Tab", { ctrlKey: true }))).toBeNull();
  });
});

describe("pickOf", () => {
  it("recognises a node pick and ignores promises and nothing", () => {
    const pick = { title: "Parent", nodes: [], onPick: () => {} };
    expect(pickOf(pick)).toBe(pick);
    expect(pickOf(Promise.resolve())).toBeNull();
    expect(pickOf(undefined)).toBeNull();
  });
});

describe("tooltipOf", () => {
  it("joins title, shortcut and hint", () => {
    expect(tooltipOf(cmd("x", { title: "Open design…", shortcut: "Ctrl+O" }))).toBe("Open design (Ctrl+O)");
    expect(tooltipOf(cmd("x", { title: "Empty node", hint: "Add a node with no binding" }))).toBe(
      "Empty node\nAdd a node with no binding",
    );
  });
});

describe("withShortcuts", () => {
  const commands = [cmd("save", { shortcut: "Ctrl+S" }), cmd("undo", { shortcut: "Ctrl+Z" }), cmd("fit")];

  it("applies overrides, removes with an empty one, and leaves fixed commands alone", () => {
    const out = withShortcuts(commands, { save: "", fit: "Ctrl+Shift+F", undo: "Ctrl+U" }, new Set(["undo"]));
    expect(out.map((c) => c.shortcut)).toEqual([undefined, "Ctrl+Z", "Ctrl+Shift+F"]);
  });

  it("finds shortcuts given twice", () => {
    const out = withShortcuts(commands, { fit: "Ctrl+S" }, new Set());
    expect([...shortcutClashes(out)]).toEqual([["Ctrl+S", ["save", "fit"]]]);
  });
});
