// Several designs open side by side in tabs (US-9.4). Each tab is its own
// editor, kept mounted while hidden so that its undo history, selection and
// viewport survive switching. The element library is shared: the backend
// holds one kernel index for the whole app.
import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend, inTauri } from "./backend";
import { Editor, type DesignSource, type EditorApi, type EditorStatus, type Kernel } from "./App";
import { KernelSettings } from "./components/KernelSettings";
import { Palette } from "./components/Palette";

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
  const [showKernels, setShowKernels] = useState(false);

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
    <div className="app">
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
      <Palette
        onAdd={(b) => apis.current.get(active)?.addNode(b)}
        requestedKernel={requestedKernel}
        onKernelLoaded={(k) => setKernel({ path: k.path, version: k.version })}
      />
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
            onKernels={() => setShowKernels(true)}
          />
        </ReactFlowProvider>
      ))}
      {showKernels && (
        <KernelSettings
          active={kernel?.path ?? null}
          onUse={(path) => {
            setShowKernels(false);
            setRequestedKernel(path);
          }}
          onClose={() => setShowKernels(false)}
        />
      )}
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
  onKernels: () => void;
}

/** An editor with callbacks bound to its tab. */
function TabEditor({ id, setApi, setStatus, ...rest }: TabEditorProps) {
  const api = useCallback((a: EditorApi) => setApi(id, a), [id, setApi]);
  const onStatus = useCallback((s: EditorStatus) => setStatus(id, s), [id, setStatus]);
  return <Editor {...rest} api={api} onStatus={onStatus} />;
}
