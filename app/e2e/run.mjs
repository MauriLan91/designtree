#!/usr/bin/env node
// The end-to-end suite (US-4.5): drives the real app through tauri-driver
// and checks every UI element by what it does.
//
//   node e2e/run.mjs --app <designtree-app> [--report <dir>] [--only <id,...>]
//
// The app must be an E2E release build (`VITE_E2E=1 npx tauri build
// --no-bundle`): a debug build opens the web inspector on Ctrl+Shift+I, the
// shortcut of the Inspector pane, and the docked inspector shrinks the page.
// The inventory of elements comes from the command registry, which the app
// reports, and from the hand-written list in elements.mjs; every command
// runs through each way in it has (menu or palette, shortcut, toolbar). A
// command without a test fails the suite, as does a test for a command that
// no longer exists.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { COMMANDS } from "./commands.mjs";
import { ELEMENTS } from "./elements.mjs";
import { Failure, launch } from "./harness.mjs";
import { KNOWN } from "./known.mjs";

const { values: args } = parseArgs({
  options: {
    app: { type: "string", default: "../target/release/designtree-app" },
    driver: { type: "string", default: "tauri-driver" },
    report: { type: "string", default: "e2e/report" },
    only: { type: "string" },
  },
});
const only = args.only ? new Set(args.only.split(",")) : null;

/** The ways into a command, each a function that uses it once. */
async function waysInto(t, command) {
  const ways = [];
  if (command.menu) ways.push(["menu", () => t.menu(command.menu, command.title)]);
  else ways.push(["palette", () => t.palette(command.title)]);
  if (command.shortcut) ways.push(["shortcut", () => t.press(command.shortcut)]);
  if (command.toolbar) {
    const css = await t.toolbarButton(command.title);
    if (css) ways.push(["toolbar", () => t.click(css)]);
    else if (command.menu === "Arrange")
      ways.push([
        "toolbar",
        async () => {
          await t.click(".arrange-button");
          await t.waitFor(() => t.visible(".arrange-menu .menu-popup"), "the Arrange menu");
          const index = await t.js(
            "return [...document.querySelectorAll('.arrange-menu .menu-item')].findIndex((i) => i.querySelector('.menu-title').textContent === arguments[0])",
            command.title,
          );
          if (index < 0) throw new Failure(`no "${command.title}" in the Arrange menu`);
          const items = await t.session.find(".arrange-menu .menu-item");
          await t.session.click(items[index]);
        },
      ]);
  }
  if (command.id === "build") ways.push(["toolbar", () => t.click(".tool-primary")]);
  if (command.id === "palette") ways.push(["toolbar", () => t.click(".command-search")]);
  return ways;
}

const results = [];
const started = Date.now();
const t = await launch({ app: args.app, driver: args.driver });
const reportDir = resolve(args.report);
mkdirSync(reportDir, { recursive: true });

