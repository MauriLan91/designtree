// One test per command of the registry (US-4.5). Each sets the stage, runs
// the command with `run()` (through its menu item, its shortcut, its
// toolbar button or the palette: the runner tries each the command has) and
// checks what it did to the design, the DTS text, a file or the view.
// The runner fails when a command of the registry has no entry here.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, Failure } from "./harness.mjs";

const LEDS = ["/led-a", "/led-b", "/led-c"];

const byId = (design) => new Map(design.nodes.map((n) => [n.id, n]));
const childEdges = (design) => design.edges.filter((e) => e.kind === "child");
const parentOf = (design, id) => childEdges(design).find((e) => e.to === id)?.from;
const positions = async (t, ids) => {
  const nodes = byId(await t.design());
  return ids.map((id) => nodes.get(id)?.position);
};
const moved = (a, b) => a.some((p, i) => !b[i] || Math.abs(p.x - b[i].x) > 0.5 || Math.abs(p.y - b[i].y) > 0.5);
const nodeCount = async (t) => (await t.design()).nodes.length;
const rects = (t, ids) => Promise.all(ids.map((id) => t.rect(t.card(id))));

/** Opens the soc scope by its card's "inside" button, for tests that need children on show. */
async function openSoc(t) {
  await t.select("/soc");
  await t.menu("View", "Open selected node");
  await t.expect(async () => (await t.scope()) === "/soc", "the soc scope");
}

/** Spreads the LEDs apart so that the arrange commands have work to do. */
async function scatter(t) {
  // Into the empty space left of the cards, so that none lands on another.
  await t.drag(t.card("/led-a"), -200, 0);
  await t.drag(t.card("/led-b"), -150, 60);
}

const sameWithin = (values, tolerance = 1.5) => Math.max(...values) - Math.min(...values) <= tolerance;

/** A test that the panel switched to a tab. */
const panelTab = (tab, title) => async (t) => {
  await t.run();
  await t.expect(() => t.visible(".bottom-pane .panel-body"), "the bottom panel");
  await t.expect(
    () => t.js("const s = document.querySelector('.panel-tabs [aria-selected=true]'); return s && s.textContent.startsWith(arguments[0])", title),
    `the ${title} tab`,
  );
  await t.expect(async () => (await t.layout())?.panel?.tab === tab, `layout tab ${tab}`);
};

/** A test that a pane opens and closes. */
const paneToggle = (css, what) => async (t) => {
  const before = await t.visible(css);
  await t.run();
  await t.expect(async () => (await t.visible(css)) !== before, `the ${what} to ${before ? "close" : "open"}`);
};

/** A test that an editor mode shows the right panes. */
const mode = (graph, source) => async (t) => {
  // Start from another mode, so that the command has something to change.
  await t.menu("View", graph && !source ? "DTS source" : "Graph");
  await t.run();
  await t.expect(async () => (await t.visible(".graph")) === graph && (await t.visible(".source-pane")) === source, `graph ${graph}, source ${source}`);
};

/** Picks `title` in the palette's second step (a node, a kernel). */
const pickInPalette = async (t, title) => {
  await t.expect(() => t.dialog("Command palette"), "the palette's pick");
  await t.type('.command-palette input[aria-label="Command"]', title);
  await t.pick(title);
};

