// Combines the backend and canvas timings of the G5 benchmark into one
// report, and prints it as a Markdown table next to the previous run on
// main, so the trend shows on every pull request (US-11.1).
//
//   node bench/g5-report.mjs <backend.json> <canvas.json> <out.json> [previous.json]
import { readFile, writeFile } from "node:fs/promises";

const [backendPath, canvasPath, outPath, previousPath] = process.argv.slice(2);
const backend = JSON.parse(await readFile(backendPath, "utf8"));
const canvas = JSON.parse(await readFile(canvasPath, "utf8"));
let previous = null;
try {
  previous = previousPath ? JSON.parse(await readFile(previousPath, "utf8")) : null;
} catch {
  // The first run, or the previous artifact has expired.
}

const report = { nodes: backend.nodes, backend_ms: backend.ms, canvas };
await writeFile(outPath, JSON.stringify(report, null, 2) + "\n");

// [label, value, previous value, unit, true when higher is better]
const rows = [
  ...Object.entries(backend.ms).map(([stage, ms]) => [`backend: ${stage}`, ms, previous?.backend_ms?.[stage], "ms", false]),
  ["canvas: open", canvas.open_ms, previous?.canvas?.open_ms, "ms", false],
  ["canvas: pan", canvas.pan_fps, previous?.canvas?.pan_fps, "fps", true],
  ["canvas: zoom", canvas.zoom_fps, previous?.canvas?.zoom_fps, "fps", true],
  ["canvas: keystroke in the inspector", canvas.type_ms, previous?.canvas?.type_ms, "ms", false],
  ["canvas: applying the edit (longest task)", canvas.edit_commit_ms, previous?.canvas?.edit_commit_ms, "ms", false],
];

const change = (value, before, higherIsBetter) => {
  if (typeof before !== "number" || before === 0) return "";
  const pct = Math.round((100 * (value - before)) / before);
  // Small changes are noise on shared runners.
  if (Math.abs(pct) < 10) return `${pct > 0 ? "+" : ""}${pct}%`;
  const better = higherIsBetter ? pct > 0 : pct < 0;
  return `${pct > 0 ? "+" : ""}${pct}% ${better ? "🟢" : "🔴"}`;
};

const lines = [
  `### G5 benchmark (${backend.nodes} generated nodes)`,
  "",
  "| Measure | This run | Previous on main | Change |",
  "| --- | ---: | ---: | ---: |",
  ...rows.map(([label, value, before, unit, higher]) =>
    `| ${label} | ${value} ${unit} | ${typeof before === "number" ? `${before} ${unit}` : "–"} | ${change(value, before, higher)} |`),
  "",
  "G5 targets on a mid-range laptop: open < 2000 ms, pan and zoom ≥ 50 fps; an edit under 50 ms (US-11.2).",
  "CI runners have no GPU, so the canvas numbers are for the trend, not the target.",
];
console.log(lines.join("\n"));
