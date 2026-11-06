// Update notice (US-12.2): at most once a day, ask GitHub for the latest
// published release and compare it with this build. Nothing else is sent,
// and the check can be turned off from the notice or the command palette.
// Updating itself is left to the package manager (or a new AppImage).
import { getVersion } from "@tauri-apps/api/app";
import { inTauri } from "./backend";

const LATEST = "https://api.github.com/repos/MauriLan91/designtree/releases/latest";
// Only this repository's release pages are opened from the notice.
const RELEASES = "https://github.com/MauriLan91/designtree/releases/";
const OFF_KEY = "designtree.updates.off";
const LAST_KEY = "designtree.updates.last";
const SKIP_KEY = "designtree.updates.skip";
const DAY = 24 * 60 * 60 * 1000;

export interface Update {
  version: string;
  url: string;
}

interface LastCheck {
  at: number;
  latest: Update | null;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the notice then just shows again.
  }
}

export const updateChecksOn = () => read<boolean>(OFF_KEY) !== true;
export const setUpdateChecks = (on: boolean) => write(OFF_KEY, on ? null : true);
export const skipVersion = (version: string) => write(SKIP_KEY, version);

/** `1.2.10` > `1.2.9`; a pre-release sorts before its release. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (x.pre === null) return true;
  if (y.pre === null) return false;
  return x.pre > y.pre;
}

async function latestRelease(force: boolean): Promise<Update | null> {
  const last = read<LastCheck>(LAST_KEY);
  if (!force && last && Date.now() - last.at < DAY) return last.latest;
  const response = await fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } });
  // 404: no release published yet.
  if (!response.ok && response.status !== 404) throw new Error(`GitHub answered ${response.status}`);
  const body = response.ok ? await response.json() : null;
  const latest: Update | null =
    body && typeof body.tag_name === "string" && typeof body.html_url === "string" && body.html_url.startsWith(RELEASES)
      ? { version: body.tag_name.replace(/^v/, ""), url: body.html_url }
      : null;
  write(LAST_KEY, { at: Date.now(), latest } satisfies LastCheck);
  return latest;
}

/**
 * The newer release to tell the user about, if any. `force` skips the daily
 * limit and a skipped version (the palette's "Check for updates now").
 */
export async function checkForUpdate(force = false): Promise<Update | null> {
  if (!inTauri || (!force && !updateChecksOn())) return null;
  const [current, latest] = await Promise.all([getVersion(), latestRelease(force)]);
  if (!latest || !newer(latest.version, current)) return null;
  if (!force && read<string>(SKIP_KEY) === latest.version) return null;
  return latest;
}
