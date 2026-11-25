// The UI elements outside the command registry (US-4.5), listed by hand:
// shortcuts the registry does not own, tabs, pane and panel controls, the
// canvas, the library, the inspector, the Outline, the Problems tab, the
// status bar and the dialogs. Each is checked by what it does. A new
// element of the window belongs here, with its test.
//
// Two kinds of input WebDriver cannot give WebKitGTK are made in the page
// instead, and say so: HTML drag and drop (the library and the board view)
// and the clipboard.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Failure } from "./harness.mjs";

const nodeCount = async (t) => (await t.design()).nodes.length;
const hasNode = async (t, id) => (await t.design()).nodes.some((n) => n.id === id);
const tabTitles = (t) => t.js("return [...document.querySelectorAll('.tab .tab-title')].map((e) => e.textContent)");
const activeTab = (t) => t.js("return document.querySelector('.tab[aria-selected=true] .tab-title')?.textContent ?? null");

async function openSettings(t) {
  await t.click('button.activity[aria-label="Settings"]');
  await t.expect(() => t.dialog("Settings"), "the settings");
}

async function openSoc(t) {
  await t.select("/soc");
  await t.menu("View", "Open selected node");
  await t.expect(async () => (await t.scope()) === "/soc", "the soc scope");
}

/** Sets an inspector text field (by its label) and commits it with Enter. */
async function setField(t, label, value) {
  const index = await t.js(
    "return [...document.querySelectorAll('.inspector label')].findIndex((l) => l.firstChild?.textContent?.trim().startsWith(arguments[0]))",
    label,
  );
  if (index < 0) throw new Failure(`no inspector field ${label}`);
  await t.js(
    "document.querySelectorAll('[data-e2e]').forEach((e) => delete e.dataset.e2e); document.querySelectorAll('.inspector label')[arguments[0]].querySelector('input').dataset.e2e = 'field'",
    index,
  );
  await t.type('.inspector input[data-e2e="field"]', value + "\uE007", { replace: true });
}

/** Chooses `value` in a <select> found by `css`, by clicking its option. */
async function choose(t, css, value) {
  const [option] = await t.session.find(`${css} option[value="${value}"]`);
  if (!option) throw new Failure(`no option ${value} in ${css}`);
  await t.session.click(option);
}

/** HTML drag and drop, which WebDriver's pointer cannot start in WebKitGTK:
 * the events the browser would send, with one DataTransfer. */
function dragAndDrop(t, from, to) {
  return t.js(
    `const from = document.querySelector(arguments[0]), to = document.querySelector(arguments[1]);
     if (!from || !to) return false;
     const r = to.getBoundingClientRect(), x = r.x + r.width / 3, y = r.y + r.height / 3;
     const dt = new DataTransfer();
     const send = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
     send(from, 'dragstart'); send(to, 'dragenter'); send(to, 'dragover'); send(to, 'drop'); send(from, 'dragend');
     return true;`,
    from,
    to,
  );
}

const e = (id, kind, where, title, test) => ({ id, kind, where, title, test });

