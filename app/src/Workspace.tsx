// Several designs open side by side in tabs (US-9.4). Each tab is its own
// editor, kept mounted while hidden so that its undo history, selection and
// viewport survive switching. The element library is shared: the backend
// holds one kernel index for the whole app.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend, inTauri } from "./backend";
import { Editor, type DesignSource, type EditorApi, type EditorStatus, type Kernel } from "./App";
import { Palette } from "./components/Palette";
import { UpdateNotice } from "./components/UpdateNotice";
import { checkForUpdate, type Update } from "./updates";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "./settings";
import type { Section } from "./components/SettingsPanel";
import { DEFAULT_LAYOUT, loadLayout, saveLayout, type Layout } from "./layout";
import { PaneRail } from "./components/PaneRail";
import { Splitter } from "./components/Splitter";

interface Tab {
  id: number;
  start?: DesignSource;
}

let nextTab = 0;
const newTab = (start?: DesignSource): Tab => ({ id: nextTab++, start });

/** The design named by `?design=<url>` in a plain browser (the G5 benchmark). */
function browserStart(): DesignSource | undefined {
  if (inTauri) return undefined;
  const url = new URLSearchParams(window.location.search).get("design");
  if (!url) return undefined;
  return { load: () => fetch(url).then((r) => r.json()), path: null, name: url.split("/").pop() || url };
}

