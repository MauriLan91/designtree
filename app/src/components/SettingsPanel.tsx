// Settings (US-15.5): one place for everything the user configures, laid
// out like VSCode's: sections on the left, a search that filters every
// setting by name, and changes that apply at once (there is no Save).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { backend, dialogs, inTauri } from "../backend";
import { RESERVED_SHORTCUTS, comboOf, shortcutClashes, type Command } from "../commands";
import type { EditorMode } from "../layout";
import { GRID_SIZES, isCombo, type Settings, type Theme } from "../settings";
import { KernelCheckouts } from "./KernelCheckouts";

export const SECTIONS = ["General", "Editor", "Kernel", "Build", "Shortcuts", "Updates"] as const;
export type Section = (typeof SECTIONS)[number];

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  saveError: string | null;
  section: Section;
  onClose: () => void;
  /** The registry with the user's overrides applied, and the ids that cannot be remapped. */
  commands: Command[];
  defaults: Map<string, string | undefined>;
  fixed: ReadonlySet<string>;
  kernelPath: string | null;
  onUseKernel: (path: string) => void;
  onResetLayout: () => void;
  onCheckUpdates: () => void;
}

interface Item {
  section: Section;
  key: string;
  title: string;
  /** Extra words the search matches, beyond the title and description. */
  words?: string;
  description?: string;
  control: ReactNode;
}

