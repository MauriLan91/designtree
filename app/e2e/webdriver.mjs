// A small W3C WebDriver client over fetch, enough to drive the app through
// tauri-driver without a test framework's dependencies.

const KEYS = {
  Ctrl: "",
  Shift: "",
  Alt: "",
  Meta: "",
  Enter: "",
  Escape: "",
  Tab: "",
  Delete: "",
  Backspace: "",
  ArrowUp: "",
  ArrowDown: "",
  ArrowLeft: "",
  ArrowRight: "",
  Home: "",
  End: "",
  Space: " ",
  F1: "",
};
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

export class Session {
  constructor(base, id) {
    this.base = base;
    this.id = id;
  }

  static async start(base, capabilities) {
    const value = await request(base, "POST", "/session", { capabilities: { alwaysMatch: capabilities } });
    return new Session(base, value.sessionId);
  }

  call(method, path, body) {
    return request(this.base, method, `/session/${this.id}${path}`, body);
  }

  quit() {
    return this.call("DELETE", "");
  }

  /** Runs `script` (a function body) in the page; `arguments` holds `args`. */
  run(script, ...args) {
    return this.call("POST", "/execute/sync", { script, args });
  }

  /** Like `run`, for a body that returns a promise. */
  runAsync(script, ...args) {
    // The last argument of an async script is its callback.
    const body = `const done = arguments[arguments.length - 1];
      Promise.resolve((async () => { ${script} })(...Array.prototype.slice.call(arguments, 0, -1)))
        .then((v) => done({ ok: v }), (e) => done({ error: String(e && e.stack || e) }));`;
    return this.call("POST", "/execute/async", { script: body, args }).then((r) => {
      if (r && r.error) throw new Error(r.error);
      return r?.ok;
    });
  }

  async find(css) {
    const list = await this.call("POST", "/elements", { using: "css selector", value: css });
    return list.map((e) => e[ELEMENT]);
  }

  click(element) {
    return this.call("POST", `/element/${element}/click`, {});
  }

  type(element, text) {
    return this.call("POST", `/element/${element}/value`, { text });
  }

  clear(element) {
    return this.call("POST", `/element/${element}/clear`, {});
  }

  /**
   * Presses a combination such as `Ctrl+Shift+Z`, `F1` or `Ctrl+,`, with the
   * modifiers held down around the last key.
   */
  async press(combo) {
    const parts = combo === "+" ? ["+"] : combo.split(/\+(?!$)/);
    const keys = parts.map((p) => KEYS[p] ?? (p.length === 1 ? p.toLowerCase() : p));
    const down = keys.map((value) => ({ type: "keyDown", value }));
    const up = [...keys].reverse().map((value) => ({ type: "keyUp", value }));
    await this.call("POST", "/actions", { actions: [{ type: "key", id: "keyboard", actions: [...down, ...up] }] });
    await this.call("DELETE", "/actions");
  }

  /** Clicks the middle of `element` with `modifiers` held; `double` for a
   * double click. Key and pointer actions run in lockstep, so each pads
   * with pauses while the other acts. */
  async clickWith(element, modifiers = [], double = false) {
    const keys = modifiers.map((m) => KEYS[m]);
    const pointer = [
      { type: "pointerMove", duration: 0, origin: { [ELEMENT]: element }, x: 0, y: 0 },
      { type: "pointerDown", button: 0 },
      { type: "pointerUp", button: 0 },
      ...(double ? [{ type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] : []),
    ];
    const pause = { type: "pause" };
    const keyActions = [
      ...keys.map((value) => ({ type: "keyDown", value })),
      ...pointer.map(() => pause),
      ...keys.map((value) => ({ type: "keyUp", value })),
    ];
    const pointerActions = [...keys.map(() => pause), ...pointer, ...keys.map(() => pause)];
    await this.call("POST", "/actions", {
      actions: [
        { type: "key", id: "keyboard", actions: keyActions },
        { type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: pointerActions },
      ],
    });
    await this.call("DELETE", "/actions");
  }

  /** Drags `element` by (dx, dy) pixels. */
  async drag(element, dx, dy) {
    await this.call("POST", "/actions", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", duration: 0, origin: { [ELEMENT]: element }, x: 0, y: 0 },
            { type: "pointerDown", button: 0 },
            { type: "pointerMove", duration: 100, origin: "pointer", x: Math.round(dx / 2), y: Math.round(dy / 2) },
            { type: "pointerMove", duration: 100, origin: "pointer", x: dx - Math.round(dx / 2), y: dy - Math.round(dy / 2) },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    await this.call("DELETE", "/actions");
  }

  screenshot() {
    return this.call("GET", "/screenshot");
  }
}

async function request(base, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const v = json.value ?? {};
    throw new Error(`${method} ${path}: ${v.error ?? response.status} ${v.message ?? ""}`.trim());
  }
  return json.value;
}
