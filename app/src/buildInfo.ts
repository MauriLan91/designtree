// What this build is (US-13.5), filled in by vite.config.ts.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;

export const BUILD = {
  version: __APP_VERSION__,
  /** Empty when built outside a git checkout without DESIGNTREE_COMMIT. */
  commit: __APP_COMMIT__,
  /** The build date, YYYY-MM-DD. */
  built: __APP_BUILT__,
};

export const LINKS = {
  guide: "https://maurilan91.github.io/designtree/guide/",
  repository: "https://github.com/MauriLan91/designtree",
  issues: "https://github.com/MauriLan91/designtree/issues",
};

/** The build and its environment as plain text, for a bug report. */
export function aboutText(kernel: { path: string; version: string | null } | null, dtc: string | null | undefined): string {
  return [
    `DesignTree ${BUILD.version}${BUILD.commit ? ` (${BUILD.commit})` : ""}, built ${BUILD.built}`,
    `Kernel: ${kernel ? `Linux ${kernel.version ?? "(unknown version)"}` : "none loaded"}`,
    `dtc: ${dtc === undefined ? "unknown" : (dtc ?? "not found")}`,
    `Platform: ${navigator.userAgent}`,
  ].join("\n");
}
