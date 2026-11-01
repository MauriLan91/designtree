// G5 benchmark of the canvas (US-11.1): opens a generated board in the
// built front end, in Chromium, and measures how long until every node is
// on screen and the frame rate while panning and zooming.
//
//   node bench/g5.mjs <design.json> [--out g5-canvas.json]
//
// Run `npm run build` first. Needs the `playwright` package; set
// CHROMIUM_PATH to use a browser other than Playwright's own.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const designPath = args.find((a) => !a.startsWith("--"));
const outIndex = args.indexOf("--out");
const out = outIndex >= 0 ? args[outIndex + 1] : null;
if (!designPath) {
  console.error("usage: node bench/g5.mjs <design.json> [--out file.json]");
  process.exit(2);
}

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const design = await readFile(designPath);
const nodeCount = JSON.parse(design).nodes.length;

// The built app and the design, from one origin.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/g5.json") {
    res.writeHead(200, { "content-type": types[".json"] }).end(design);
    return;
  }
  const file = join(dist, normalize(path === "/" ? "/index.html" : path));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
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
  await page.goto(`${origin}/?design=/g5.json`);
  // Time from navigation until every node is rendered and measured.
  await page.waitForFunction(
    (n) => document.querySelectorAll(".react-flow__node:not([style*='visibility: hidden'])").length >= n,
    nodeCount,
    { timeout: 60_000, polling: "raf" },
  );
  const openMs = await page.evaluate(() => performance.now());

  const pane = await page.locator(".react-flow__pane").boundingBox();
  const centre = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };

  // Where the main thread's time goes: script, style and layout, as
  // Chromium counts them, against the frame rate.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  /** Frames the page draws while `act` runs for `ms` milliseconds. */
  const frames = async (ms, act) => {
    const before = await metrics();
    const stats = page.evaluate((ms) => new Promise((resolve) => {
      const times = [];
      const start = performance.now();
      const tick = (t) => {
        times.push(t);
        if (t - start < ms) requestAnimationFrame(tick);
        else {
          const gaps = times.slice(1).map((t, i) => t - times[i]);
          resolve({ fps: (times.length - 1) / ((times.at(-1) - times[0]) / 1000), worstFrameMs: Math.max(...gaps) });
        }
      };
      requestAnimationFrame(tick);
    }), ms);
    const end = Date.now() + ms;
    for (let i = 0; Date.now() < end; i++) await act(i);
    const result = await stats;
    const after = await metrics();
    const share = (name) => Math.round((100 * (after[name] - before[name])) / (ms / 1000));
    return { ...result, scriptPct: share("ScriptDuration"), stylePct: share("RecalcStyleDuration"), layoutPct: share("LayoutDuration") };
  };

  // Pan: drag from the pane's margin, which fitView leaves empty, in circles.
  const panOnce = async () => {
    await page.mouse.move(pane.x + 4, pane.y + 4);
    await page.mouse.down();
    const stats = await frames(3000, (i) =>
      page.mouse.move(pane.x + 4 + 200 * Math.sin(i / 10), pane.y + 4 + 200 * (1 - Math.cos(i / 10))),
    );
    await page.mouse.up();
    return stats;
  };
  // Zoom in and out around the centre, ending where it started.
  const zoomOnce = async () => {
    await page.mouse.move(centre.x, centre.y);
    return frames(3000, (i) => page.mouse.wheel(0, i % 40 < 20 ? -60 : 60));
  };
  // Software rasterization on machines without a GPU, such as CI runners,
  // sometimes stalls for a whole round: the median of three rounds is
  // what is reported.
  const median = (rounds) => [...rounds].sort((a, b) => a.fps - b.fps)[1];
  const pans = [];
  const zooms = [];
  for (let round = 0; round < 3; round++) {
    pans.push(await panOnce());
    zooms.push(await zoomOnce());
  }
  const pan = median(pans);
  const zoom = median(zooms);

  // Typing in the inspector: the time from a keystroke in a node's name
  // until the next frame, median of 15 keystrokes (US-11.2). The fields
  // commit once typing pauses, so this is what typing feels like.
  await page.locator(".react-flow__node-dt").nth(Math.floor(nodeCount / 2)).evaluate((e) => e.click());
  const nameField = page.locator(".inspector input").first();
  await nameField.click();
  await page.keyboard.press("End");
  const keystrokes = [];
  for (const key of "abcdefghijklmno") {
    const start = Date.now();
    await page.keyboard.type(key);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))));
    keystrokes.push(Date.now() - start);
  }
  keystrokes.sort((a, b) => a - b);
  const typeMs = keystrokes[Math.floor(keystrokes.length / 2)];

  // The edit itself, once typing pauses: the longest main-thread task in
  // the second after one keystroke (0 when none reaches Chromium's 50 ms
  // long-task floor), median of three edits.
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver((list) => window.__longTasks.push(...list.getEntries().map((e) => e.duration))).observe({
      type: "longtask",
    });
  });
  const commits = [];
  for (const key of "xyz") {
    await page.evaluate(() => (window.__longTasks = []));
    await page.keyboard.type(key);
    await page.waitForTimeout(1000);
    commits.push(await page.evaluate(() => Math.max(0, ...window.__longTasks)));
  }
  commits.sort((a, b) => a - b);
  const commitMs = Math.round(commits[1]);

  const round = (x) => Math.round(x * 10) / 10;
  const report = {
    nodes: nodeCount,
    open_ms: Math.round(openMs),
    pan_fps: round(pan.fps),
    pan_worst_frame_ms: round(pan.worstFrameMs),
    pan_main_thread_pct: { script: pan.scriptPct, style: pan.stylePct, layout: pan.layoutPct },
    zoom_fps: round(zoom.fps),
    zoom_worst_frame_ms: round(zoom.worstFrameMs),
    zoom_main_thread_pct: { script: zoom.scriptPct, style: zoom.stylePct, layout: zoom.layoutPct },
    type_ms: typeMs,
    edit_commit_ms: commitMs,
  };
  console.log(JSON.stringify(report, null, 2));
  if (out) await writeFile(out, JSON.stringify(report, null, 2) + "\n");
} finally {
  await browser.close();
  server.close();
}