export function SettingsPanel(props: Props) {
  const { settings, onChange, commands, defaults, fixed } = props;
  const [section, setSection] = useState<Section>(props.section);
  const [query, setQuery] = useState("");
  const [capturing, setCapturing] = useState<string | null>(null);
  const [dtcVersion, setDtcVersion] = useState<string | null | undefined>(undefined);
  const [dtcError, setDtcError] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => setSection(props.section), [props.section]);
  useEffect(() => search.current?.focus(), []);
  useEffect(() => {
    if (inTauri) backend.dtcVersion().then(setDtcVersion, () => setDtcVersion(null));
  }, [settings.dtcPath]);

  // Escape closes, unless it is cancelling a shortcut being recorded.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && !capturing && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing, props.onClose]);

  const clashes = useMemo(() => shortcutClashes(commands), [commands]);
  const setShortcut = (id: string, combo: string | null) => {
    const next = { ...settings.shortcuts };
    // Back to the default: drop the override, so a later default change applies.
    if (combo === null || combo === (defaults.get(id) ?? "")) delete next[id];
    else next[id] = combo;
    onChange({ shortcuts: next });
  };
  const onCaptureKey = (id: string) => (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setCapturing(null);
    if (e.key === "Backspace" || e.key === "Delete") {
      setShortcut(id, "");
      return setCapturing(null);
    }
    const combo = comboOf(e.nativeEvent);
    if (combo && RESERVED_SHORTCUTS.has(combo)) return setRefused(`${combo} is taken by the clipboard, tabs or undo`);
    if (combo && isCombo(combo)) {
      setRefused(null);
      setShortcut(id, combo);
      setCapturing(null);
    }
  };

  const chooseDtc = async () => {
    const path = await dialogs.pickDtc();
    if (!path) return;
    try {
      await backend.setDtcPath(path);
      setDtcError(null);
      onChange({ dtcPath: path });
    } catch (e) {
      setDtcError(String(e));
    }
  };

  const select = <T extends string>(value: T, options: [T, string][], onPick: (v: T) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value as T)}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );

  const items: Item[] = [
    {
      section: "General",
      key: "theme",
      title: "Theme",
      words: "color dark light mode appearance",
      description: "System follows the desktop's light or dark setting.",
      control: select<Theme>(
        settings.theme,
        [
          ["system", "System"],
          ["light", "Light"],
          ["dark", "Dark"],
        ],
        (theme) => onChange({ theme }),
        "Theme",
      ),
    },
    {
      section: "Editor",
      key: "editor-mode",
      title: "Mode of new tabs",
      words: "graph split dts source view",
      description: "Switching a tab's mode also sets this.",
      control: select<EditorMode>(
        settings.editorMode,
        [
          ["graph", "Graph"],
          ["split", "Graph and DTS source"],
          ["dts", "DTS source"],
        ],
        (editorMode) => onChange({ editorMode }),
        "Mode of new tabs",
      ),
    },
    {
      section: "Editor",
      key: "snap",
      title: "Snap to grid",
      words: "grid align drag",
      description: "Nodes snap to the grid while you drag them; the canvas shows the grid. Also View › Snap to grid.",
      control: (
        <label className="check">
          <input type="checkbox" checked={settings.snapToGrid} onChange={(e) => onChange({ snapToGrid: e.target.checked })} />
          On
        </label>
      ),
    },
    {
      section: "Editor",
      key: "grid-size",
      title: "Grid size",
      words: "grid spacing snap",
      control: select<string>(
        String(settings.gridSize),
        GRID_SIZES.map((n) => [String(n), `${n} px`] as [string, string]),
        (size) => onChange({ gridSize: Number(size) }),
        "Grid size",
      ),
    },
    {
      section: "Editor",
      key: "layout",
      title: "Pane layout",
      words: "library inspector panel size reset",
      description: "Sizes and open panes are remembered; this puts them back as they were at first start.",
      control: <button onClick={props.onResetLayout}>Reset layout</button>,
    },
    {
      section: "Kernel",
      key: "kernels",
      title: "Kernel checkouts",
      words: "linux source tree bindings library",
      description: "The Linux trees the library can be built from. The design records the kernel version it was saved with.",
      control: inTauri ? (
        <KernelCheckouts active={props.kernelPath} onUse={props.onUseKernel} />
      ) : (
        <p className="hint">Needs the desktop app.</p>
      ),
    },
    {
      section: "Build",
      key: "dtc",
      title: "dtc program",
      words: "device tree compiler path",
      description: settings.dtcPath ?? "dtc from PATH",
      control: (
        <div className="setting-row">
          <span className={dtcVersion === null ? "error" : "hint"}>
            {dtcVersion === undefined ? "" : dtcVersion ? `Version ${dtcVersion}` : "Cannot be run"}
          </span>
          <button onClick={chooseDtc} disabled={!inTauri}>
            Choose…
          </button>
          <button
            disabled={!inTauri || settings.dtcPath === null}
            onClick={async () => {
              try {
                await backend.setDtcPath(null);
                setDtcError(null);
                onChange({ dtcPath: null });
              } catch (e) {
                setDtcError(String(e));
              }
            }}
          >
            Use PATH
          </button>
          {dtcError && <span className="error">{dtcError}</span>}
        </div>
      ),
    },
    ...commands.map(
      (c): Item => ({
        section: "Shortcuts",
        key: `shortcut:${c.id}`,
        title: c.title.replace(/…$/, ""),
        words: `shortcut key ${c.menu ?? ""}`,
        control: (
          <div className="setting-row">
            {clashes.has(c.shortcut ?? "") && (
              <span className="error" title="Another command has the same shortcut; only the first runs">
                Also used by {clashes.get(c.shortcut!)!.filter((id) => id !== c.id).length} other
              </span>
            )}
            {fixed.has(c.id) ? (
              <kbd title="This shortcut cannot be changed">{c.shortcut}</kbd>
            ) : (
              <button
                className={capturing === c.id ? "shortcut capturing" : "shortcut"}
                onClick={() => {
                  setRefused(null);
                  setCapturing(capturing === c.id ? null : c.id);
                }}
                onKeyDown={capturing === c.id ? onCaptureKey(c.id) : undefined}
                onBlur={() => capturing === c.id && setCapturing(null)}
                aria-label={`Shortcut of ${c.title}: ${c.shortcut ?? "none"}. Press to change.`}
              >
                {capturing === c.id ? "Press keys… (Backspace: none)" : c.shortcut || "—"}
              </button>
            )}
            {capturing === c.id && refused && <span className="error">{refused}</span>}
            {c.id in settings.shortcuts && !fixed.has(c.id) && (
              <button className="link" onClick={() => setShortcut(c.id, null)}>
                Reset
              </button>
            )}
          </div>
        ),
      }),
    ),
    {
      section: "Updates",
      key: "updates",
      title: "Check for updates",
      words: "release new version github",
      description: "Once a day, ask GitHub for the latest release. Nothing else is sent.",
      control: (
        <div className="setting-row">
          <label className="check">
            <input type="checkbox" checked={settings.updates} onChange={(e) => onChange({ updates: e.target.checked })} />
            Daily
          </label>
          <button onClick={props.onCheckUpdates} disabled={!inTauri}>
            Check now
          </button>
        </div>
      ),
    },
  ];

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (i: Item) =>
    words.every((w) => `${i.title} ${i.description ?? ""} ${i.words ?? ""} ${i.section}`.toLowerCase().includes(w));
  const shown = words.length ? items.filter(matches) : items.filter((i) => i.section === section);

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Settings</h2>
          <input ref={search} type="search" placeholder="Search settings" aria-label="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button onClick={props.onClose}>Close</button>
        </div>
        {props.saveError && <p className="error settings-error">{props.saveError}</p>}
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Sections">
            {SECTIONS.map((s) => (
              <button
                key={s}
                aria-current={!words.length && s === section ? "page" : undefined}
                onClick={() => {
                  setQuery("");
                  setSection(s);
                }}
              >
                {s}
              </button>
            ))}
          </nav>
          <div className="settings-list">
            {!words.length && <h3>{section}</h3>}
            {shown.map((i, n) => (
              <div className="setting" key={i.key}>
                {words.length > 0 && (n === 0 || shown[n - 1].section !== i.section) && <h3>{i.section}</h3>}
                <div className="setting-text">
                  <span className="setting-title">{i.title}</span>
                  {i.description && <span className="hint">{i.description}</span>}
                </div>
                <div className="setting-control">{i.control}</div>
              </div>
            ))}
            {shown.length === 0 && <p className="hint">No setting matches “{query}”.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
