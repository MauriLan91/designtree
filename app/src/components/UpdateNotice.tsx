import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { backend } from "../backend";
import { skipVersion, type Update } from "../updates";

type InstallKind = Awaited<ReturnType<typeof backend.installKind>>;

const HOW: Record<InstallKind, string> = {
  pacman: "Update it with your AUR helper, or rebuild the PKGBUILD from the release.",
  deb: "Install the new .deb from the release page.",
  appimage: "Download the new AppImage from the release page.",
  other: "Get it from the release page.",
};

interface Props {
  /** The newer release; null after a check by hand that found none. */
  update: Update | null;
  /** Why a check by hand failed. */
  error?: string;
  onClose: () => void;
  /** Turns the daily check off in the settings. */
  onTurnOff: () => void;
}

/** A floating bar: a newer release exists, and how to get it. */
export function UpdateNotice({ update, error, onClose, onTurnOff }: Props) {
  const [kind, setKind] = useState<InstallKind>("other");
  useEffect(() => {
    backend.installKind().then(setKind, () => setKind("other"));
  }, []);
  if (!update) {
    return (
      <div className="update-notice" role="status">
        <span>{error ? `Could not check for updates: ${error}` : "DesignTree is up to date."}</span>
        <button className="update-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
    );
  }
  return (
    <div className="update-notice" role="status">
      <span>
        DesignTree {update.version} is available. {HOW[kind]}
      </span>
      <button onClick={() => openUrl(update.url)}>Release notes</button>
      <button
        onClick={() => {
          skipVersion(update.version);
          onClose();
        }}
      >
        Skip this version
      </button>
      <button
        onClick={() => {
          onTurnOff();
          onClose();
        }}
        title="Turn back on in Settings › Updates"
      >
        Don't check
      </button>
      <button className="update-close" onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}
