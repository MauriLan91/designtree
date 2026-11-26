// Starts the app under tauri-driver and gives the tests a few words to
// drive it with: menus, shortcuts, the palette, the canvas and the design.
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Session } from "./webdriver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "fixtures");
const IDENTIFIER = "io.github.maurilan91.designtree";
const DRIVER = "http://127.0.0.1:4444";

export class Failure extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts tauri-driver and the app; `close()` stops both. */
export async function launch({ app, driver = "tauri-driver" }) {
  const work = mkdtempSync(join(tmpdir(), "designtree-e2e-"));
  const env = {
    ...process.env,
    // A home of its own: settings, kernel list and caches start empty.
    XDG_CONFIG_HOME: join(work, "config"),
    XDG_CACHE_HOME: join(work, "cache"),
    XDG_DATA_HOME: join(work, "data"),
    DESIGNTREE_LINUX_SRC: join(FIXTURES, "linux"),
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  };
  const child = spawn(driver, [], { env, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  child.stderr.on("data", (d) => (log = (log + d).slice(-20000)));
  for (let i = 0; ; i++) {
    try {
      await fetch(`${DRIVER}/status`);
      break;
    } catch {
      if (i > 50) throw new Error(`tauri-driver did not start:\n${log}`);
      await sleep(200);
    }
  }
  const t = new App(work, null);
  t.seed();
  t.session = await Session.start(DRIVER, {
    "tauri:options": { application: resolve(app), args: [t.designPath] },
  });
  t.close = async () => {
    await t.session.quit().catch(() => {});
    child.kill();
    rmSync(work, { recursive: true, force: true });
  };
  await t.ready();
  return t;
}

export class App {
  constructor(work, session) {
    this.work = work;
    this.session = session;
    this.designPath = join(work, "design.json");
    this.files = join(work, "files");
  }

  /** Puts the starting design and settings in place. */
  seed() {
    const config = join(this.work, "config", IDENTIFIER);
    mkdirSync(config, { recursive: true });
    // No update check on start: it would ask the network.
    writeFileSync(join(config, "settings.json"), JSON.stringify({ updates: false }));
    copyFileSync(join(FIXTURES, "board.json"), this.designPath);
    rmSync(this.files, { recursive: true, force: true });
    mkdirSync(this.files, { recursive: true });
  }

  /** A path in the test's scratch folder. */
  file(name) {
    return join(this.files, name);
  }

  /** Back to the starting design, settings and layout. */
  async reset() {
    this.seed();
    // Same size every time: cards sit where the tests expect them.
    await this.session.call("POST", "/window/rect", { x: 0, y: 0, width: 1400, height: 900 }).catch(() => {});
    await this.session.run("localStorage.clear(); location.reload();");
    await sleep(300);
    await this.ready();
  }

  async ready() {
    await this.waitFor(
      () => this.js("return !!window.__designtree && (window.__designtree.design()?.nodes.length ?? 0) > 0 && document.querySelectorAll('.react-flow__node').length > 0"),
      "the app to load the design",
      20000,
    );
    // The first show arranges the scope; let it settle.
    await sleep(500);
  }

  js(body, ...args) {
    return this.session.run(body, ...args);
  }

  /** Polls `fn` until it returns a truthy value. */
  async waitFor(fn, what, timeout = 5000) {
    const end = Date.now() + timeout;
    let last;
    for (;;) {
      try {
        last = await fn();
        if (last) return last;
      } catch (e) {
        last = e;
      }
      if (Date.now() > end) throw new Failure(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
      await sleep(100);
    }
  }

  async expect(fn, what, timeout) {
    return this.waitFor(fn, what, timeout);
  }

  // --- The app's state, read through the E2E hook. ---

  design() {
    return this.js("return window.__designtree.design()");
  }

  commands() {
    return this.js("return window.__designtree.commands()");
  }

  command(id) {
    return this.js("return window.__designtree.commands().find((c) => c.id === arguments[0])", id);
  }

  scope() {
    return this.js("return window.__designtree.scope()");
  }

  /** Answers the next file dialogs with these paths. */
  answer(...paths) {
    return this.js("window.__designtree.answer(...arguments)", ...paths);
  }

  // --- Looking at the window. ---

  count(css) {
    return this.js("return document.querySelectorAll(arguments[0]).length", css);
  }

  text(css) {
    return this.js("const e = document.querySelector(arguments[0]); return e ? e.textContent : null", css);
  }

  /** Whether the element is on show: present and not inside a hidden ancestor. */
  visible(css) {
    return this.js(
      "const e = document.querySelector(arguments[0]); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]')",
      css,
    );
  }

  dialog(label) {
    return this.visible(`[role="dialog"][aria-label="${label}"]`);
  }

  /** The DTS text in the source pane. */
  dts() {
    return this.js("return [...document.querySelectorAll('.source-pane .cm-line')].map((l) => l.textContent).join('\\n')");
  }

  layout() {
    return this.js("return JSON.parse(localStorage.getItem('designtree.layout') || 'null')");
  }

  /** Canvas cards by node id (React Flow's `data-id`). */
  card(id) {
    return `.editor:not([hidden]) .react-flow__node[data-id="${id.replace(/"/g, '\\"')}"]`;
  }

  async rect(css) {
    return this.js("const e = document.querySelector(arguments[0]); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }", css);
  }

  async selected() {
    return this.js("return [...document.querySelectorAll('.editor:not([hidden]) .react-flow__node.selected')].map((n) => n.dataset.id)");
  }

  // --- Acting. ---

  async click(css) {
    const [e] = await this.session.find(css);
    if (!e) throw new Failure(`nothing matches ${css}`);
    await this.session.click(e);
  }

  async clickWith(css, modifiers, double = false) {
    const [e] = await this.session.find(css);
    if (!e) throw new Failure(`nothing matches ${css}`);
    await this.session.clickWith(e, modifiers, double);
  }

  async doubleClick(css) {
    return this.clickWith(css, [], true);
  }

  /** Types into a field; `replace` selects what it holds first, as a user
   * would (WebDriver's clear does not reach React's state). */
  async type(css, text, { replace = false } = {}) {
    const [e] = await this.session.find(css);
    if (!e) throw new Failure(`nothing matches ${css}`);
    if (replace) {
      await this.session.click(e);
      await this.press("Ctrl+A");
    }
    await this.session.type(e, text);
  }

  press(combo) {
    return this.session.press(combo);
  }

  async drag(css, dx, dy) {
    const [e] = await this.session.find(css);
    if (!e) throw new Failure(`nothing matches ${css}`);
    await this.session.drag(e, dx, dy);
  }

  /** Selects these nodes on the canvas: a click, then Ctrl+clicks. */
  async select(...ids) {
    for (const [i, id] of ids.entries()) await this.clickWith(this.card(id), i ? ["Ctrl"] : []);
    await this.waitFor(async () => (await this.selected()).length === ids.length, `${ids.length} selected nodes`);
  }

  /** Opens `menu` in the menu bar and clicks the item titled `title`. */
  async menu(menu, title) {
    const opened = await this.js(
      `const m = [...document.querySelectorAll('.editor:not([hidden]) .menubar .menu > [aria-haspopup="menu"]')].find((b) => b.textContent.trim() === arguments[0]);
       if (!m) return false; if (m.getAttribute('aria-expanded') !== 'true') m.click(); return true;`,
      menu,
    );
    if (!opened) throw new Failure(`no menu ${menu}`);
    await this.waitFor(() => this.visible(`.editor:not([hidden]) .menu-popup[aria-label="${menu}"] .menu-item`), `the ${menu} menu`);
    const index = await this.js(
      `return [...document.querySelectorAll('.editor:not([hidden]) .menu-popup[aria-label="' + arguments[0] + '"] .menu-item')].findIndex((i) => i.querySelector('.menu-title').textContent === arguments[1])`,
      menu,
      title,
    );
    if (index < 0) throw new Failure(`no item "${title}" in ${menu}`);
    const items = await this.session.find(`.editor:not([hidden]) .menu-popup[aria-label="${menu}"] .menu-item`);
    await this.session.click(items[index]);
  }

  /** Runs a command from the command palette by its title. */
  async palette(title) {
    await this.click(".command-search");
    await this.waitFor(() => this.dialog("Command palette"), "the command palette");
    await this.type('.command-palette input[aria-label="Command"]', title);
    await this.pick(title);
  }

  /** Picks the palette entry titled `title`. */
  async pick(title) {
    const index = await this.waitFor(
      () =>
        this.js(
          // Exact first, else the first that contains it (nodes show their label too).
          "const o = [...document.querySelectorAll('.command-palette [role=option]')].map((o) => o.firstElementChild?.textContent ?? ''); let i = o.indexOf(arguments[0]); if (i < 0) i = o.findIndex((x) => x.includes(arguments[0])); return i >= 0 ? i + 1 : 0",
          title,
        ),
      `"${title}" in the palette`,
    );
    const options = await this.session.find(".command-palette [role=option]");
    await this.session.click(options[index - 1]);
  }

  /** The toolbar button of a command, by its title. */
  async toolbarButton(title) {
    const label = title.replace(/…$/, "");
    const css = `.editor:not([hidden]) .toolbar-row button[aria-label="${label}"]`;
    return (await this.count(css)) ? css : null;
  }

  screenshot() {
    return this.session.screenshot();
  }
}