export const ELEMENTS = [
  // Shortcuts outside the registry (the shortcut sheet lists them).
  e("key-ctrl-y", "shortcut", "window", "Ctrl+Y redoes", async (t) => {
    const count = await nodeCount(t);
    await t.menu("Insert", "Empty node");
    await t.press("Ctrl+Z");
    await t.expect(async () => (await nodeCount(t)) === count, "the undo");
    await t.press("Ctrl+Y");
    await t.expect(async () => (await nodeCount(t)) === count + 1, "the redo");
  }),
  e("key-copy-paste", "shortcut", "canvas", "Ctrl+C, Ctrl+V copy and paste nodes", async (t) => {
    const count = await nodeCount(t);
    await t.select("/led-a");
    await t.press("Ctrl+C");
    await t.press("Ctrl+V");
    await t.expect(async () => (await nodeCount(t)) === count + 1, "a pasted copy of led-a");
  }),
  e("key-delete", "shortcut", "canvas", "Delete removes the selection", async (t) => {
    await t.select("/led-c");
    await t.press("Delete");
    await t.expect(async () => !(await hasNode(t, "/led-c")), "led-c deleted");
    await t.expect(async () => !(await t.dts()).includes("led-c"), "led-c gone from the DTS text");
  }),
  e("key-ctrl-tab", "shortcut", "window", "Ctrl+Tab and Ctrl+Shift+Tab switch tabs", async (t) => {
    await t.click(".tab-new");
    await t.expect(async () => (await activeTab(t)) === "Untitled", "the new tab active");
    await t.press("Ctrl+Tab");
    await t.expect(async () => (await activeTab(t)) === "design.json", "back to design.json");
    await t.press("Ctrl+Shift+Tab");
    await t.expect(async () => (await activeTab(t)) === "Untitled", "the other tab again");
  }),
  e("key-ctrl-w", "shortcut", "window", "Ctrl+W closes the tab, asking about unsaved changes", async (t) => {
    await t.click(".tab-new");
    await t.expect(async () => (await tabTitles(t)).length === 2, "two tabs");
    await t.press("Ctrl+W");
    await t.expect(async () => (await tabTitles(t)).length === 1, "the clean tab closed");
    // The design has changes (its first arrangement): closing asks.
    await t.menu("Insert", "Empty node");
    await t.press("Ctrl+W");
    await t.expect(() => t.dialog("Unsaved changes"), "the unsaved changes question");
  }),
  e("key-alt-letter", "shortcut", "menu bar", "Alt+letter opens a menu", async (t) => {
    await t.press("Alt+F");
    await t.expect(() => t.visible('.menu-popup[aria-label="File"]'), "the File menu");
    await t.press("Escape");
    await t.expect(async () => !(await t.visible('.menu-popup[aria-label="File"]')), "the menu closed by Escape");
  }),
  e("click-modifiers", "pointer", "canvas", "Ctrl+click and Shift+click add to the selection or take out", async (t) => {
    await t.select("/led-a", "/led-b");
    await t.clickWith(t.card("/led-c"), ["Shift"]);
    await t.expect(async () => (await t.selected()).length === 3, "three selected");
    await t.clickWith(t.card("/led-a"), ["Ctrl"]);
    await t.expect(async () => !(await t.selected()).includes("/led-a"), "led-a taken out");
  }),
  e("drag-node", "pointer", "canvas", "Dragging a card moves the node", async (t) => {
    const before = (await t.design()).nodes.find((n) => n.id === "/led-a").position;
    await t.drag(t.card("/led-a"), -120, 40);
    await t.expect(async () => {
      const p = (await t.design()).nodes.find((n) => n.id === "/led-a").position;
      return Math.abs(p.x - before.x) > 20 && Math.abs(p.y - before.y) > 10;
    }, "led-a's position changed");
  }),
  e("pan-tool-drag", "pointer", "canvas", "With the pan tool, dragging the canvas moves the view", async (t) => {
    await t.menu("Edit", "Pan tool");
    const transform = () => t.js("return document.querySelector('.react-flow__viewport').style.transform");
    const before = await transform();
    await t.drag(".react-flow__pane", 60, 40);
    await t.expect(async () => (await transform()) !== before, "the view moved");
  }),
  e("select-tool-area", "pointer", "canvas", "With the select tool, dragging the canvas selects an area", async (t) => {
    const r = await t.rect(t.card("/led-b"));
    const pane = await t.rect(".react-flow__pane");
    // From empty canvas left of and above led-b to past led-c.
    await t.js(
      `window.__start = document.elementFromPoint(arguments[0], arguments[1]);`,
      Math.max(pane.x + 5, r.x - 15),
      r.y - 15,
    );
    const [paneEl] = await t.session.find(".react-flow__pane");
    await t.session.call("POST", "/actions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", duration: 0, x: Math.round(Math.max(pane.x + 5, r.x - 15)), y: Math.round(r.y - 15) },
            { type: "pointerDown", button: 0 },
            { type: "pointerMove", duration: 150, x: Math.round(r.x + r.w * 2.6), y: Math.round(r.y + r.h + 10) },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    await t.session.call("DELETE", "/actions");
    void paneEl;
    await t.expect(async () => (await t.selected()).includes("/led-b"), "led-b in the area selection");
  }),

  // Tabs.
  e("tab-new", "button", "tab bar", "+ opens a new tab", async (t) => {
    await t.click(".tab-new");
    await t.expect(async () => (await tabTitles(t)).length === 2 && (await activeTab(t)) === "Untitled", "a new Untitled tab");
  }),
  e("tab-switch", "tab", "tab bar", "Clicking a tab shows its design", async (t) => {
    await t.click(".tab-new");
    await t.expect(async () => (await nodeCount(t)) === 1, "the empty design");
    await t.click(".tab:first-child");
    await t.expect(async () => (await nodeCount(t)) === 11, "design.json again");
  }),
  e("tab-close", "button", "tab bar", "× closes a tab", async (t) => {
    await t.click(".tab-new");
    await t.click('.tab:last-of-type .tab-close');
    await t.expect(async () => (await tabTitles(t)).length === 1, "one tab left");
  }),
  e("unsaved-dialog", "dialog", "tab bar", "Unsaved changes: Cancel keeps the tab, Discard closes it", async (t) => {
    await t.click(".tab-new");
    await t.menu("Insert", "Empty node");
    await t.expect(async () => (await t.count(".tab[aria-selected=true] .tab-dirty")) === 1, "the new tab marked unsaved");
    await t.click('.tab[aria-selected=true] .tab-close');
    await t.expect(() => t.dialog("Unsaved changes"), "the question");
    await t.js("[...document.querySelectorAll('[aria-label=\"Unsaved changes\"] button')].find((b) => b.textContent === 'Cancel').click()");
    await t.expect(async () => (await tabTitles(t)).length === 2, "the tab kept");
    await t.click('.tab[aria-selected=true] .tab-close');
    await t.expect(() => t.dialog("Unsaved changes"), "the question again");
    const buttons = await t.session.find('[aria-label="Unsaved changes"] button');
    await t.session.click(buttons[1]);
    await t.expect(async () => (await tabTitles(t)).length === 1, "the tab discarded");
  }),

  // Activity bar, mode switch, panes.
  e("activity-library-outline", "button", "activity bar", "Library and Outline buttons switch the side bar", async (t) => {
    await t.click('.activity-bar button[aria-label="Outline"], [aria-label="Outline"]');
    await t.expect(async () => (await t.layout())?.library?.view === "outline", "the Outline");
    await t.click('[aria-label="Library"]');
    await t.expect(async () => (await t.layout())?.library?.view === "library" && (await t.visible(".palette")), "the library");
  }),
  e("activity-settings", "button", "activity bar", "The gear opens the settings", async (t) => {
    await openSettings(t);
    await t.expect(() => t.dialog("Settings"), "the settings");
  }),
  e("mode-switch", "button", "canvas header", "Graph, Split and DTS buttons set the editor mode", async (t) => {
    for (const [label, graph, source] of [
      ["DTS", false, true],
      ["Graph", true, false],
      ["Split", true, true],
    ]) {
      const index = await t.js("return [...document.querySelectorAll('.mode-switch button')].findIndex((b) => b.textContent.trim() === arguments[0])", label);
      const buttons = await t.session.find(".mode-switch button");
      await t.session.click(buttons[index]);
      await t.expect(async () => (await t.visible(".graph")) === graph && (await t.visible(".source-pane")) === source, `${label} mode`);
    }
  }),
  e("pane-toggle-inspector", "button", "inspector", "The inspector's collapse button folds it to a rail and back", async (t) => {
    await t.click('.inspector-pane .pane-toggle');
    await t.expect(async () => (await t.layout())?.inspector?.open === false, "the inspector folded");
    await t.click('.inspector-pane .pane-toggle');
    await t.expect(async () => (await t.layout())?.inspector?.open === true, "the inspector open");
  }),
  e("splitter", "splitter", "panes", "Dragging a pane edge resizes it; a double-click restores it", async (t) => {
    const before = (await t.layout())?.library?.size ?? 248;
    await t.drag('[role="separator"][aria-label="Library width"], .splitter[aria-label="Library width"]', 80, 0);
    await t.expect(async () => ((await t.layout())?.library?.size ?? 0) > before + 40, "a wider library");
    await t.doubleClick('[aria-label="Library width"]');
    await t.expect(async () => (await t.layout())?.library?.size === before, "the default width");
  }),
  e("split-handle", "splitter", "canvas", "The graph and DTS divider sets the split", async (t) => {
    await t.drag(".splitter-split", -120, 0);
    await t.expect(async () => ((await t.layout())?.split ?? 0.5) < 0.45, "a narrower graph");
    await t.doubleClick(".splitter-split");
    await t.expect(async () => (await t.layout())?.split === 0.5, "an even split");
  }),
  e("panel-tabs", "tab", "bottom panel", "Panel tabs and the hide button", async (t) => {
    await t.menu("View", "Bottom panel");
    for (const title of ["Build", "Interrupts", "Address map", "Problems"]) {
      const index = await t.js("return [...document.querySelectorAll('.panel-tabs [role=tab]')].findIndex((b) => b.textContent.startsWith(arguments[0]))", title);
      const tabs = await t.session.find(".panel-tabs [role=tab]");
      await t.session.click(tabs[index]);
      await t.expect(() => t.js("return document.querySelector('.panel-tabs [aria-selected=true]')?.textContent.startsWith(arguments[0])", title), `the ${title} tab`);
    }
    await t.click('.bottom-pane .pane-toggle');
    await t.expect(async () => (await t.layout())?.panel?.open === false, "the panel hidden");
  }),

  // Scopes and the canvas.
  e("card-inside", "button", "node card", "A card's \"nodes inside\" button opens its scope", async (t) => {
    await t.click(`${t.card("/soc")} .dt-node-children, ${t.card("/soc")} button`);
    await t.expect(async () => (await t.scope()) === "/soc", "the soc scope");
  }),
  e("scope-bar", "tab", "scope bar", "Scope tabs, their close button and the breadcrumb", async (t) => {
    await openSoc(t);
    await t.expect(async () => (await t.count(".scope-tabs [role=tab], .scope-tabs > *")) >= 2, "a soc tab");
    await t.click(".breadcrumb .link");
    await t.expect(async () => (await t.scope()) === "/", "the main scope from the breadcrumb");
    await t.click('.scope-close[aria-label="Close soc"]');
    await t.expect(async () => (await t.count('.scope-close[aria-label="Close soc"]')) === 0, "the soc tab closed");
  }),
  e("canvas-controls", "button", "canvas", "Zoom in, zoom out, fit and lock", async (t) => {
    const zoom = () => t.js("return Number(/scale\\(([\\d.]+)\\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1)");
    const z0 = await zoom();
    await t.click(".react-flow__controls-zoomin");
    await t.expect(async () => (await zoom()) > z0, "zoomed in");
    const z1 = await zoom();
    await t.click(".react-flow__controls-zoomout");
    await t.expect(async () => (await zoom()) < z1, "zoomed out");
    await t.click(".react-flow__controls-zoomout");
    const z2 = await zoom();
    await t.click(".react-flow__controls-fitview");
    await t.expect(async () => (await zoom()) !== z2, "fitted");
    // Locked, a card no longer moves when dragged.
    await t.click(".react-flow__controls-interactive");
    const before = (await t.design()).nodes.find((n) => n.id === "/led-a").position;
    await t.drag(t.card("/led-a"), -120, 40);
    await new Promise((r) => setTimeout(r, 500));
    const after = (await t.design()).nodes.find((n) => n.id === "/led-a").position;
    if (Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1) throw new Failure("a card moved on a locked canvas");
  }),
  e("minimap", "view", "canvas", "The minimap draws the cards", async (t) => {
    await t.expect(async () => (await t.count(".react-flow__minimap-node")) >= 6, "a minimap node per card");
  }),
  e("handle-connect", "pointer", "canvas", "Dragging from a card's reference handle to another wires a reference", async (t) => {
    const from = `${t.card("/led-a")} .react-flow__handle-right, ${t.card("/led-a")} .h-ref.source`;
    const to = `${t.card("/oscillator")} .react-flow__handle.h-ref`;
    const a = await t.rect(from);
    const b = await t.rect(to);
    if (!a || !b) throw new Failure("handles not found");
    await t.session.call("POST", "/actions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", duration: 0, x: Math.round(a.x + a.w / 2), y: Math.round(a.y + a.h / 2) },
            { type: "pointerDown", button: 0 },
            { type: "pointerMove", duration: 200, x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    await t.session.call("DELETE", "/actions");
    await t.expect(async () => (await t.design()).edges.some((x) => x.from === "/led-a" && x.to === "/oscillator" && x.kind !== "child"), "a reference from led-a to the oscillator");
  }),

  // Library.
  e("library-search", "field", "library", "The search narrows the library", async (t) => {
    await t.type('.palette input[type="search"], .palette .search-field input', "uart");
    await t.expect(() => t.js("const t = document.querySelector('.palette .lib-scroll')?.textContent ?? ''; return t.includes('vendor,uart-a') && !t.includes('fixed-clock')"), "only the UARTs");
  }),
  e("library-filters", "field", "library", "Class, vendor and bus filters, and their clear buttons", async (t) => {
    const total = () => t.text(".lib-total");
    const before = await total();
    const [option] = await t.session.find('.palette select[aria-label="Filter by vendor"] option:nth-child(2)');
    await t.session.click(option);
    await t.expect(async () => (await total()) !== before, "fewer entries");
    await t.click('[aria-label="Clear the vendor filter"]');
    await t.expect(async () => (await total()) === before, "all entries again");
  }),
  e("library-fits", "button", "library", "Fits here keeps what goes under the open bus", async (t) => {
    await openSoc(t);
    const total = () => t.text(".lib-total");
    const before = await total();
    await t.click(".filter-chip.toggle");
    await t.expect(async () => (await total()) !== before, "a narrower library");
  }),
  e("library-view", "button", "library", "List and grid views", async (t) => {
    await t.click('[aria-label="Library view"] [aria-label="Grid"]');
    await t.expect(async () => (await t.count(".lib-tile")) > 0, "tiles");
    await t.click('[aria-label="Library view"] [aria-label="List"]');
    await t.expect(async () => (await t.count(".binding-row")) > 0, "rows");
  }),
  e("library-add", "pointer", "library", "Double-click adds an element; dragging it onto the canvas too", async (t) => {
    const count = await nodeCount(t);
    await t.type(".palette .search-field input", "fixed-clock");
    await t.expect(() => t.js("const r = document.querySelectorAll('.palette .binding-row'); return r.length === 1 && r[0].textContent.includes('fixed-clock')"), "the fixed clock entry alone");
    await t.doubleClick(".palette .binding-row");
    await t.expect(async () => (await nodeCount(t)) === count + 1, "a node added by double-click");
    if (!(await dragAndDrop(t, ".palette .binding-row", ".react-flow__pane"))) throw new Failure("nothing to drag");
    await t.expect(async () => (await nodeCount(t)) === count + 2, "a node added by drag and drop (events made in the page)");
  }),
  e("library-star", "button", "library", "The star keeps an element in Favorites", async (t) => {
    await t.type(".palette .search-field input", "fixed-clock");
    await t.expect(() => t.js("return document.querySelectorAll('.palette .binding-row').length === 1"), "one entry");
    await t.click('.palette [aria-label="Add to favorites"]');
    await t.expect(async () => (await t.count('.palette [aria-label="Remove from favorites"]')) >= 1, "a favorite");
  }),

  // Inspector.
  e("inspector-fields", "field", "inspector", "Name, label and compatible fields change the node", async (t) => {
    await t.select("/led-a");
    await setField(t, "Name", "led-x");
    await t.expect(async () => (await t.dts()).includes("led-x {"), "led-x in the DTS text");
    await setField(t, "Label", "ledx");
    await t.expect(async () => (await t.dts()).includes("ledx: led-x"), "the label in the DTS text");
    await setField(t, "Compatible", "vendor,other-led");
    await t.expect(async () => (await t.dts()).includes('"vendor,other-led"'), "the compatible in the DTS text");
  }),
  e("inspector-properties", "field", "inspector", "Text view of the properties, and back to the table", async (t) => {
    await t.select("/led-a");
    await t.click('.inspector [aria-label="Property view"] button:last-child');
    await t.type('[aria-label="Properties as text"]', '\nlabel = "status-led"');
    await t.click('.inspector [aria-label="Property view"] button:first-child');
    await t.expect(async () => (await t.dts()).includes('label = "status-led"'), "the property in the DTS text");
    await t.expect(async () => (await t.count(".prop-table tr, .prop-table [role=row]")) > 1, "the table back");
  }),
  e("inspector-add-property", "field", "inspector", "Add a property in the table", async (t) => {
    await t.select("/led-a");
    await t.click(".prop-table .add-row input, .prop-table input[placeholder^='Add a property']");
    await t.type(".prop-table input[placeholder^='Add a property']", "default-state\uE007");
    await t.expect(async () => (await t.design()).nodes.find((n) => n.id === "/led-a").properties.some((p) => p.name === "default-state"), "default-state on led-a");
  }),

  // DTS source.
  e("dts-edit", "field", "DTS source", "Typing in the DTS text changes the design", async (t) => {
    // CodeMirror renders only the lines in view: scroll until led-c shows.
    const line = await t.waitFor(
      () =>
        t.js(
          "const s = document.querySelector('.source-pane .cm-scroller'); const i = [...document.querySelectorAll('.source-pane .cm-line')].findIndex((l) => l.textContent.includes('led-c {')); if (i < 0 && s) s.scrollTop += 200; return i < 0 ? 0 : i + 1",
        ),
      "led-c in the text",
    ).then((i) => i - 1);
    const lines = await t.session.find(".source-pane .cm-line");
    await t.session.click(lines[line]);
    await t.press("End");
    await t.session.call("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions: [..."\nlabel = \"typed\";"].flatMap((c) => [{ type: "keyDown", value: c === "\n" ? "\uE007" : c }, { type: "keyUp", value: c === "\n" ? "\uE007" : c }]) }] });
    await t.expect(async () => (await t.design()).nodes.find((n) => n.id === "/led-c")?.properties.some((p) => p.name === "label"), "label on led-c from the text", 8000);
  }),

  // Outline.
  e("outline", "tree", "Outline", "The Outline's filter, twisty, click and double-click", async (t) => {
    await t.menu("View", "Outline");
    await t.type('.navigator input', "serial@2000");
    await t.expect(() => t.js("return [...document.querySelectorAll('.navigator .nav-name')].some((n) => n.textContent.includes('serial@2000'))"), "the match");
    await t.expect(() => t.js("return ![...document.querySelectorAll('.navigator .nav-name')].some((n) => n.textContent.includes('led-a'))"), "led-a filtered out");
    const index = await t.js("return [...document.querySelectorAll('.navigator li')].findIndex((l) => l.textContent.includes('serial@2000'))");
    const rows = await t.session.find(".navigator li");
    await t.session.click(rows[index]);
    await t.expect(async () => (await t.selected()).includes("/soc/serial@2000"), "serial@2000 selected from the Outline");
    await t.click('.navigator [aria-label="Clear the search"]');
    await t.expect(() => t.js("return [...document.querySelectorAll('.navigator .nav-name')].some((n) => n.textContent.includes('led-a'))"), "the whole tree again");
    const soc = await t.js("return [...document.querySelectorAll('.navigator li')].findIndex((l) => l.querySelector('.nav-name')?.textContent.trim() === 'soc')");
    const socRows = await t.session.find(".navigator li");
    await t.session.clickWith(socRows[soc], [], true);
    await t.expect(async () => (await t.scope()) === "/soc", "soc opened by double-click");
    const twisty = await t.session.find(".navigator li .twisty");
    const visibleRows = await t.count(".navigator li");
    await t.session.click(twisty[0]);
    await t.expect(async () => (await t.count(".navigator li")) !== visibleRows, "the root folded or unfolded");
  }),

  // Problems tab.
  e("problems-view", "panel", "Problems", "Grouping, severity, sources, text filter, Whole design and a row's click", async (t) => {
    await t.menu("View", "Problems");
    await t.expect(() => t.js("return document.querySelector('.problems-view')?.textContent.includes('greater than the maximum')"), "the widget's error", 10000);
    await choose(t, '.problems-toolbar select[aria-label="Group the problems"]', "none");
    await t.expect(async () => (await t.count(".problem-items li.problem")) >= 1, "ungrouped rows");
    await choose(t, '.problems-toolbar select[aria-label="Severity"]', "warning");
    await t.expect(() => t.js("return ![...document.querySelectorAll('.problem-items li.problem')].some((l) => l.classList.contains('error'))"), "no errors with Warnings");
    await choose(t, '.problems-toolbar select[aria-label="Severity"]', "all");
    await t.type('.problems-toolbar input', "maximum");
    await t.expect(async () => (await t.count(".problem-items li.problem")) === 1, "one row for 'maximum'");
    const [row] = await t.session.find(".problem-items li.problem button");
    await t.session.click(row);
    await t.expect(async () => (await t.selected()).includes("/soc/widget@4000"), "the widget selected from its problem");
    const chips = await t.session.find(".problems-toolbar .chip");
    const schema = await t.js("return [...document.querySelectorAll('.problems-toolbar .chip')].findIndex((c) => c.textContent.startsWith('Schema'))");
    await t.session.click(chips[schema]);
    await t.expect(async () => (await t.count(".problem-items li.problem")) === 0, "schema problems left out");
  }),
  e("problems-whole-design", "button", "Problems", "Whole design lists the problems outside the open scope", async (t) => {
    await t.menu("Insert", "Empty node");
    await openSoc(t);
    await t.menu("View", "Problems");
    const count = () => t.js("return document.querySelectorAll('.problem-items li.problem, .problem-items li.group').length");
    await t.expect(() => t.text(".problems-scope").then((s) => s?.includes("/soc")), "the scope named");
    const scoped = await count();
    const whole = await t.js("return [...document.querySelectorAll('.problems-toolbar .chip')].findIndex((c) => c.textContent.startsWith('Whole design'))");
    const chips = await t.session.find(".problems-toolbar .chip");
    await t.session.click(chips[whole]);
    await t.expect(() => t.text(".problems-scope").then((s) => s?.startsWith("Every problem")), "the whole design");
    void scoped;
  }),

  // Status bar.
  e("status-bar", "button", "status bar", "Panel toggle, kernel, dtc, problem counts and version buttons", async (t) => {
    await t.click(".statusbar .panel-toggle");
    await t.expect(async () => (await t.layout())?.panel?.open === true, "the panel opened");
    await t.click('.statusbar button[aria-label$="warnings"]');
    await t.expect(() => t.js("return document.querySelector('.panel-tabs [aria-selected=true]')?.textContent.startsWith('Problems')"), "the Problems tab");
    await t.click('.statusbar button[title="Change the kernel checkout"]');
    await t.expect(() => t.dialog("Command palette"), "the checkout pick");
    await t.expect(() => t.js("return document.activeElement?.matches('.command-palette input')"), "the palette focused");
    await t.press("Escape");
    await t.expect(async () => !(await t.dialog("Command palette")), "the pick closed");
    await t.click('.statusbar button[title="Set the dtc path"]');
    await t.expect(() => t.dialog("Settings"), "the dtc setting");
    await t.press("Escape");
    await t.expect(async () => !(await t.dialog("Settings")), "the settings closed");
    await t.click('.statusbar button[title="About this build"]');
    await t.expect(() => t.dialog("About DesignTree"), "the About page");
  }),

  // Dialogs.
  e("settings-theme", "field", "Settings", "The theme setting changes the window's colours and is kept", async (t) => {
    await openSettings(t);
    await choose(t, '[aria-label="Settings"] select[aria-label="Theme"]', "dark");
    await t.expect(() => t.js("return document.documentElement.dataset.theme === 'dark'"), "the dark theme");
  }),
  e("settings-search", "field", "Settings", "Searching the settings", async (t) => {
    await openSettings(t);
    await t.type('[aria-label="Search settings"]', "dtc");
    await t.expect(
      () => t.js("const s = [...document.querySelectorAll('.settings-list .setting')]; return s.length >= 1 && s.length < 5 && s.some((x) => x.textContent.includes('dtc program'))"),
      "only the dtc settings",
    );
  }),
  e("about-copy", "button", "About", "About's Copy puts the build facts on the clipboard", async (t) => {
    await t.menu("Help", "About DesignTree");
    const index = await t.js("return [...document.querySelectorAll('.about .modal-actions button')].findIndex((b) => b.textContent === 'Copy')");
    const buttons = await t.session.find(".about .modal-actions button");
    await t.session.click(buttons[index]);
    await t.expect(() => t.js("return [...document.querySelectorAll('.about .modal-actions button')].some((b) => b.textContent === 'Copied')"), "Copied");
    // Reading the clipboard back needs a permission WebKitGTK does not give
    // a page, so the check stops at the button's answer.
  }),
  e("dialog-escape", "dialog", "window", "Escape closes the palette, the shortcut sheet and About", async (t) => {
    for (const [command, label] of [
      [["View", "Command palette…"], "Command palette"],
      [["Help", "Keyboard shortcuts"], "Keyboard shortcuts"],
      [["Help", "About DesignTree"], "About DesignTree"],
    ]) {
      await t.menu(...command);
      await t.expect(() => t.dialog(label), label);
      await t.press("Escape");
      await t.expect(async () => !(await t.dialog(label)), `${label} closed`);
    }
  }),
  e("update-notice", "dialog", "window", "The update notice's close button", async (t) => {
    await t.menu("Help", "Check for updates now");
    await t.expect(() => t.visible(".update-notice"), "the notice", 15000);
    await t.click(".update-notice .update-close");
    await t.expect(async () => !(await t.visible(".update-notice")), "the notice closed");
  }),

  e("settings-editor-mode", "field", "Settings", "Mode of new tabs sets the mode a new tab opens in", async (t) => {
    await openSettings(t);
    await t.type('[aria-label="Search settings"]', "mode of new tabs");
    await choose(t, '[aria-label="Settings"] select[aria-label="Mode of new tabs"]', "dts");
    await t.press("Escape");
    await t.click(".tab-new");
    await t.expect(async () => !(await t.visible(".editor:not([hidden]) .graph")) && (await t.visible(".editor:not([hidden]) .source-pane")), "the new tab in DTS mode");
  }),
  e("settings-shortcut", "field", "Settings", "Pressing a new combination on a shortcut rebinds the command", async (t) => {
    await openSettings(t);
    await t.type('[aria-label="Search settings"]', "Board view");
    await t.click('[aria-label^="Shortcut of Board view"]');
    await t.press("Ctrl+Shift+B");
    await t.expect(async () => (await t.command("board")).shortcut === "Ctrl+Shift+B", "Board view on Ctrl+Shift+B");
    await t.press("Escape");
    await t.expect(async () => !(await t.dialog("Settings")), "the settings closed");
    await t.press("Ctrl+Shift+B");
    await t.expect(() => t.visible(".board-canvas"), "the board view from the new shortcut");
  }),
  e("settings-updates", "field", "Settings", "The update check setting is kept", async (t) => {
    await openSettings(t);
    await t.type('[aria-label="Search settings"]', "updates");
    await t.click('.settings-list input[type="checkbox"]');
    await t.expect(() => readFileSync(join(t.work, "config", "io.github.maurilan91.designtree", "settings.json"), "utf8").includes('"updates": true'), "updates on in the settings file");
  }),
  e("settings-kernels", "field", "Settings", "The kernel checkouts list shows the checkout in use", async (t) => {
    await t.menu("Tools", "Kernel checkouts…");
    await t.expect(() => t.js("return document.querySelector('[role=dialog][aria-label=\"Settings\"]')?.textContent.includes('fixtures/linux')"), "the fixture checkout listed");
  }),
  e("soc-picker", "dialog", "File", "The SoC picker lists the SoC .dtsi files or says there are none, and closes", async (t) => {
    await t.menu("File", "New board from SoC…");
    await t.expect(() => t.dialog("New board from a SoC"), "the picker");
    await t.expect(() => t.js("return (document.querySelector('[aria-label=\"New board from a SoC\"]')?.textContent ?? '').length > 30"), "its answer");
    await t.press("Escape");
    await t.expect(async () => !(await t.dialog("New board from a SoC")), "the picker closed");
  }),
  e("panel-rows", "button", "bottom panel", "Rows of the interrupt tree and the address map show their node", async (t) => {
    await t.menu("View", "Interrupt tree");
    await t.expect(() => t.visible(".irq-tree .link"), "the interrupt tree");
    const irq = await t.js("return [...document.querySelectorAll('.irq-tree .link')].findIndex((l) => l.textContent.includes('serial@2000'))");
    await t.session.click((await t.session.find(".irq-tree .link"))[irq]);
    await t.expect(async () => (await t.selected()).includes("/soc/serial@2000"), "serial@2000 shown");
    await t.menu("View", "Address map");
    await t.expect(() => t.visible(".address-map summary"), "the address map");
    // Each bus is folded: open the root's to reach the memory row.
    await t.click(".address-map summary");
    const mem = await t.js("return [...document.querySelectorAll('.address-map .link')].findIndex((l) => l.textContent.includes('memory'))");
    await t.session.click((await t.session.find(".address-map .link"))[mem]);
    await t.expect(async () => (await t.selected()).includes("/memory@80000000"), "the memory node shown");
  }),
  e("build-panel", "panel", "bottom panel", "The Build tab shows dtc's result", async (t) => {
    await t.menu("Tools", "Build .dtb");
    await t.expect(() => t.js("return /dtb|written|built|dtc/i.test(document.querySelector('.build')?.textContent ?? '')"), "dtc's answer in the Build tab", 15000);
  }),

  // Board view.
  e("board-place", "pointer", "board view", "Dragging a device onto the board places it", async (t) => {
    await t.menu("View", "Board view");
    await t.expect(() => t.visible(".board-canvas"), "the board view");
    if (!(await dragAndDrop(t, ".board-devices li[draggable=true]", ".board-canvas"))) throw new Failure("nothing to place");
    await t.expect(async () => (await t.design()).nodes.some((n) => n.board_position), "a node with a board position (events made in the page)");
  }),
  e("board-connector", "button", "board view", "Add a connector to the board", async (t) => {
    await t.menu("View", "Board view");
    await t.expect(() => t.visible(".board-canvas"), "the board view");
    const add = await t.js("return [...document.querySelectorAll('.board-devices button')].findIndex((b) => b.textContent === 'Add')");
    if (add < 0) throw new Failure("no Add button");
    await t.session.click((await t.session.find(".board-devices button"))[add]);
    await t.expect(async () => ((await t.design()).board?.connectors?.length ?? 0) === 1, "a connector in the design");
  }),
];
