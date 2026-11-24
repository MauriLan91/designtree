// Benchmark of the long lists (US-11.3): opens a generated board in the
// built front end, in Chromium, with thousands of schema problems on its
// nodes, and measures the Problems tab and the Outline: how long they take
// to show, how many rows they draw, and the frame rate while scrolling.
//
//   node bench/lists.mjs <design.json> [--problems 8000] [--out lists.json]
//
// Most problems are undocumented vendor properties, as on a vendor tree.
// Run `npm run build` first. Needs the `playwright` package; set
// CHROMIUM_PATH to use a browser other than Playwright's own.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const designPath = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const out = option("--out");
const problemCount = Number(option("--problems") ?? 8000);
if (!designPath) {
  console.error("usage: node bench/lists.mjs <design.json> [--problems N] [--out file.json]");
  process.exit(2);
}

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const design = await readFile(designPath);
const nodes = JSON.parse(design).nodes.filter((n) => n.kind === undefined || n.kind === "node");

// Three in four are vendor properties no binding documents; the rest fall
// under a few rules, as dt-schema's answers on a real board do.
const RULES = [
  ["clocks", (n) => `${n}: clocks: [[1, 2]] is too short`],
  ["reg", (n) => `${n}: reg: [[0, 4096], [4096, 4096]] is too long`],
  ["interrupts", (n) => `${n}: interrupts: 'interrupts-extended' is a dependency of 'interrupt-names'`],
  ["status", (n) => `${n}: status: 'okay' was expected`],
  ["pinctrl-0", (n) => `${n}: pinctrl-0: [[5]] is not of type 'string'`],
];
const problems = Array.from({ length: problemCount }, (_, i) => {
  const node = nodes[i % nodes.length].id;
  if (i % 4) {
    const property = `vendor,prop-${i % 97}`;
    return {
      severity: "warning",
      message: `${node}: ${property}: [00 00 00 0${i % 8}] is not of types "null", "boolean", "integer", "array", "object"`,
      node,
      property,
      rule: "dt-core.yaml",
    };
  }
  const [property, message] = RULES[(i / 4) % RULES.length];
  return { severity: i % 3 ? "error" : "warning", message: message(node), node, property, rule: `rule-${(i / 4) % RULES.length}.yaml` };
});
const problemsJson = JSON.stringify(problems);

// The built app, the design and its problems, from one origin.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/design.json") return res.writeHead(200, { "content-type": types[".json"] }).end(design);
  if (path === "/problems.json") return res.writeHead(200, { "content-type": types[".json"] }).end(problemsJson);
  const file = join(dist, normalize(path === "/" ? "/index.html" : path));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: (process.env.G5_CHROMIUM_ARGS ?? "").split(" ").filter(Boolean),
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${origin}/?design=/design.json&problems=/problems.json`);
  await page.locator("button[aria-label='Outline']").click();
  await page.locator(".navigator [role=tree] li").first().waitFor({ timeout: 60_000 });
  // The problems are in once the status bar counts them all.
  await page.waitForFunction(
    (n) => {
      const counts = document.querySelector(".statusbar button[title^='Show the problems']")?.getAttribute("aria-label") ?? "";
      return (counts.match(/\d+/g) ?? []).reduce((a, b) => a + Number(b), 0) >= n;
    },
    problemCount,
    { timeout: 60_000 },
  );

  /** Milliseconds from `act` until the frame after the one in which `ready` holds. */
  const timed = (act, ready) =>
    page.evaluate(
      ([act, ready]) =>
        new Promise((resolve) => {
          const start = performance.now();
          new Function(act)();
          // Resolved a frame after `ready`, so the frame that drew it counts.
          const done = () => requestAnimationFrame(() => resolve(performance.now() - start));
          const check = () => (new Function(`return ${ready}`)() ? done() : requestAnimationFrame(check));
          requestAnimationFrame(check);
        }),
      [act, ready],
    );
  /** Frames drawn while the list in `scroller` scrolls 3 rows a frame, for `ms`. */
  const scrolled = (scroller, ms) =>
    page.evaluate(
      ([scroller, ms]) =>
        new Promise((resolve) => {
          const el = document.querySelector(scroller);
          const times = [];
          const start = performance.now();
          const tick = (t) => {
            times.push(t);
            el.scrollTop = el.scrollTop + el.clientHeight >= el.scrollHeight - 1 ? 0 : el.scrollTop + 66;
            if (t - start < ms) requestAnimationFrame(tick);
            else {
              const gaps = times.slice(1).map((t, i) => t - times[i]);
              resolve({ fps: (times.length - 1) / ((times.at(-1) - times[0]) / 1000), worstFrameMs: Math.max(...gaps) });
            }
          };
          requestAnimationFrame(tick);
        }),
      [scroller, ms],
    );
  const count = (selector) => page.locator(selector).count();

  // The Problems tab, grouped by rule as it opens.
  const openMs = await timed(
    `document.querySelector(".statusbar button[title^='Show the problems']").click()`,
    `document.querySelector(".problem-items li")`,
  );
  // Every problem in one list: not grouped, with the vendor class opened.
  await page.locator("select[aria-label='Group the problems']").selectOption("none");
  // The vendor class comes last: scroll down to it.
  await page.evaluate(() => {
    const el = document.querySelector(".panel-body");
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);
  const expandMs = await timed(
    `document.querySelector(".problem-items .undocumented .group-head").click()`,
    `document.querySelectorAll(".problem-items li.problem").length > 0 && !document.querySelector(".problem-items .undocumented [aria-expanded=false]")`,
  );
  const problemRows = await count(".problem-items li");
  const problemScroll = await scrolled(".panel-body", 3000);

  // The Outline: a filter that every node with a vendor compatible
  // matches opens nearly the whole tree; then it is scrolled.
  const typeFilter = (text) => `{
    const f = document.querySelector(".navigator input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(f, ${JSON.stringify(text)});
    f.dispatchEvent(new Event("input", { bubbles: true }));
  }`;
  const filterMs = await timed(typeFilter(","), `document.querySelectorAll(".navigator [role=tree] li").length > 1`);
  await page.waitForTimeout(500);
  const outlineTotal = await page.evaluate(() => Math.round(document.querySelector(".navigator [role=tree]").getBoundingClientRect().height / 26));
  const outlineRows = await count(".navigator [role=tree] li");
  const outlineScroll = await scrolled(".outline-slot", 3000);
  const clearMs = await timed(typeFilter(""), "true");

  const round = (x) => Math.round(x * 10) / 10;
  const report = {
    nodes: nodes.length,
    problems: problemCount,
    problems_open_ms: Math.round(openMs),
    problems_expand_all_ms: Math.round(expandMs),
    problems_rows_drawn: problemRows,
    problems_scroll_fps: round(problemScroll.fps),
    problems_scroll_worst_frame_ms: round(problemScroll.worstFrameMs),
    outline_filter_ms: Math.round(filterMs),
    outline_clear_filter_ms: Math.round(clearMs),
    outline_rows: outlineTotal,
    outline_rows_drawn: outlineRows,
    outline_scroll_fps: round(outlineScroll.fps),
    outline_scroll_worst_frame_ms: round(outlineScroll.worstFrameMs),
  };
  console.log(JSON.stringify(report, null, 2));
  if (out) await writeFile(out, JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser.close();
  server.close();
}