async function attempt(kind, id, way, body) {
  const at = Date.now();
  let error = null;
  try {
    await t.reset();
    // A page that shrinks under the window (a docked inspector, say) moves
    // every card; say so, since the failures it causes look unrelated.
    const size = await t.js("return [window.outerWidth, window.outerHeight, window.innerWidth, window.innerHeight, devicePixelRatio].join('x')");
    await body();
    const after = await t.js("return [window.outerWidth, window.outerHeight, window.innerWidth, window.innerHeight, devicePixelRatio].join('x')");
    if (after !== size || !size.startsWith("1400x900")) console.log(`note: ${id} (${way}) window ${size} -> ${after}`);
  } catch (e) {
    error = e instanceof Failure ? e.message : String(e?.stack ?? e);
    const shot = `${id}-${way}.png`.replace(/[^\w.-]/g, "_");
    await t
      .screenshot()
      .then((png) => writeFileSync(join(reportDir, shot), Buffer.from(png, "base64")))
      .catch(() => {});
  }
  // Known by `kind:id` for the whole element, or `kind:id:way` for one way in.
  const issue = KNOWN[`${kind}:${id}:${way}`] ?? KNOWN[`${kind}:${id}`];
  const result = { kind, id, way, ok: !error, error, ms: Date.now() - at };
  if (issue && error) Object.assign(result, { ok: true, known: issue });
  if (issue && !error) Object.assign(result, { ok: false, error: `passes now: remove it from known.mjs and close #${issue}` });
  results.push(result);
  const status = result.known ? "known" : result.ok ? "ok  " : "FAIL";
  console.log(`${status} ${kind} ${id} (${way})${result.error ? `: ${result.error.split("\n")[0]}` : ""}${result.known ? ` (#${result.known})` : ""}`);
}

let registry = [];
let otherShortcuts = [];
try {
  registry = await t.commands();
  otherShortcuts = await t.js("return window.__designtree.otherShortcuts()");
  for (const command of registry) {
    if (only && !only.has(command.id)) continue;
    const test = COMMANDS[command.id];
    if (!test) {
      results.push({ kind: "command", id: command.id, way: "-", ok: false, error: "no test for this command" });
      console.log(`FAIL command ${command.id}: no test`);
      continue;
    }
    for (const [way] of await waysInto(t, command)) {
      await attempt("command", command.id, way, async () => {
        // Titles can change with the state (Save / Save…), so look again.
        const now = (await t.commands()).find((c) => c.id === command.id);
        const use = (await waysInto(t, now)).find(([w]) => w === way)[1];
        t.run = use;
        await test(t);
      });
    }
  }
  for (const id of Object.keys(COMMANDS)) {
    if (!registry.some((c) => c.id === id)) {
      results.push({ kind: "command", id, way: "-", ok: false, error: "test for a command the registry no longer has" });
    }
  }
  for (const element of ELEMENTS) {
    if (only && !only.has(element.id)) continue;
    await attempt("element", element.id, element.kind, async () => {
      t.run = null;
      await element.test(t);
    });
  }
} finally {
  await t.close();
}

writeReport();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed (${results.filter((r) => r.known).length} known bugs), ${failed.length} failed in ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(failed.length ? 1 : 0);

function writeReport() {
  writeFileSync(join(reportDir, "results.json"), JSON.stringify({ registry, otherShortcuts, results }, null, 2));
  const mark = (r) => (r ? (r.known ? `known bug #${r.known}` : r.ok ? "pass" : "**fail**") : "–");
  const lines = [
    "# UI elements and their end-to-end tests",
    "",
    `Run ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC: ${results.filter((r) => r.ok && !r.known).length} passed, ${results.filter((r) => r.known).length} known bugs, ${results.filter((r) => !r.ok).length} failed.`,
    "",
    "## Commands (from the registry)",
    "",
    "Each command runs through every way in it has: its menu item (or the palette when it has no menu), its shortcut and its toolbar button.",
    "",
    "| Command | Menu | Shortcut | Menu or palette | Shortcut | Toolbar |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of registry) {
    const of = (way) => results.find((r) => r.kind === "command" && r.id === c.id && r.way === way);
    lines.push(
      `| ${c.title} (\`${c.id}\`) | ${c.menu ?? "–"} | ${c.shortcut ? `\`${c.shortcut}\`` : "–"} | ${mark(of("menu") ?? of("palette") ?? of("-"))} | ${c.shortcut ? mark(of("shortcut")) : "–"} | ${mark(of("toolbar"))} |`,
    );
  }
  lines.push("", "## Other elements (listed by hand in `e2e/elements.mjs`)", "", "| Element | Kind | Where | Result |", "| --- | --- | --- | --- |");
  for (const e of ELEMENTS) {
    const r = results.find((x) => x.kind === "element" && x.id === e.id);
    lines.push(`| ${e.title} (\`${e.id}\`) | ${e.kind} | ${e.where} | ${mark(r)} |`);
  }
  const failures = results.filter((r) => !r.ok || r.known);
  if (failures.length) {
    lines.push("", "## Failures", "");
    for (const f of failures) lines.push(`- \`${f.id}\` (${f.way})${f.known ? `, known bug #${f.known}` : ""}: ${f.error.split("\n")[0]}`);
  }
  writeFileSync(join(reportDir, "report.md"), lines.join("\n") + "\n");
}