export default function Workspace() {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(browserStart())]);
  const [active, setActive] = useState(() => tabs[0].id);
  const [statuses, setStatuses] = useState<Map<number, EditorStatus>>(new Map());
  const apis = useRef(new Map<number, EditorApi>());
  /** The tab whose unsaved changes the user is asked about. */
  const [closing, setClosing] = useState<number | null>(null);
  const [quitting, setQuitting] = useState(false);

  const [requestedKernel, setRequestedKernel] = useState<string | null>(null);
  const [kernel, setKernel] = useState<Kernel | null>(null);
  const [settingsSection, setSettingsSection] = useState<Section | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  // Changes made before the file is read are applied on top of it, never
  // saved over it.
  const early = useRef<Partial<Settings>>({});
  const latestLoaded = useRef(false);
  const changeSettings = useCallback((patch: Partial<Settings>) => {
    if (!latestLoaded.current) early.current = { ...early.current, ...patch };
    setSettings((s) => ({ ...s, ...patch }));
  }, []);
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings(settings).then(
      () => setSettingsError(null),
      (e) => setSettingsError(`The settings could not be saved: ${e}`),
    );
  }, [settings, settingsLoaded]);
  const [update, setUpdate] = useState<{ update: Update | null; error?: string } | null>(null);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [outlineSlot, setOutlineSlot] = useState<HTMLDivElement | null>(null);
  const changeLayout = useCallback((change: (l: Layout) => Layout) => {
    setLayout((l) => {
      const next = change(l);
      saveLayout(next);
      return next;
    });
  }, []);

  useEffect(() => {
    loadSettings().then((loaded) => {
      const s = { ...loaded, ...early.current };
      latestLoaded.current = true;
      setSettings(s);
      setSettingsLoaded(true);
      // The backend checks the dtc path again. One that is missing now (an
      // unmounted drive) is skipped for this session but kept in the file.
      if (inTauri && s.dtcPath) backend.setDtcPath(s.dtcPath).catch((e) => console.warn("dtc path not used:", e));
      // A failed check at start stays quiet; offline is normal.
      checkForUpdate(false, s.updates).then((u) => u && setUpdate({ update: u }), () => {});
    });
  }, [changeSettings]);
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);
  const checkUpdatesNow = useCallback(() => {
    changeSettings({ updates: true });
    checkForUpdate(true).then(
      (u) => setUpdate({ update: u }),
      (e) => setUpdate({ update: null, error: String(e?.message ?? e) }),
    );
  }, [changeSettings]);

  // Callbacks the editors hold on to read the latest state through this.
  const latest = useRef({ tabs, active, statuses });
  latest.current = { tabs, active, statuses };

  const setStatus = useCallback((id: number, status: EditorStatus) => {
    setStatuses((m) => {
      const old = m.get(id);
      if (old && old.title === status.title && old.dirty === status.dirty && old.fresh === status.fresh) return m;
      return new Map(m).set(id, status);
    });
  }, []);
  const setApi = useCallback((id: number, api: EditorApi) => apis.current.set(id, api), []);

  const addTab = useCallback((start?: DesignSource) => {
    const tab = newTab(start);
    setTabs((ts) => [...ts, tab]);
    setActive(tab.id);
  }, []);

  /** Opens a design in the current tab if that is an untouched new one, else in a new tab. */
  const open = useCallback(
    (source: DesignSource) => {
      const { active, statuses } = latest.current;
      const api = apis.current.get(active);
      if (api && statuses.get(active)?.fresh) api.load(source);
      else addTab(source);
    },
    [addTab],
  );

  const newDesign = useCallback(() => {
    const { active, statuses } = latest.current;
    if (!statuses.get(active)?.fresh) addTab();
  }, [addTab]);

  const close = useCallback((id: number) => {
    const { tabs, active } = latest.current;
    const index = tabs.findIndex((t) => t.id === id);
    let rest = tabs.filter((t) => t.id !== id);
    if (rest.length === 0) rest = [newTab()];
    setTabs(rest);
    if (id === active) setActive(rest[Math.min(index, rest.length - 1)].id);
    apis.current.delete(id);
    setStatuses((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }, []);

  const requestClose = useCallback(
    (id: number) => {
      if (latest.current.statuses.get(id)?.dirty) setClosing(id);
      else close(id);
    },
    [close],
  );

  const saveAndClose = async (id: number) => {
    setClosing(null);
    setActive(id);
    if (await apis.current.get(id)?.save()) close(id);
  };

  useEffect(() => {
    if (!inTauri) return;
    backend.startupArgs().then(
      (args) => {
        if (args.design) {
          const design = args.design;
          const path = args.design_path;
          open({ load: async () => design, path, name: path ? path.split(/[\\/]/).pop()! : "Untitled" });
        }
        setRequestedKernel(args.linux_src);
      },
      () => {},
    );
  }, [open]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    const anyDirty = () => [...latest.current.statuses.values()].some((s) => s.dirty);
    if (!inTauri) {
      const onUnload = (e: BeforeUnloadEvent) => {
        if (anyDirty()) e.preventDefault();
      };
      window.addEventListener("beforeunload", onUnload);
      return () => window.removeEventListener("beforeunload", onUnload);
    }
    const unlisten = getCurrentWindow().onCloseRequested((e) => {
      if (anyDirty()) {
        e.preventDefault();
        setQuitting(true);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      const { tabs, active } = latest.current;
      if (e.key === "Tab") {
        const i = tabs.findIndex((t) => t.id === active);
        const next = tabs[(i + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length];
        setActive(next.id);
      } else if (e.key.toLowerCase() === "w" && !e.shiftKey) {
        requestClose(active);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const closingStatus = closing !== null ? statuses.get(closing) : undefined;
  const unsaved = [...statuses.values()].filter((s) => s.dirty);

  return (
    <div
      className="app"
      style={
        {
          "--library-w": layout.library.open ? `${layout.library.size}px` : "var(--rail-w)",
          "--inspector-w": layout.inspector.open ? `${layout.inspector.size}px` : "var(--rail-w)",
          "--panel-h": layout.panel.open ? `min(${layout.panel.size}px, 60vh)` : "0px",
        } as CSSProperties
      }
    >
      <nav className="tabs" role="tablist" aria-label="Open designs">
        {tabs.map((t) => {
          const status = statuses.get(t.id);
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              className={t.id === active ? "tab active" : "tab"}
              onClick={() => setActive(t.id)}
              onAuxClick={(e) => e.button === 1 && requestClose(t.id)}
              title={status?.dirty ? "Unsaved changes" : undefined}
            >
              <span className="tab-title">{status?.title ?? "Untitled"}</span>
              {status?.dirty && <span className="tab-dirty" aria-label="unsaved">●</span>}
              <button
                className="tab-close"
                aria-label={`Close ${status?.title ?? "tab"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  requestClose(t.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="tab-new" onClick={() => addTab()} title="New design" aria-label="New tab">
          +
        </button>
      </nav>
      <div className="pane library-pane">
        {/* Kept mounted while collapsed, so the search and the loaded kernel stay. */}
        <div className="pane-body" hidden={!layout.library.open}>
          <div className="side-views" role="tablist" aria-label="Side bar">
            {(["library", "outline"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={layout.library.view === v}
                onClick={() => changeLayout((l) => ({ ...l, library: { ...l.library, view: v } }))}
              >
                {v === "library" ? "Library" : "Outline"}
              </button>
            ))}
          </div>
          <div className="side-view" hidden={layout.library.view !== "library"}>
            <Palette
              onAdd={(b) => apis.current.get(active)?.addNode(b)}
              requestedKernel={requestedKernel}
              onKernelLoaded={(k) => setKernel({ path: k.path, version: k.version })}
            />
          </div>
          {/* The active editor draws its navigator here (US-16.4). */}
          <div className="side-view panel outline-slot" hidden={layout.library.view !== "outline"} ref={setOutlineSlot} />
          <Splitter
            pane="library"
            size={layout.library.size}
            label="Library width"
            onResize={(size) => changeLayout((l) => ({ ...l, library: { ...l.library, size } }))}
          />
        </div>
        <PaneRail pane="library" layout={layout} onLayout={changeLayout} />
      </div>
      {tabs.map((t) => (
        <ReactFlowProvider key={t.id}>
          <TabEditor
            id={t.id}
            active={t.id === active}
            start={t.start}
            kernel={kernel}
            setApi={setApi}
            setStatus={setStatus}
            onOpen={open}
            onNew={newDesign}
            onCheckUpdates={checkUpdatesNow}
            layout={layout}
            onLayout={changeLayout}
            outlineSlot={outlineSlot}
            onResetLayout={() => changeLayout(() => DEFAULT_LAYOUT)}
            settings={settings}
            settingsLoaded={settingsLoaded}
            settingsError={settingsError}
            onSettings={changeSettings}
            settingsSection={settingsSection}
            onOpenSettings={setSettingsSection}
            onUseKernel={setRequestedKernel}
          />
        </ReactFlowProvider>
      ))}
      {update && <UpdateNotice {...update} onClose={() => setUpdate(null)} onTurnOff={() => changeSettings({ updates: false })} />}
      {closing !== null && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Unsaved changes">
            <h2>Unsaved changes</h2>
            <p>Save the changes to {closingStatus?.title ?? "this design"} before closing it?</p>
            <div className="modal-actions">
              <button onClick={() => setClosing(null)}>Cancel</button>
              <button
                onClick={() => {
                  setClosing(null);
                  close(closing);
                }}
              >
                Discard
              </button>
              <button className="primary" onClick={() => saveAndClose(closing)} disabled={!inTauri}>
                Save…
              </button>
            </div>
          </div>
        </div>
      )}
      {quitting && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Unsaved changes">
            <h2>Unsaved changes</h2>
            <p>
              {unsaved.length === 1
                ? `${unsaved[0].title} has unsaved changes.`
                : `${unsaved.length} designs have unsaved changes: ${unsaved.map((s) => s.title).join(", ")}.`}{" "}
              Quit anyway?
            </p>
            <div className="modal-actions">
              <button onClick={() => setQuitting(false)}>Cancel</button>
              <button onClick={() => getCurrentWindow().destroy()}>Quit without saving</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TabEditorProps {
  id: number;
  active: boolean;
  start?: DesignSource;
  kernel: Kernel | null;
  setApi: (id: number, api: EditorApi) => void;
  setStatus: (id: number, status: EditorStatus) => void;
  onOpen: (source: DesignSource) => void;
  onNew: () => void;
  onCheckUpdates: () => void;
  layout: Layout;
  onLayout: (change: (l: Layout) => Layout) => void;
  outlineSlot: HTMLElement | null;
  onResetLayout: () => void;
  settings: Settings;
  settingsLoaded: boolean;
  settingsError: string | null;
  onSettings: (patch: Partial<Settings>) => void;
  settingsSection: Section | null;
  onOpenSettings: (section: Section | null) => void;
  onUseKernel: (path: string) => void;
}

/** An editor with callbacks bound to its tab. */
function TabEditor({ id, setApi, setStatus, ...rest }: TabEditorProps) {
  const api = useCallback((a: EditorApi) => setApi(id, a), [id, setApi]);
  const onStatus = useCallback((s: EditorStatus) => setStatus(id, s), [id, setStatus]);
  return <Editor {...rest} api={api} onStatus={onStatus} />;
}
