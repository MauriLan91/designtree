/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// What the About page reports (US-13.5). Packages build from a tarball
// without .git, so the commit can come from the environment, and
// SOURCE_DATE_EPOCH keeps reproducible builds reproducible.
const version: string = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")).version;
function commit(): string {
  if (process.env.DESIGNTREE_COMMIT) return process.env.DESIGNTREE_COMMIT;
  try {
    return execFileSync("git", ["rev-parse", "--short=10", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
const epoch = Number(process.env.SOURCE_DATE_EPOCH);
const built = (Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : new Date()).toISOString().slice(0, 10);

// Tauri expects a fixed port and must not have the terminal cleared.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022" },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(built),
  },
});
