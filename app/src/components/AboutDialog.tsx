// Help › About (US-13.5): which build this is and what it runs with, to
// quote in a bug report.
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import type { Kernel } from "../App";
import { inTauri } from "../backend";
import { aboutText, BUILD, LINKS } from "../buildInfo";

interface Props {
  kernel: Kernel | null;
  /** undefined while unknown (or outside the app), null when dtc cannot be run. */
  dtcVersion: string | null | undefined;
  onClose: () => void;
}

/** Opens a link in the browser: the system's in the app, a new tab outside it. */
function open(url: string) {
  if (inTauri) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}

export function AboutDialog({ kernel, dtcVersion, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const copy = () =>
    navigator.clipboard.writeText(aboutText(kernel, dtcVersion)).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about" role="dialog" aria-label="About DesignTree" onClick={(e) => e.stopPropagation()}>
        <h2>About DesignTree</h2>
        <p className="hint">A graphical editor for Linux devicetrees.</p>
        <dl className="about-facts">
          <dt>Version</dt>
          <dd>{BUILD.version}</dd>
          <dt>Commit</dt>
          <dd>{BUILD.commit ? <code>{BUILD.commit}</code> : "unknown"}</dd>
          <dt>Built</dt>
          <dd>{BUILD.built}</dd>
          <dt>Kernel</dt>
          <dd>{kernel ? `Linux ${kernel.version ?? "(unknown version)"}` : "None loaded"}</dd>
          <dt>dtc</dt>
          <dd>{dtcVersion === undefined ? "Unknown" : (dtcVersion ?? "Not found")}</dd>
          <dt>Licence</dt>
          <dd>MIT</dd>
        </dl>
        <p className="about-links">
          <button className="link" onClick={() => open(LINKS.guide)}>
            User guide
          </button>
          <button className="link" onClick={() => open(LINKS.repository)}>
            Source code
          </button>
          <button className="link" onClick={() => open(LINKS.issues)}>
            Report a bug
          </button>
        </p>
        <div className="modal-actions">
          <button onClick={copy} title="Copy the version, kernel, dtc and platform, for a bug report">
            {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