export const COMMANDS = {
  // File
  new: async (t) => {
    const tabs = await t.count(".tab");
    await t.run();
    await t.expect(async () => (await t.count(".tab")) === tabs + 1, "a new tab");
    await t.expect(async () => (await t.design())?.nodes.length === 1, "an empty design (root only)");
  },
  soc: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("New board from a SoC"), "the SoC picker");
  },
  overlay: async (t) => {
    await t.answer(join(FIXTURES, "board.json"));
    await t.run();
    await t.expect(async () => (await t.design())?.overlay?.base?.endsWith("board.json"), "an overlay on board.json");
  },
  open: async (t) => {
    const other = t.file("other.json");
    const design = JSON.parse(readFileSync(join(FIXTURES, "board.json"), "utf8"));
    design.nodes = design.nodes.filter((n) => !n.id.startsWith("/led"));
    design.edges = design.edges.filter((e) => !e.to.startsWith("/led"));
    writeFileSync(other, JSON.stringify(design));
    await t.answer(other);
    await t.run();
    await t.expect(async () => (await nodeCount(t)) === design.nodes.length, "the other design");
    await t.expect(() => t.js("return [...document.querySelectorAll('.tab .tab-title')].some((e) => e.textContent === 'other.json')"), "its tab");
  },
  import: async (t) => {
    await t.answer(join(FIXTURES, "board.dts"));
    await t.run();
    await t.expect(() => t.js("return [...document.querySelectorAll('.tab .tab-title')].some((e) => e.textContent.startsWith('board'))"), "a tab for the import");
    await t.expect(async () => (await t.design())?.nodes.some((n) => n.id === "/soc/serial@2000"), "the imported nodes");
  },
  save: async (t) => {
    await t.menu("Insert", "Empty node");
    const count = await nodeCount(t);
    await t.run();
    await t.expect(() => JSON.parse(readFileSync(t.designPath, "utf8")).nodes.length === count, "the new node in the saved file");
    await t.expect(async () => (await t.count(".tab-dirty")) === 0, "no unsaved mark");
  },
  "save-as": async (t) => {
    const path = t.file("copy.json");
    await t.answer(path);
    await t.run();
    await t.expect(() => existsSync(path) && JSON.parse(readFileSync(path, "utf8")).nodes.length === 11, "copy.json written");
    await t.expect(() => t.js("return document.querySelector('.tab.active .tab-title, .tab[aria-selected=true] .tab-title')?.textContent === 'copy.json'"), "the tab renamed");
  },
  export: async (t) => {
    const path = t.file("board.dts");
    await t.answer(path);
    await t.run();
    await t.expect(() => existsSync(path) && /serial@2000 \{/.test(readFileSync(path, "utf8")), "the DTS written");
  },
  settings: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("Settings"), "the settings");
  },

  // Edit
  undo: async (t) => {
    const count = await nodeCount(t);
    await t.menu("Insert", "Empty node");
    await t.expect(async () => (await nodeCount(t)) === count + 1, "the added node");
    await t.run();
    await t.expect(async () => (await nodeCount(t)) === count, "the node gone again");
  },
  redo: async (t) => {
    const count = await nodeCount(t);
    await t.menu("Insert", "Empty node");
    await t.menu("Edit", "Undo");
    await t.expect(async () => (await nodeCount(t)) === count, "the undo");
    await t.run();
    await t.expect(async () => (await nodeCount(t)) === count + 1, "the node back");
  },
  move: async (t) => {
    await t.select("/led-a");
    await t.run();
    await pickInPalette(t, "soc");
    await t.expect(async () => parentOf(await t.design(), "/soc/led-a") === "/soc" || parentOf(await t.design(), "/led-a") === "/soc", "led-a under soc");
  },
  group: async (t) => {
    await t.select("/led-a", "/led-b");
    await t.run();
    await t.expect(async () => (await t.design()).groups?.some((g) => LEDS.slice(0, 2).every((id) => g.members?.includes(id) || g.nodes?.includes(id))), "a group of led-a and led-b");
  },
  "select-all": async (t) => {
    await t.run();
    await t.expect(async () => (await t.selected()).filter((id) => !id.startsWith("group")).length >= 6, "every card selected");
  },
  "tool-select": async (t) => {
    await t.menu("Edit", "Pan tool");
    await t.expect(async () => (await t.layout())?.tool === "pan", "the pan tool first");
    await t.run();
    await t.expect(async () => (await t.layout())?.tool === "select", "the select tool");
  },
  "tool-pan": async (t) => {
    await t.run();
    await t.expect(async () => (await t.layout())?.tool === "pan", "the pan tool");
  },
  ungroup: async (t) => {
    await t.select("/led-a", "/led-b");
    await t.menu("Edit", "Group selection");
    await t.expect(async () => (await t.design()).groups?.length === 1, "the group");
    // Ungroup works on a selected group, not on its members.
    await t.click(".react-flow__node-group");
    await t.run();
    await t.expect(async () => !(await t.design()).groups?.length, "no group");
  },

  // Arrange
  tidy: async (t) => {
    await scatter(t);
    const before = await positions(t, LEDS);
    await t.run();
    await t.expect(async () => moved(await positions(t, LEDS), before), "the cards moved");
  },
  "tidy-selection": async (t) => {
    await scatter(t);
    await t.select("/led-a", "/led-b");
    const before = await positions(t, LEDS.slice(0, 2));
    await t.run();
    await t.expect(async () => moved(await positions(t, LEDS.slice(0, 2)), before), "the selection moved");
  },
  ...Object.fromEntries(
    ["grid", "tree-vertical", "tree-horizontal", "star"].map((how) => [
      `arrange-${how}`,
      async (t) => {
        await scatter(t);
        const ids = ["/memory@80000000", "/oscillator", "/soc", ...LEDS];
        const before = await positions(t, ids);
        await t.run();
        await t.expect(async () => moved(await positions(t, ids), before), `a ${how} arrangement`);
      },
    ]),
  ),
  layout: async (t) => {
    await scatter(t);
    const before = await positions(t, LEDS);
    await t.run();
    await t.expect(async () => moved(await positions(t, LEDS), before), "the tree laid out");
  },
  ...Object.fromEntries(
    [
      ["left", (r) => r.x],
      ["center", (r) => r.x + r.w / 2],
      ["right", (r) => r.x + r.w],
      ["top", (r) => r.y],
      ["middle", (r) => r.y + r.h / 2],
      ["bottom", (r) => r.y + r.h],
    ].map(([how, edge]) => [
      `align-${how}`,
      async (t) => {
        await scatter(t);
        await t.select(...LEDS);
        await t.run();
        await t.expect(async () => sameWithin((await rects(t, LEDS)).map(edge)), `${how} edges in line`);
      },
    ]),
  ),
  "distribute-horizontal": async (t) => {
    await scatter(t);
    await t.select(...LEDS);
    await t.run();
    await t.expect(async () => {
      const xs = (await rects(t, LEDS)).map((r) => r.x + r.w / 2).sort((a, b) => a - b);
      return sameWithin([xs[1] - xs[0], xs[2] - xs[1]], 2);
    }, "even horizontal spacing");
  },
  "distribute-vertical": async (t) => {
    await scatter(t);
    await t.select(...LEDS);
    await t.run();
    await t.expect(async () => {
      const ys = (await rects(t, LEDS)).map((r) => r.y + r.h / 2).sort((a, b) => a - b);
      return sameWithin([ys[1] - ys[0], ys[2] - ys[1]], 2);
    }, "even vertical spacing");
  },

  // View
  palette: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("Command palette"), "the palette");
  },
  "go-to-node": async (t) => {
    await t.run();
    await pickInPalette(t, "serial@2000");
    await t.expect(async () => (await t.selected()).includes("/soc/serial@2000"), "serial@2000 selected");
    await t.expect(async () => (await t.scope()) === "/soc", "its scope shown");
  },
  "open-scope": async (t) => {
    await t.select("/soc");
    await t.run();
    await t.expect(async () => (await t.scope()) === "/soc", "the soc scope");
    await t.expect(() => t.visible(t.card("/soc/serial@2000")), "its children on the canvas");
  },
  "up-scope": async (t) => {
    await openSoc(t);
    await t.run();
    await t.expect(async () => (await t.scope()) === "/", "the main scope");
  },
  "hide-disabled": async (t) => {
    await openSoc(t);
    await t.expect(() => t.visible(t.card("/soc/serial@3000")), "the disabled UART first");
    await t.run();
    await t.expect(async () => !(await t.visible(t.card("/soc/serial@3000"))), "the disabled UART hidden");
    await t.expect(() => t.visible(t.card("/soc/serial@2000")), "the enabled UART kept");
  },
  outline: async (t) => {
    await t.run();
    await t.expect(() => t.js("return [...document.querySelectorAll('.navigator h2')].some((h) => h.textContent === 'Outline' && !h.closest('[hidden]'))"), "the Outline");
    await t.expect(() => t.js("return [...document.querySelectorAll('.navigator .nav-name')].some((n) => n.textContent.includes('soc'))"), "the tree in it");
  },
  "mode-graph": mode(true, false),
  "mode-split": mode(true, true),
  "mode-dts": mode(false, true),
  library: paneToggle(".palette", "library"),
  inspector: paneToggle(".inspector-pane .pane-body:not([hidden])", "inspector"),
  panel: paneToggle(".bottom-pane .panel-body", "bottom panel"),
  problems: panelTab("problems", "Problems"),
  "build-output": panelTab("build", "Build"),
  interrupts: async (t) => {
    await panelTab("interrupts", "Interrupts")(t);
    await t.expect(() => t.js("return document.querySelector('.panel-body')?.textContent.includes('serial@2000')"), "serial@2000 in the interrupt tree");
  },
  "address-map": async (t) => {
    await panelTab("address-map", "Address map")(t);
    await t.expect(() => t.js("return document.querySelector('.panel-body')?.textContent.includes('memory')"), "the memory region");
  },
  board: async (t) => {
    await t.run();
    await t.expect(() => t.visible(".board-view, .board-devices"), "the board view");
    await t.expect(async () => !(await t.visible(".scope-bar")), "the scope bar gone");
  },
  fit: async (t) => {
    const transform = () => t.js("return document.querySelector('.react-flow__viewport')?.style.transform");
    // Zoom far out first, so that fitting has something to change.
    for (let i = 0; i < 4; i++) await t.click(".react-flow__controls-zoomout");
    const before = await transform();
    await t.run();
    await t.expect(async () => (await transform()) !== before, "the view to change");
  },
  snap: async (t) => {
    const before = (await t.command("snap")).checked;
    await t.run();
    await t.expect(async () => (await t.command("snap")).checked === !before, "snapping toggled");
    if (!before) {
      // With snapping on, a dragged card lands on the 20 px grid.
      await t.drag(t.card("/led-a"), 33, 17);
      await t.expect(async () => {
        const [p] = await positions(t, ["/led-a"]);
        return p.x % 20 === 0 && p.y % 20 === 0;
      }, "led-a on the grid");
    }
  },

  // Insert
  add: async (t) => {
    const count = await nodeCount(t);
    await t.run();
    await t.expect(async () => (await nodeCount(t)) === count + 1, "a new node");
    await t.expect(async () => /\n\t\w[^\n]*\{/.test(await t.dts()), "a node in the DTS text");
  },
  connect: async (t) => {
    await t.select("/led-a");
    await t.run();
    await pickInPalette(t, "oscillator");
    await t.expect(async () => (await t.design()).edges.some((e) => e.from === "/led-a" && e.to === "/oscillator" && e.kind !== "child"), "a reference from led-a to the oscillator");
    await t.expect(async () => /&osc/.test(await t.dts()), "&osc in the DTS text");
  },

  // Tools
  build: async (t) => {
    const dtb = t.designPath.replace(/\.json$/, ".dtb");
    await t.run();
    await t.expect(() => existsSync(dtb) && readFileSync(dtb).readUInt32BE(0) === 0xd00dfeed, "a .dtb next to the design", 15000);
    await t.expect(() => t.js("const s = document.querySelector('.panel-tabs [aria-selected=true]'); return s && s.textContent.startsWith('Build')"), "the Build tab");
  },
  kernels: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("Settings"), "the settings");
    await t.expect(() => t.text(".settings-nav [aria-current=page]").then((s) => s === "Kernel"), "on the Kernel section");
  },
  "use-kernel": async (t) => {
    await t.run();
    await t.expect(() => t.dialog("Command palette"), "the checkout pick");
    await t.expect(() => t.js("return [...document.querySelectorAll('.command-palette [role=option]')].some((o) => o.textContent.includes('Manage kernel checkouts'))"), "the checkouts listed");
  },
  dtc: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("Settings"), "the settings");
    await t.expect(() => t.text(".settings-nav [aria-current=page]").then((s) => s === "Build"), "on the Build section");
  },

  // Help
  shortcuts: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("Keyboard shortcuts"), "the shortcut sheet");
    await t.expect(() => t.js("return document.querySelector('.shortcuts')?.textContent.includes('Ctrl+Shift+Z')"), "Redo's shortcut listed");
  },
  updates: async (t) => {
    await t.run();
    // Up to date, newer, or the network refused: any answer is shown.
    await t.expect(() => t.visible(".update-notice"), "an answer about updates", 15000);
  },
  about: async (t) => {
    await t.run();
    await t.expect(() => t.dialog("About DesignTree"), "the About page");
    await t.expect(() => t.js("return /\\d+\\.\\d+\\.\\d+/.test(document.querySelector('.about-facts')?.textContent ?? '')"), "the version");
  },
};

export { Failure };
