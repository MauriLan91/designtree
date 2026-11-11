import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnBeforeDelete,
  type XYPosition,
} from "@xyflow/react";
import { backend, dialogs, inTauri } from "./backend";
import { DtNode } from "./components/DtNode";
import { DtsPreview } from "./components/DtsPreview";
import type { SourceError, Span } from "./components/DtsEditor";
import { reconcileEdges, reconcileNodes } from "./textSync";
import { collapsedAncestors, collapseView, isGroupNode, toggleCollapsed } from "./collapse";
import { GroupNode } from "./components/GroupNode";
import { initialProperties, regEntryCells } from "./schemaProps";
import { InterruptPanel } from "./components/InterruptPanel";
import { AddressMapPanel } from "./components/AddressMapPanel";
import { SocPicker } from "./components/SocPicker";
import { BuildPanel, type BuildState } from "./components/BuildPanel";
import { SchemaPanel, type SchemaState } from "./components/SchemaPanel";
import { ProblemList } from "./components/ProblemList";
import { NodeProblems } from "./nodeProblems";
import { NodePorts } from "./nodePorts";
import {
  accepts,
  consumerHandle,
  guessReferenceProperty,
  handleCells,
  handleProperty,
  nodePorts,
  providedCells,
  providerHandle,
  specifierCount,
  type NodePortSet,
} from "./ports";
import { Inspector } from "./components/Inspector";
import { BoardView } from "./components/BoardView";
import { DRAG_MIME } from "./components/Palette";
import { bindingOf as entryBinding } from "./library";
import { RefEdge } from "./components/RefEdge";
import { useHistory } from "./history";
import { align, cornerOf, distribute, layered, type Alignment, type Box, type Link } from "./tidy";
import { CommandPalette, ShortcutSheet } from "./components/CommandPalette";
import { MenuBar } from "./components/MenuBar";
import { BottomPanel } from "./components/BottomPanel";
import { PaneRail, PANE_SHORTCUTS } from "./components/PaneRail";
import { Splitter } from "./components/Splitter";
import { StatusBar } from "./components/StatusBar";
import { ScopeBar } from "./components/ScopeBar";
import { BoundaryNode } from "./components/BoundaryNode";
import { BusBarNode } from "./components/BusBarNode";
import { Navigator } from "./components/Navigator";
import { createPortal } from "react-dom";
import {
  BUSBAR_PREFIX,
  boundaryPorts,
  busBar,
  busKind,
  canHaveChildren,
  inScope,
  mainScope,
  parentsOf,
  realId,
  scopeEdges,
  scopeIds,
  scopeOf,
  scopePath,
  treeRows,
} from "./scopes";
import type { EditorMode, Layout, PaneName, PanelTab } from "./layout";
import type { Settings } from "./settings";
import { SettingsPanel, type Section } from "./components/SettingsPanel";
import { ModeSwitch } from "./components/ModeSwitch";
import { comboOf, pickOf, tooltipOf, withShortcuts, type Command, type NodePick } from "./commands";
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  LayoutDashboard,
  FilePlus,
  FolderOpen,
  Hammer,
  Redo2,
  Save,
  Search,
  SquarePlus,
  Undo2,
  Workflow,
} from "lucide-react";
import { CLIPBOARD_MIME, copySelection, parseClipboard, pasteClipboard, renameLabels } from "./clipboard";
import {
  CHILD_HANDLE,
  PARENT_HANDLE,
  PHANDLE_HANDLE,
  REF_HANDLE,
  emptyDesign,
  fromDesign,
  genericNodeName,
  isDtNode,
  deletionTarget,
  toDesign,
  uniqueLabel,
  type Binding,
  type Design,
  type DtFlowNode,
  type FlowNode,
  type GroupFlowNode,
  type DesignExtras,
  type AddressMap,
  type InterruptTree,
  type BoardLink,
  type PinCheck,
  type RefData,
  type LibraryEntry,
  type Problem,
} from "./model";

/** An error that is about no node, such as a failed command. */
const failure = (message: string): Problem => ({ severity: "error", message });

const nodeTypes = { dt: DtNode, group: GroupNode, boundary: BoundaryNode, busbar: BusBarNode };
const edgeTypes = { ref: RefEdge };
const GROUP_PADDING = 40;

/** The design without what does not reach the devicetree (positions, groups, the board view), and its key. */
function treeOf(nodes: FlowNode[], edges: Edge[], extras: DesignExtras) {
  const design = toDesign(nodes, edges, extras);
  const tree = {
    ...design,
    nodes: design.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 }, board_position: undefined })),
    groups: [],
    board: undefined,
  };
  return { design: tree, key: JSON.stringify(tree) };
}

const isSourceError = (e: unknown): e is SourceError =>
  typeof e === "object" && e !== null && "line" in e && "message" in e;

/** Inputs that keep their own undo; a checkbox has none. */
const TEXT_INPUTS = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"])';

/** Same design content, cheaply: what selecting or measuring leaves alone. */
const sameNodes = (a: FlowNode[], b: FlowNode[]) =>
  a.length === b.length &&
  a.every((n, i) => {
    const m = b[i];
    return (
      n.id === m.id &&
      n.data === m.data &&
      n.position === m.position &&
      n.parentId === m.parentId &&
      n.style === m.style &&
      n.measured?.width === m.measured?.width &&
      n.measured?.height === m.measured?.height
    );
  });
const sameEdges = (a: Edge[], b: Edge[]) =>
  a.length === b.length &&
  a.every((e, i) => {
    const f = b[i];
    return e.id === f.id && e.data === f.data && e.source === f.source && e.target === f.target;
  });

/** Reference data drawn as a curve again. */
const withoutRoute = ({ route: _, ...rest }: RefData): RefData => rest;

let nextId = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** A design to open, and the name its tab shows. */
export interface DesignSource {
  load: () => Promise<Design>;
  /** The design file it is saved to, if it came from one. */
  path: string | null;
  name: string;
}

/** What the tab bar shows of an editor. */
export interface EditorStatus {
  title: string;
  dirty: boolean;
  /** A new empty design nobody touched: opening a design may replace it. */
  fresh: boolean;
}

/** What the workspace asks of an editor. */
export interface EditorApi {
  addNode: (binding: Binding | null) => void;
  load: (source: DesignSource) => Promise<void>;
  /** Saves the design; false if the user cancelled or it failed. */
  save: () => Promise<boolean>;
}

export type Kernel = { path: string; version: string | null };

interface EditorProps {
  /** The tab on show; the others keep their state but take no keys. */
  active: boolean;
  /** Loaded when the editor opens. */
  start?: DesignSource;
  /** The kernel the library is built from. */
  kernel: Kernel | null;
  api: (api: EditorApi) => void;
  onStatus: (status: EditorStatus) => void;
  /** Opens a design, in this tab or a new one. */
  onOpen: (source: DesignSource) => void;
  onNew: () => void;
  /** Checks for a newer release now, and turns the daily check back on. */
  onCheckUpdates: () => void;
  /** The panes, shared by every tab and remembered for the user. */
  layout: Layout;
  onLayout: (change: (l: Layout) => Layout) => void;
  /** Where the navigator goes in the side bar; the visible tab draws it. */
  outlineSlot: HTMLElement | null;
  onResetLayout: () => void;
  /** The user's settings; changes are saved by the workspace. */
  settings: Settings;
  settingsLoaded: boolean;
  /** Why the last save of the settings failed, if it did. */
  settingsError: string | null;
  onSettings: (patch: Partial<Settings>) => void;
  /** The settings section on show, or null when the panel is closed. */
  settingsSection: Section | null;
  onOpenSettings: (section: Section | null) => void;
  onUseKernel: (path: string) => void;
}

/** Commands whose shortcuts have handlers of their own (undo knows about
 * text fields, the palette toggles from inside itself), so they stay fixed. */
const FIXED_SHORTCUTS: ReadonlySet<string> = new Set(["undo", "redo", "palette"]);

const baseName = (path: string) => path.split(/[\\/]/).pop()!;

export function Editor({
  active,
  start,
  kernel,
  api,
  onStatus,
  onOpen,
  onNew,
  onCheckUpdates,
  layout,
  onLayout,
  outlineSlot,
  onResetLayout,
  settings,
  settingsLoaded,
  settingsError,
  onSettings,
  settingsSection,
  onOpenSettings,
  onUseKernel,
}: EditorProps) {
  const initial = useMemo(() => fromDesign(emptyDesign()), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  // Design data with no place on the canvas, kept for saving and export.
  const [extras, setExtras] = useState<DesignExtras>({});
  // Inherited nodes the user chose to override; the others stay read-only.
  const [overriding, setOverriding] = useState<Set<string>>(new Set());
  const [dts, setDts] = useState<string | null>(null);
  /** For an overlay: its base with the overlay applied. */
  const [appliedDts, setAppliedDts] = useState<string | null>(null);
  /** What the source editor shows, and the lines of each node in it. */
  const [editorText, setEditorText] = useState({ text: "", version: 0 });
  const [spans, setSpans] = useState<Span[]>([]);
  const [sourceError, setSourceError] = useState<SourceError | null>(null);
  /** The text as typed, and the tree key of the design imported from it. */
  const edited = useRef<{ key: string; text: string } | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const extrasRef = useRef(extras);
  extrasRef.current = extras;

  // Scopes (US-16.1): the canvas shows one node's children at a time. The
  // main canvas is the root's; other scopes open in tabs of their own.
  const parents = useMemo(() => parentsOf(edges), [edges]);
  const main = useMemo(() => mainScope(nodes, parents), [nodes, parents]);
  const [openScopes, setOpenScopes] = useState<string[]>([]);
  /** The active scope tab; null for the main canvas. */
  const [scopeTab, setScopeTab] = useState<string | null>(null);
  const exists = (id: string) => nodes.some((n) => n.id === id);
  const liveScopes = openScopes.filter(exists);
  const scope = scopeTab !== null && exists(scopeTab) ? scopeTab : main;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // The navigator's open branches (US-16.4).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Undo and redo over everything saved in the design file (US-9.1).
  // Overrides ride along so that undoing past one locks the node again;
  // the kernel stamp is written by saving, which is not an edit.
  const editorState = useMemo(
    () => ({ nodes, edges, extras, overriding }),
    [nodes, edges, extras, overriding],
  );
  const history = useHistory(editorState, {
    key: (s) => JSON.stringify(toDesign(s.nodes, s.edges, { ...s.extras, kernel: undefined })),
    same: (a, b) => a.extras === b.extras && sameNodes(a.nodes, b.nodes) && sameEdges(a.edges, b.edges),
    restore: (s) => {
      // The selection is not part of the history: keep the current one.
      const selectedNodes = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
      const selectedEdges = new Set(edgesRef.current.filter((e) => e.selected).map((e) => e.id));
      setNodes(s.nodes.map((n) => (!!n.selected === selectedNodes.has(n.id) ? n : ({ ...n, selected: !n.selected } as FlowNode))));
      setEdges(s.edges.map((e) => (!!e.selected === selectedEdges.has(e.id) ? e : { ...e, selected: !e.selected })));
      setExtras({ ...s.extras, kernel: extrasRef.current.kernel });
      setOverriding(s.overriding);
    },
    settled: (s) => !s.nodes.some((n) => n.dragging || n.resizing),
    limit: 500,
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      const redo = (key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey);
      if (!redo && !(key === "z" && !e.shiftKey)) return;
      // Text fields and the source editor have their own undo; a dialog
      // hides the canvas the step would change.
      const target = e.target as HTMLElement | null;
      if (target?.closest(`${TEXT_INPUTS}, textarea, select, [contenteditable], .cm-editor, [role="dialog"]`)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (redo) history.redo();
      else history.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, history.undo, history.redo]);
  // Copy and paste of subtrees (US-9.2), through the system clipboard so
  // that they reach other designs and windows.
  useEffect(() => {
    if (!active) return;
    const onCanvas = (e: Event) => {
      const target = e.target as HTMLElement | null;
      return !target?.closest(`${TEXT_INPUTS}, textarea, select, [contenteditable], .cm-editor, [role="dialog"]`);
    };
    const onCopy = (e: ClipboardEvent) => {
      if (!onCanvas(e) || !e.clipboardData) return;
      const clip = copySelection(nodesRef.current, edgesRef.current);
      if (!clip) return;
      const text = JSON.stringify(clip);
      e.clipboardData.setData(CLIPBOARD_MIME, text);
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!onCanvas(e) || !e.clipboardData) return;
      const clip = parseClipboard(e.clipboardData.getData(CLIPBOARD_MIME) || e.clipboardData.getData("text/plain"));
      if (!clip) return;
      e.preventDefault();
      const current = nodesRef.current;
      // Pasted nodes land in the scope on show, where the user can see them.
      const into = scopeRef.current;
      const pasted = pasteClipboard(clip, current, edgesRef.current, into, newId);
      // The pasted nodes come selected, ready to move.
      setNodes((ns) => [...ns.map((n) => (n.selected ? ({ ...n, selected: false } as FlowNode) : n)), ...pasted.nodes]);
      setEdges((es) => [...es.map((x) => (x.selected ? { ...x, selected: false } : x)), ...pasted.edges]);
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  }, [active, setNodes, setEdges]);
  const [showApplied, setShowApplied] = useState(false);
  // Why the design cannot be written as DTS, on the nodes they are about.
  const [errors, setErrors] = useState<Problem[]>([]);
  /** File the design was last opened from or saved to; the .dtb goes next to it. */
  const [designPath, setDesignPath] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled");
  const [fresh, setFresh] = useState(!start);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [schema, setSchema] = useState<SchemaState>({ checking: false, problems: [] });
  const schemaRun = useRef(0);
  // The interrupt tree and the address map are computed only while their
  // tab of the bottom panel is on show.
  const panelTab = layout.panel.open ? layout.panel.tab : null;
  const showInterrupts = panelTab === "interrupts";
  const [pickingSoc, setPickingSoc] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [palettePick, setPalettePick] = useState<NodePick | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [interrupts, setInterrupts] = useState<InterruptTree | null>(null);
  const showAddressMap = panelTab === "address-map";
  // Each tab has its own mode; the last one chosen is where new tabs start.
  const [ownMode, setOwnMode] = useState<EditorMode | null>(() => (settingsLoaded ? settings.editorMode : null));
  // The first tab opens before the settings are read: it follows them until then.
  const mode = ownMode ?? settings.editorMode;
  useEffect(() => {
    if (settingsLoaded) setOwnMode((m) => m ?? settings.editorMode);
    // Only once, when the settings arrive: later changes are other tabs'.
  }, [settingsLoaded]);
  const setMode = (m: EditorMode) => {
    setOwnMode(m);
    onSettings({ editorMode: m });
  };
  const [dtcVersion, setDtcVersion] = useState<string | null | undefined>(undefined);
  // Only the tab on show asks, so a change does not run dtc once per tab.
  useEffect(() => {
    if (inTauri && active) backend.dtcVersion().then(setDtcVersion, () => setDtcVersion(null));
  }, [settings.dtcPath, active]);
  const [boardView, setBoardView] = useState(false);
  const [addressMap, setAddressMap] = useState<AddressMap | null>(null);
  const [pinCheck, setPinCheck] = useState<PinCheck | null>(null);
  const [boardLinks, setBoardLinks] = useState<BoardLink[] | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (start) loadDesign(start);
  }, []);

  const { dirty, markSaved } = history;
  useEffect(() => onStatus({ title, dirty, fresh: fresh && !dirty }), [title, dirty, fresh, onStatus]);

  const kernelWarning = !!extras.kernel && !!kernel?.version && extras.kernel !== kernel.version;

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected) ?? null;
  const providerNode = selectedEdge && nodes.find((n) => n.id === selectedEdge.target);
  const providerCells =
    selectedEdge?.data && providerNode && isDtNode(providerNode)
      ? specifierCount(providerNode.data, (selectedEdge.data as RefData).property)
      : undefined;

  // What the schema check depends on: moving or selecting nodes changes
  // `nodes` but not the devicetree, and must not start a check.
  const schemaInput = useMemo(() => treeOf(nodes, edges, extras), [nodes, edges, extras]);
  const schemaKey = schemaInput.key;

  // Regenerate the source whenever the devicetree changes. After an edit
  // of the text, the editor keeps the text as typed: only canvas changes
  // replace it.
  useEffect(() => {
    if (!inTauri) {
      setErrors([failure("Backend not available: run the app with `npm run tauri dev`.")]);
      return;
    }
    let stale = false;
    const design = schemaInput.design;
    const t = setTimeout(async () => {
      try {
        const [mapped, applied] = await Promise.all([
          backend.exportDtsMapped(design),
          design.overlay ? backend.exportDtsFlat(design) : null,
        ]);
        if (stale) return;
        setDts(mapped.dts);
        setAppliedDts(applied);
        setErrors([]);
        if (edited.current?.key !== schemaKey) {
          edited.current = null;
          setEditorText((t) => ({ text: mapped.dts, version: t.version + 1 }));
          setSpans(mapped.spans);
          setSourceError(null);
        }
      } catch (e) {
        if (!stale) setErrors(Array.isArray(e) ? e : [failure(String(e))]);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [schemaKey]);

  // Edits of the source are imported into the design once typing pauses.
  // A change of the tree on the canvas wins over an edit not applied yet.
  const editRun = useRef(0);
  const editTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (schemaKey === edited.current?.key) return;
    clearTimeout(editTimer.current);
    editRun.current++;
  }, [schemaKey]);
  const onSourceEdit = (text: string) => {
    clearTimeout(editTimer.current);
    editTimer.current = setTimeout(async () => {
      const run = ++editRun.current;
      try {
        const result = await backend.applySource(text, toDesign(nodesRef.current, edgesRef.current, extrasRef.current));
        if (run !== editRun.current) return;
        const d = fromDesign(result.design);
        const nextNodes = reconcileNodes(nodesRef.current, d.nodes);
        const nextEdges = reconcileEdges(edgesRef.current, d.edges, () => newId("e"));
        edited.current = { key: treeOf(nextNodes, nextEdges, d.extras).key, text };
        setNodes(nextNodes);
        setEdges(nextEdges);
        setExtras(d.extras);
        setSpans(result.spans);
        setSourceError(null);
      } catch (e) {
        if (run !== editRun.current) return;
        setSourceError(isSourceError(e) ? e : { line: 0, column: 0, message: String(e) });
      }
    }, 400);
  };

  const onCursorNode = (id: string | null) => {
    if (!id) return;
    // The canvas follows the cursor into the node's scope.
    if (id !== scopeRef.current && !inScope(id, scopeRef.current, main, parents)) showScope(scopeOf(id, main, parents), false);
    setNodes((ns) =>
      ns.map((n) => (n.selected === (n.id === id) ? n : ({ ...n, selected: n.id === id } as FlowNode))),
    );
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  };


  // Check the design against the binding schemas while editing; only the
  // latest check's answer is kept.
  useEffect(() => {
    if (!inTauri || !kernel) return;
    const design = schemaInput.design;
    const t = setTimeout(async () => {
      const run = ++schemaRun.current;
      setSchema((s) => ({ ...s, checking: true }));
      try {
        const problems = await backend.checkSchemas(design);
        if (run === schemaRun.current) setSchema({ checking: false, problems });
      } catch (e) {
        if (run === schemaRun.current) {
          setSchema({ checking: false, problems: [{ severity: "error", message: String(e) }] });
        }
      }
    }, 400);
    return () => clearTimeout(t);
  }, [schemaKey, kernel]);

  const nodeProblems = useMemo(() => {
    const byNode = new Map<string, string[]>();
    for (const p of [...errors, ...(schema.problems ?? [])]) {
      if (p.node) byNode.set(p.node, [...(byNode.get(p.node) ?? []), p.message]);
    }
    return byNode;
  }, [errors, schema.problems]);

  useEffect(() => {
    if (!showInterrupts || !inTauri) return;
    const t = setTimeout(async () => {
      try {
        setInterrupts(await backend.interruptTree(toDesign(nodes, edges, extras)));
      } catch {
        // The DTS preview already shows why the design is invalid.
      }
    }, 250);
    return () => clearTimeout(t);
  }, [showInterrupts, nodes, edges, extras]);

  // The pin check reads the devicetree and the pin mapping; connector
  // titles, positions and pin names do not change it.
  const pinMapping = useMemo(() => {
    const connectors = (extras.board?.connectors ?? []).map((c) => ({
      ...c,
      title: "",
      position: { x: 0, y: 0 },
      pins: c.pins.map((p) => ({ ...p, name: "" })),
    }));
    return { connectors, key: JSON.stringify(connectors) };
  }, [extras.board?.connectors]);
  useEffect(() => {
    if (!boardView || !inTauri || !pinMapping.connectors.length) {
      setPinCheck(null);
      return;
    }
    const design = { ...schemaInput.design, board: { connectors: pinMapping.connectors } };
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const check = await backend.pinCheck(design);
        if (!stale) setPinCheck(check);
      } catch {
        // The DTS preview already shows why the design is invalid.
        if (!stale) setPinCheck(null);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [boardView, schemaKey, pinMapping.key]);

  // What drives what reads only the devicetree: placing a device on the
  // board changes which links are drawn, not the links.
  useEffect(() => {
    if (!boardView || !inTauri) {
      setBoardLinks(null);
      return;
    }
    const design = schemaInput.design;
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const links = await backend.boardLinks(design);
        if (!stale) setBoardLinks(links);
      } catch {
        if (!stale) setBoardLinks(null);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [boardView, schemaKey]);

  useEffect(() => {
    if (!showAddressMap || !inTauri) {
      setAddressMap(null);
      return;
    }
    const design = schemaInput.design;
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const map = await backend.addressMap(design);
        if (!stale) setAddressMap(map);
      } catch {
        // The DTS preview already shows why the design is invalid.
        if (!stale) setAddressMap(null);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // Keyed on the tree, not on positions.
  }, [showAddressMap, schemaKey]);

  // Bindings of nodes that were not created from the library, by compatible
  // (null: undocumented). A failed lookup is retried.
  const [bindingsByCompatible, setBindingsByCompatible] = useState<Map<string, Binding | null>>(new Map());
  const [lookupRetry, setLookupRetry] = useState(0);
  useEffect(() => setBindingsByCompatible(new Map()), [kernel]);
  const missingCompatibles = useMemo(() => {
    const missing = new Set<string>();
    for (const n of nodes) {
      if (!isDtNode(n) || n.data.binding) continue;
      n.data.compatible.filter((c) => !bindingsByCompatible.has(c)).forEach((c) => missing.add(c));
    }
    return [...missing].sort().join("\n");
  }, [nodes, bindingsByCompatible]);
  useEffect(() => {
    if (!inTauri || !kernel || !missingCompatibles) return;
    const compatibles = missingCompatibles.split("\n");
    let stale = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    backend.bindingsForCompatibles(compatibles).then(
      (found) => {
        if (stale) return;
        setBindingsByCompatible((m) => {
          const next = new Map(m);
          compatibles.forEach((c, i) => next.set(c, found[i]));
          return next;
        });
      },
      () => {
        if (!stale) retry = setTimeout(() => setLookupRetry((n) => n + 1), 2000);
      },
    );
    return () => {
      stale = true;
      clearTimeout(retry);
    };
  }, [missingCompatibles, kernel, lookupRetry]);

  /** A node's binding: the one it was created from, else that of its first documented compatible. */
  const bindingOf = useCallback(
    (data: DtFlowNode["data"]) =>
      data.binding ?? data.compatible.map((c) => bindingsByCompatible.get(c)).find((b) => b) ?? undefined,
    [bindingsByCompatible],
  );

  // Ports only depend on node data, bindings and references: moving or
  // selecting nodes reuses the previous sets, so nodes do not re-render.
  const portCache = useRef(new Map<string, { key: unknown[]; ports: NodePortSet; json: string }>());
  const ports = useMemo(() => {
    const referenced = new Map<string, string[]>();
    for (const e of edges) {
      if (e.type !== "ref") continue;
      referenced.set(e.source, [...(referenced.get(e.source) ?? []), (e.data as RefData).property]);
    }
    const dtNodes = nodes.filter(isDtNode);
    const known = new Set(dtNodes.flatMap((n) => providedCells(n.data, bindingOf(n.data))));
    const knownKey = [...known].sort().join();
    const out = new Map<string, NodePortSet>();
    for (const n of dtNodes) {
      const binding = bindingOf(n.data);
      const refs = referenced.get(n.id) ?? [];
      const key = [n.data, binding, refs.join("\n"), knownKey];
      const cached = portCache.current.get(n.id);
      if (cached && cached.key.every((k, i) => k === key[i])) {
        out.set(n.id, cached.ports);
      } else {
        // Most edits (a name, a value) leave the ports as they were: keeping
        // the same set keeps the context, so the other nodes do not re-render.
        const fresh = nodePorts(n.data, binding, refs, known);
        const json = JSON.stringify(fresh);
        out.set(n.id, cached?.json === json ? cached.ports : fresh);
        portCache.current.set(n.id, { key, ports: out.get(n.id)!, json });
      }
    }
    for (const id of portCache.current.keys()) if (!out.has(id)) portCache.current.delete(id);
    return out;
  }, [nodes, edges, bindingOf]);
  // A new map only when some node's ports changed, so the context stays put.
  const portsRef = useRef(ports);
  const stablePorts = useMemo(() => {
    const prev = portsRef.current;
    const same = prev.size === ports.size && [...ports].every(([id, p]) => prev.get(id) === p);
    if (!same) portsRef.current = ports;
    return portsRef.current;
  }, [ports]);

  // References are drawn from the consumer port of their property to the
  // provider port of the target, or its generic phandle handle.
  const edgeCache = useRef(new Map<string, { edge: Edge; drawn: Edge }>());
  const portEdges = useMemo(
    () =>
      edges.map((e) => {
        if (e.type !== "ref") return e;
        const property = (e.data as RefData).property;
        const port = stablePorts.get(e.source)?.consumers.find((c) => c.property === property);
        const cells = port?.cells ?? null;
        const provided = cells !== null && stablePorts.get(e.target)?.providers.some((p) => p.cells === cells);
        const sourceHandle = consumerHandle(property);
        const targetHandle = provided ? providerHandle(cells) : PHANDLE_HANDLE;
        const cached = edgeCache.current.get(e.id);
        if (cached && cached.edge === e && cached.drawn.sourceHandle === sourceHandle && cached.drawn.targetHandle === targetHandle) {
          return cached.drawn;
        }
        const drawn = { ...e, sourceHandle, targetHandle };
        edgeCache.current.set(e.id, { edge: e, drawn });
        return drawn;
      }),
    [edges, stablePorts],
  );

  const isValidConnection: IsValidConnection = useCallback(
    (drawn) => {
      // A boundary port stands for its node in another scope.
      const c = { ...drawn, source: realId(drawn.source), target: realId(drawn.target) };
      if (c.source === c.target) return false;
      // Inherited nodes keep their place in the tree; only overrides can change them.
      const target = nodes.find((n) => n.id === c.target);
      const inherited = target !== undefined && isDtNode(target) && target.data.inherited !== undefined;
      if (c.sourceHandle === CHILD_HANDLE) return c.targetHandle === PARENT_HANDLE && !inherited;
      const toProvider = c.targetHandle === PHANDLE_HANDLE || handleCells(c.targetHandle) !== undefined;
      if (c.sourceHandle === REF_HANDLE) return toProvider;
      // A typed port only joins a provider of its kind.
      const property = handleProperty(c.sourceHandle);
      const port = stablePorts.get(c.source)?.consumers.find((p) => p.property === property);
      return port !== undefined && toProvider && accepts(port, handleCells(c.targetHandle));
    },
    [nodes, stablePorts],
  );

  const onConnect = useCallback(
    (drawn: Connection) => {
      const c = { ...drawn, source: realId(drawn.source), target: realId(drawn.target) };
      if (c.sourceHandle === CHILD_HANDLE) {
        // A node has exactly one parent: rewiring replaces the old link.
        setEdges((es) =>
          addEdge(
            { ...c, id: newId("e") },
            es.filter((e) => !(e.target === c.target && e.sourceHandle === CHILD_HANDLE)),
          ),
        );
        return;
      }
      const target = nodes.find((n) => n.id === c.target);
      if (!target || !isDtNode(target)) return;
      if (!target.data.label) {
        const label = uniqueLabel(target.data.name, nodes);
        setNodes((ns) => ns.map((n) => (n.id === target.id ? ({ ...n, data: { ...n.data, label } } as FlowNode) : n)));
      }
      const property =
        handleProperty(c.sourceHandle) ?? guessReferenceProperty(target.data, bindingOf(target.data), handleCells(c.targetHandle));
      // Placeholder specifier cells, as many as the provider asks for.
      const args = new Array<number>(specifierCount(target.data, property) ?? 0).fill(0);
      const data: RefData = { property, args };
      // Stored edges use the generic handles; the view maps them to ports.
      // Not addEdge: it would drop a second reference between the same two
      // nodes (`clocks` and `resets` to one controller).
      const edge = { ...c, sourceHandle: REF_HANDLE, targetHandle: PHANDLE_HANDLE, id: newId("e"), type: "ref", data };
      setEdges((es) => [...es, edge]);
    },
    [nodes, setNodes, setEdges, bindingOf],
  );

  const addNode = useCallback(
    (binding: Binding | null, position?: { x: number; y: number }) => {
      const id = newId("n");
      const at =
        position ??
        (() => {
          // Upper middle of the visible canvas, jittered so repeated adds don't stack.
          const rect = canvasRef.current!.getBoundingClientRect();
          return screenToFlowPosition({
            x: rect.left + rect.width / 2 - 90 + (Math.random() - 0.5) * 120,
            y: rect.top + rect.height * 0.15 + (Math.random() - 0.5) * 60,
          });
        })();
      const scope = nodesRef.current.find((n) => n.id === scopeRef.current);
      const initial = binding ? initialProperties(binding, regEntryCells(scope && isDtNode(scope) ? scope.data.properties : undefined)) : null;
      // A design has one root: the library's root node fills in the
      // properties the existing one lacks instead of adding another.
      const root = nodesRef.current.find((n) => isDtNode(n) && n.data.name === "/");
      if (binding?.node_name === "/" && root) {
        setNodes((ns) =>
          ns.map((n) => {
            if (n.id !== root.id || !isDtNode(n)) return { ...n, selected: false };
            const have = new Set(n.data.properties.map((p) => p.name));
            const added = initial!.properties.filter((p) => !have.has(p.name));
            const todo = [...(n.data.todo ?? []), ...initial!.todo.filter((t) => added.some((p) => p.name === t))];
            return {
              ...n,
              selected: true,
              data: { ...n.data, binding, properties: [...n.data.properties, ...added], todo: todo.length ? todo : undefined },
            };
          }),
        );
        return;
      }
      // Basic nodes name themselves (`memory@0`); devices get a generic name.
      const [name, firstAddress] = binding?.node_name?.split("@") ?? [binding ? genericNodeName(binding) : "node"];
      let unitAddress = firstAddress;
      if (binding?.node_name) {
        // Siblings in the scope the node goes to: a single node such as
        // `chosen` is selected instead of added twice, and a numbered one
        // takes the next free unit address (`cpu@1`).
        const parentId = scopeRef.current;
        const siblingIds = new Set(
          edgesRef.current.filter((e) => e.sourceHandle === CHILD_HANDLE && e.source === parentId).map((e) => e.target),
        );
        const siblings = nodesRef.current.filter((n): n is DtFlowNode => isDtNode(n) && siblingIds.has(n.id) && n.data.name === name);
        if (firstAddress === undefined && siblings.length > 0) {
          setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === siblings[0].id })));
          return;
        }
        if (firstAddress !== undefined) {
          const taken = new Set(siblings.map((n) => n.data.unitAddress));
          let i = 0;
          while (taken.has(i.toString(16))) i++;
          unitAddress = i.toString(16);
        }
      }
      const node: DtFlowNode = {
        id,
        type: "dt",
        position: at,
        data: {
          name,
          ...(unitAddress !== undefined ? { unitAddress } : {}),
          compatible: binding?.compatibles?.slice(0, 1) ?? [],
          properties: initial?.properties ?? [],
          binding: binding ?? undefined,
          todo: initial?.todo.length ? initial.todo : undefined,
        },
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
      // A new node is a child of the scope it is created or dropped in.
      const parent = scopeRef.current;
      if (parent && name !== "/") {
        setEdges((es) => [
          ...es,
          { id: newId("e"), source: parent, target: id, sourceHandle: CHILD_HANDLE, targetHandle: PARENT_HANDLE },
        ]);
      }
    },
    [screenToFlowPosition, setNodes, setEdges],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const entry = JSON.parse(raw) as LibraryEntry;
      // The empty node has no binding; any other entry needs its schema.
      entryBinding(entry).then((b) => (b || !entry.path) && addNode(b, at), () => {});
    },
    [addNode, screenToFlowPosition],
  );

  const onBeforeDelete: OnBeforeDelete<FlowNode, Edge> = useCallback(
    async ({ nodes: del, edges: delEdges }) => {
      const ids = new Set(del.filter((n) => !(isDtNode(n) && n.data.name === "/")).map((n) => n.id));
      const isChildEdge = (e: Edge) => e.sourceHandle === CHILD_HANDLE;
      // Deleting a node deletes its subtree, as /delete-node/ does: children
      // left without a parent could not be exported.
      const stack = [...ids];
      while (stack.length > 0) {
        const id = stack.pop()!;
        for (const e of edges) {
          if (isChildEdge(e) && e.source === id && !ids.has(e.target)) {
            ids.add(e.target);
            stack.push(e.target);
          }
        }
      }
      const removed = nodes.filter((n) => ids.has(n.id));
      // Export deletes only the topmost inherited nodes; their subtrees go with them.
      const parentOf = (id: string) => edges.find((e) => isChildEdge(e) && e.target === id)?.source;
      const deleted = removed
        .filter(isDtNode)
        .filter((n) => n.data.inherited && !ids.has(parentOf(n.id) ?? ""))
        .map(deletionTarget);
      if (deleted.length > 0) {
        setExtras((x) => ({ ...x, deleted_nodes: [...(x.deleted_nodes ?? []), ...deleted] }));
      }
      // An inherited node keeps its parent while it exists.
      const inheritedIds = new Set(nodes.filter((n) => isDtNode(n) && n.data.inherited).map((n) => n.id));
      const removedEdges = new Set(
        delEdges.filter((e) => !(isChildEdge(e) && inheritedIds.has(e.target) && !ids.has(e.target))).map((e) => e.id),
      );
      return {
        nodes: removed,
        edges: edges.filter((e) => removedEdges.has(e.id) || ids.has(e.source) || ids.has(e.target)),
      };
    },
    [nodes, edges],
  );

  const groupSelection = () => {
    const members = selectedNodes.filter((n) => !n.parentId);
    if (members.length === 0) return;
    const minX = Math.min(...members.map((n) => n.position.x)) - GROUP_PADDING;
    const minY = Math.min(...members.map((n) => n.position.y)) - GROUP_PADDING;
    const maxX = Math.max(...members.map((n) => n.position.x + (n.measured?.width ?? 180))) + GROUP_PADDING;
    const maxY = Math.max(...members.map((n) => n.position.y + (n.measured?.height ?? 60))) + GROUP_PADDING;
    const group: GroupFlowNode = {
      id: newId("g"),
      type: "group",
      position: { x: minX, y: minY },
      style: { width: maxX - minX, height: maxY - minY },
      data: { title: "Group" },
    };
    const ids = new Set(members.map((m) => m.id));
    setNodes((ns) => [
      group,
      ...ns.map((n) =>
        ids.has(n.id)
          ? { ...n, parentId: group.id, selected: false, position: { x: n.position.x - minX, y: n.position.y - minY } }
          : n,
      ),
    ]);
  };

  const ungroupSelection = () => {
    const groups = selectedNodes.filter((n) => n.type === "group");
    if (groups.length === 0) return;
    const byId = new Map(groups.map((g) => [g.id, g]));
    setNodes((ns) =>
      ns
        .filter((n) => !byId.has(n.id))
        .map((n) => {
          const g = n.parentId ? byId.get(n.parentId) : undefined;
          if (!g) return n;
          return {
            ...n,
            parentId: g.parentId,
            position: { x: n.position.x + g.position.x, y: n.position.y + g.position.y },
          };
        }),
    );
  };

  const loadDesign = async ({ load, path, name }: DesignSource) => {
    try {
      const d = fromDesign(await load());
      history.reset();
      setTitle(name);
      setFresh(false);
      setNodes(d.nodes);
      setEdges(d.edges);
      setExtras(d.extras);
      setOverriding(new Set());
      setShowApplied(false);
      setDesignPath(path);
      setBuild(null);
      setOpenScopes([]);
      setScopeTab(null);
      requestAnimationFrame(() => fitView({ maxZoom: 1 }));
    } catch (e) {
      setErrors([failure(String(e))]);
    }
  };

  const autoLayout = async () => {
    try {
      const d = fromDesign(await backend.autoLayout(toDesign(nodes, edges)));
      // Keep editor-only data (bindings) that the design file does not carry.
      const old = new Map(nodes.map((n) => [n.id, n]));
      setNodes(d.nodes.map((n) => (isDtNode(n) ? { ...n, data: { ...n.data, binding: (old.get(n.id) as DtFlowNode | undefined)?.data.binding, todo: (old.get(n.id) as DtFlowNode | undefined)?.data.todo } } : n)));
      // The routes were for the old places: references go back to curves.
      setEdges((es) => es.map((e) => (e.type === "ref" && (e.data as RefData).route !== undefined ? { ...e, data: withoutRoute(e.data as RefData) } : e)));
      setTimeout(() => fitView({ maxZoom: 1, duration: 300 }), 50);
    } catch (e) {
      setErrors([failure(String(e))]);
    }
  };

  /** The drawn top-level node of `id`: itself, or the group frame around it. */
  const topOf = (id: string, byId: Map<string, FlowNode>) => {
    let n = byId.get(id);
    while (n?.parentId) n = byId.get(n.parentId);
    return n;
  };
  const boxOf = (n: FlowNode): Box => ({
    id: n.id,
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? n.width ?? 200,
    height: n.measured?.height ?? n.height ?? 80,
  });

  /**
   * Tidies the canvas on show, or the selection on it (US-9.5): columns
   * along the references, which then turn at right angles. Positions and
   * routes change in one edit, so one undo restores both.
   */
  const tidy = (onlySelected: boolean) => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const tops = onlySelected ? tidyable() : nodes.filter((n) => shown.has(n.id) && !n.parentId);
    if (tops.length < (onlySelected ? 2 : 1)) return;
    const ids = new Set(tops.map((n) => n.id));
    const links: Link[] = [];
    for (const e of edges) {
      if (e.type !== "ref") continue;
      const s = topOf(e.source, byId)?.id;
      const t = topOf(e.target, byId)?.id;
      if (s && t && s !== t && ids.has(s) && ids.has(t)) links.push({ id: e.id, source: s, target: t });
    }
    const boxes = tops.map(boxOf);
    const { positions, routes } = layered(boxes, links, cornerOf(boxes));
    place(positions);
    // A reference into or out of what moved without a route of its own
    // would turn in the wrong place: it goes back to a curve.
    const moved = (id: string) => ids.has(topOf(id, byId)?.id ?? "");
    setEdges((es) =>
      es.map((e) => {
        if (e.type !== "ref") return e;
        const data = e.data as RefData;
        const route = routes.get(e.id);
        if (route !== undefined) return { ...e, data: { ...data, route } };
        if (data.route !== undefined && (moved(e.source) || moved(e.target))) return { ...e, data: withoutRoute(data) };
        return e;
      }),
    );
    if (!onlySelected) setTimeout(() => fitView({ maxZoom: 1, duration: 300 }), 50);
  };

  /** The selected top-level nodes on show, which tidying the selection moves. */
  const tidyable = () => nodes.filter((n) => n.selected && !n.parentId && shown.has(n.id));

  /** The selected nodes that share one frame, which moving them keeps. */
  const arrangeable = () => {
    const sel = nodes.filter((n) => n.selected && shown.has(n.id));
    return sel.filter((n) => n.parentId === sel[0]?.parentId);
  };
  const place = (positions: Map<string, { x: number; y: number }>) =>
    setNodes((ns) => ns.map((n) => (positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n)));
  const alignSelection = (how: Alignment) => place(align(arrangeable().map(boxOf), how));
  const distributeSelection = (axis: "horizontal" | "vertical") => place(distribute(arrangeable().map(boxOf), axis));

  const openDesign = async () => {
    const path = await dialogs.pickDesignToOpen();
    if (path) onOpen({ load: () => backend.openDesign(path), path, name: baseName(path) });
  };

  const importDts = async () => {
    const path = await dialogs.pickDtsToOpen();
    if (path) onOpen({ load: () => backend.importDts(path), path: null, name: baseName(path) });
  };

  const saveDesign = async () => {
    const path = await dialogs.pickDesignToSave();
    if (!path) return false;
    try {
      // The design is now built against the library's kernel.
      const version = kernel?.version ?? extras.kernel;
      await backend.saveDesign(path, { ...toDesign(nodes, edges, extras), kernel: version });
      markSaved();
      setExtras((x) => ({ ...x, kernel: version }));
      setDesignPath(path);
      setTitle(baseName(path));
      return true;
    } catch (e) {
      setErrors([failure(String(e))]);
      return false;
    }
  };
  const apiRef = useRef<EditorApi | null>(null);
  apiRef.current = { addNode: (b) => addNode(b), load: loadDesign, save: saveDesign };
  useEffect(() => {
    api({
      addNode: (b) => apiRef.current!.addNode(b),
      load: (source) => apiRef.current!.load(source),
      save: () => apiRef.current!.save(),
    });
  }, [api]);

  const newOverlay = async () => {
    const base = await dialogs.pickOverlayBase();
    if (base) onOpen({ load: () => backend.newOverlay(base), path: null, name: `${baseName(base).replace(/\.[^.]*$/, "")} overlay` });
  };

  const exportDts = async () => {
    if (!dts) return;
    const path = await (extras.overlay ? dialogs.pickDtsoToSave() : dialogs.pickDtsToSave());
    // What the editor shows, comments and all, when the design came from it.
    const text = edited.current?.key === schemaKey ? edited.current.text : dts;
    if (path) await backend.writeText(path, text);
  };

  const buildDtb = async () => {
    const extension = extras.overlay ? ".dtbo" : ".dtb";
    const target = designPath
      ? designPath.replace(/\.[^./\\]*$/, "") + extension
      : await (extras.overlay ? dialogs.pickDtboToSave() : dialogs.pickDtbToSave());
    if (!target) return;
    setBuild({ running: true, problems: [] });
    showPanel("build");
    try {
      const result = await backend.buildDtb(toDesign(nodes, edges, extras), target);
      setBuild({
        running: false,
        output: result.output ?? undefined,
        message: result.log,
        problems: result.problems,
        key: schemaKey,
      });
    } catch (e) {
      setBuild({ running: false, message: String(e), problems: [], key: schemaKey });
    }
  };

  const buildStale = !!build && !build.running && build.key !== schemaKey;

  const focusNode = (id: string) => {
    // A node in another scope is shown there; a scope's own node is its tab.
    const away = id !== scope && !inScope(id, scope, main, parents);
    if (away) showScope(scopeOf(id, main, parents), false);
    // A node inside a collapsed group is not drawn: open the group first.
    const closed = new Set(collapsedAncestors(nodes, id));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setNodes((ns) =>
      ns.map((n) => {
        const opened = closed.has(n.id) && isGroupNode(n) ? toggleCollapsed(n) : n;
        return opened.selected === (n.id === id) ? opened : ({ ...opened, selected: n.id === id } as FlowNode);
      }),
    );
    if (id === scope) return;
    if (closed.size || away) setTimeout(() => fitView({ nodes: [{ id }], maxZoom: 1 }), 60);
    else fitView({ nodes: [{ id }], maxZoom: 1, duration: 300 });
  };

  const nodeName = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !isDtNode(node)) return undefined;
    return node.data.unitAddress ? `${node.data.name}@${node.data.unitAddress}` : node.data.name;
  };

  // Dragging changes positions, not what is shown: keep the edges array the
  // same object then, so React Flow does not redo every edge each frame.
  const shown = scopeIds(nodes, scope, main, parents);
  const shownKey = [...shown].join(" ");
  // References that leave the scope end at boundary ports (US-16.2); their
  // edges do not depend on positions, the ports' places do.
  const boundaryCache = useRef(new Map<string, FlowNode>());
  const shownEdges = useMemo(
    () => [...scopeEdges(portEdges, shown), ...boundaryPorts(portEdges, shown, () => undefined, () => "").edges],
    [portEdges, shownKey],
  );
  const view = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Where a drawn node sits on the canvas: group members are relative.
    const boxOf = (id: string) => {
      const n = byId.get(id);
      if (!n || !isDtNode(n)) return undefined;
      let { x, y } = n.position;
      for (let g = n.parentId ? byId.get(n.parentId) : undefined; g; g = g.parentId ? byId.get(g.parentId) : undefined) {
        x += g.position.x;
        y += g.position.y;
      }
      return { x, y, width: n.measured?.width ?? 200, height: n.measured?.height ?? 80 };
    };
    const portTitle = (id: string) => {
      const n = byId.get(id);
      if (!n || !isDtNode(n)) return id;
      if (n.data.label) return `&${n.data.label}`;
      return n.data.unitAddress ? `${n.data.name}@${n.data.unitAddress}` : n.data.name;
    };
    // Unchanged ports keep their object, so React Flow leaves them alone.
    const cache = boundaryCache.current;
    const ports = boundaryPorts(portEdges, shown, boxOf, portTitle).nodes.map((p) => {
      const old = cache.get(p.id) as typeof p | undefined;
      const same =
        old && old.position.x === p.position.x && old.position.y === p.position.y && old.data.title === p.data.title;
      const node = (same ? old : p) as unknown as FlowNode;
      cache.set(p.id, node);
      return node;
    });
    const drawn = [...nodes.filter((n) => shown.has(n.id)), ...ports];
    // A bus controller's scope hangs its devices from a bus bar (US-16.3).
    const controller = scope ? byId.get(scope) : undefined;
    const kind = controller && isDtNode(controller) ? busKind(controller) : null;
    if (controller && isDtNode(controller) && kind) {
      const devices = drawn.filter((n): n is DtFlowNode => isDtNode(n) && inScope(n.id, scope, main, parents));
      const name = nodeName(controller.id) ?? controller.id;
      const title = controller.data.label ? `${name} · &${controller.data.label}` : name;
      const bar = busBar(controller, kind, title, devices, boxOf);
      return collapseView([...drawn, bar.node as unknown as FlowNode], [...shownEdges, ...bar.edges], (id) => nodeName(id) ?? id);
    }
    return collapseView(drawn, shownEdges, (id) => nodeName(id) ?? id);
  }, [nodes, portEdges, shownEdges, shownKey, scope]);

  /**
   * Shows `id`'s scope (null: the main canvas). `pin` keeps a tab for it;
   * without, as when following the DTS cursor, the scope is shown in a
   * passing tab that the next one replaces.
   */
  function showScope(id: string | null, pin = true) {
    const tab = id === main ? null : id;
    if (id === scope) {
      if (pin && tab !== null) setOpenScopes((s) => (s.includes(tab) ? s : [...s, tab]));
      return;
    }
    if (pin && tab !== null) setOpenScopes((s) => (s.includes(tab) ? s : [...s, tab]));
    setScopeTab(tab);
    // What was selected elsewhere is not on show any more.
    setNodes((ns) => ns.map((n) => (n.selected && !inScope(n.id, id, main, parents) ? ({ ...n, selected: false } as FlowNode) : n)));
    setTimeout(() => fitView({ maxZoom: 1 }), 30);
  }
  const closeScope = (id: string) => {
    setOpenScopes((s) => s.filter((x) => x !== id));
    if (scopeTab === id) showScope(main);
  };
  const childCount = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of parents.values()) count.set(p, (count.get(p) ?? 0) + 1);
    return count;
  }, [parents]);
  // The navigator opens down to whatever is selected, wherever it was
  // selected; the root is always open.
  const selectedKey = nodes.filter((n) => n.selected).map((n) => n.id).join(" ");
  useEffect(() => {
    const ids = selectedKey ? selectedKey.split(" ") : [];
    const up = new Set<string>(main ? [main] : []);
    for (const id of ids) for (let p = parents.get(id); p; p = parents.get(p)) up.add(p);
    if ([...up].some((id) => !expanded.has(id))) setExpanded((s) => new Set([...s, ...up]));
  }, [selectedKey, main, parents]);
  // Rows change with the tree and the names, not with positions.
  const treeKey = nodes.map((n) => (isDtNode(n) ? `${n.id}=${n.data.name}` : "")).join(" ");
  const navRows = useMemo(() => treeRows(nodes, edges, expanded), [edges, expanded, treeKey]);
  const navNodes = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /** Double-click (D7): open a node that holds others, edit the rest. */
  const openNode = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !isDtNode(node)) return;
    if (canHaveChildren(node, childCount.has(id))) return showScope(id);
    editNode(id);
  };
  /** Selects `id` and puts the cursor in its properties in the inspector. */
  const editNode = (id: string) => {
    // From the navigator the node may be elsewhere: go to it first.
    if (id === scope || inScope(id, scope, main, parents)) selectOnly([id]);
    else focusNode(id);
    onLayout((l) => (l.inspector.open ? l : { ...l, inspector: { ...l.inspector, open: true } }));
    setTimeout(() => document.querySelector<HTMLElement>(".inspector textarea")?.focus(), 30);
  };
  // With nothing selected, the inspector shows the scope's own node (the
  // root on the main canvas), which is not drawn.
  const inspected =
    selectedNodes.length === 1
      ? selectedNodes[0]
      : selectedNodes.length === 0 && !selectedEdge && scope
        ? (nodes.find((n) => n.id === scope) ?? null)
        : null;
  const inspectedParent = nodes.find((n) => n.id === edges.find((e) => e.sourceHandle === CHILD_HANDLE && e.target === inspected?.id)?.source);
  const inspectedRegCells = inspectedParent && isDtNode(inspectedParent) ? regEntryCells(inspectedParent.data.properties) : undefined;
  // Its references, which its property table lists with the properties.
  const inspectedRefs = edges
    .filter((e) => e.type === "ref" && e.source === inspected?.id && e.data)
    .map((e) => {
      const data = e.data as RefData;
      const target = nodes.find((n) => n.id === e.target);
      const dt = target && isDtNode(target) ? target : undefined;
      return {
        id: e.id,
        property: data.property,
        target: dt?.data.label ? `&${dt.data.label}` : (nodeName(e.target) ?? e.target),
        args: data.args ?? [],
        expected: dt ? specifierCount(dt.data, data.property) : undefined,
      };
    });
  const passing = scope !== main && scope !== null && !liveScopes.includes(scope) ? scope : null;
  const scopeTitle = (id: string | null) => (id === null ? "Top level" : id === main ? "/" : (nodeName(id) ?? id));
  const tabOf = (id: string | null) => ({ id: id === main ? null : id, title: scopeTitle(id) });


  const showPanel = (tab: PanelTab) => onLayout((l) => ({ ...l, panel: { ...l.panel, open: true, tab } }));
  /** Shows `tab`, or closes the panel when that tab is already on show. */
  const togglePanel = (tab: PanelTab) =>
    onLayout((l) => ({ ...l, panel: { ...l.panel, open: !(l.panel.open && l.panel.tab === tab), tab } }));
  const togglePane = (pane: PaneName) => onLayout((l) => ({ ...l, [pane]: { ...l[pane], open: !l[pane].open } }));

  const placeOnBoard = (positions: Map<string, XYPosition | null>) =>
    setNodes((ns) =>
      ns.map((n) =>
        isDtNode(n) && positions.has(n.id)
          ? ({ ...n, data: { ...n.data, boardPosition: positions.get(n.id) ?? undefined } } as FlowNode)
          : n,
      ),
    );
  const selectOnly = (ids: string[]) => {
    const wanted = new Set(ids);
    setNodes((ns) => ns.map((n) => (!!n.selected === wanted.has(n.id) ? n : ({ ...n, selected: wanted.has(n.id) } as FlowNode))));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
  };

  // Every toolbar action as a command (US-9.3), with its shortcut.
  const dtTitle = (n: DtFlowNode) => {
    const name = n.data.unitAddress ? `${n.data.name}@${n.data.unitAddress}` : n.data.name;
    return n.data.label ? `${n.data.label}: ${name}` : name;
  };
  const selectedDt = selectedNodes.filter(isDtNode);
  const pickNode = (title: string, onPick: (id: string) => void, exclude = new Set<string>()): NodePick => ({
    title,
    nodes: nodes
      .filter(isDtNode)
      .filter((n) => n.id !== selectedDt[0]?.id && !exclude.has(n.id))
      .map((n) => ({ id: n.id, title: dtTitle(n) })),
    onPick,
  });
  /** `id`'s subtree, which cannot become its parent. */
  const subtreeOf = (id: string) => {
    const found = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of edges) {
        if (e.sourceHandle === CHILD_HANDLE && found.has(e.source) && !found.has(e.target)) {
          found.add(e.target);
          grew = true;
        }
      }
    }
    return found;
  };
  // Structural errors block the build; schema problems are errors or warnings.
  const problemCount = {
    errors: errors.length + (schema.problems ?? []).filter((p) => p.severity === "error").length,
    warnings: (schema.problems ?? []).filter((p) => p.severity !== "error").length,
  };
  // Every action of the editor. Menus, toolbar, palette and shortcuts all
  // read this list; see commands.ts.
  // What the arrange commands would move, for their enabled state; only
  // the selection matters, so most renders skip the scan.
  const anySelected = nodes.some((n) => n.selected);
  const arrangeCount = anySelected ? arrangeable().length : 0;
  const tidyCount = anySelected ? tidyable().length : 0;
  const registry: Command[] = [
    { id: "new", title: "New design", shortcut: "Ctrl+N", menu: "File", icon: FilePlus, run: onNew },
    {
      id: "soc",
      title: "New board from SoC…",
      menu: "File",
      hint: "Start a board from a SoC .dtsi of the loaded kernel tree",
      disabled: !inTauri,
      run: () => setPickingSoc(true),
    },
    {
      id: "overlay",
      title: "New overlay…",
      menu: "File",
      hint: "Start an overlay (.dtso) for a design or board file",
      disabled: !inTauri,
      run: newOverlay,
    },
    { id: "open", title: "Open design…", shortcut: "Ctrl+O", menu: "File", group: 1, icon: FolderOpen, disabled: !inTauri, run: openDesign },
    { id: "import", title: "Import .dts…", menu: "File", group: 1, disabled: !inTauri, run: importDts },
    { id: "save", title: "Save design…", shortcut: "Ctrl+S", menu: "File", group: 2, icon: Save, disabled: !inTauri, run: saveDesign },
    {
      id: "export",
      title: "Export .dts…",
      shortcut: "Ctrl+E",
      menu: "File",
      group: 2,
      hint: sourceError ? "Fix the error in the DTS source first" : undefined,
      disabled: !inTauri || !dts || errors.length > 0 || sourceError !== null,
      run: exportDts,
    },
    { id: "settings", title: "Settings…", shortcut: "Ctrl+,", menu: "File", group: 3, run: () => onOpenSettings("General") },
    { id: "undo", title: "Undo", shortcut: "Ctrl+Z", menu: "Edit", icon: Undo2, disabled: !history.canUndo, run: history.undo },
    { id: "redo", title: "Redo", shortcut: "Ctrl+Shift+Z", menu: "Edit", icon: Redo2, disabled: !history.canRedo, run: history.redo },
    {
      id: "move",
      title: "Move selected node under…",
      menu: "Edit",
      group: 1,
      disabled: selectedDt.length !== 1 || selectedDt[0].data.name === "/",
      run: () =>
        pickNode(
          "New parent",
          (parent) => {
            onConnect({ source: parent, sourceHandle: CHILD_HANDLE, target: selectedDt[0].id, targetHandle: PARENT_HANDLE });
            // It leaves this scope: drop it from the selection rather than act on a node out of sight.
            if (parent !== scope) selectOnly([]);
          },
          subtreeOf(selectedDt[0].id),
        ),
    },
    {
      id: "group",
      title: "Group selection",
      shortcut: "Ctrl+G",
      menu: "Edit",
      group: 1,
      disabled: !selectedNodes.some((n) => !n.parentId),
      run: groupSelection,
    },
    {
      id: "ungroup",
      title: "Ungroup",
      shortcut: "Ctrl+Shift+G",
      menu: "Edit",
      group: 1,
      disabled: !selectedNodes.some((n) => n.type === "group"),
      run: ungroupSelection,
    },
    {
      id: "tidy",
      title: "Tidy this canvas",
      shortcut: "Ctrl+L",
      menu: "Arrange",
      hint: "Columns along the references, which turn at right angles",
      icon: LayoutDashboard,
      disabled: boardView,
      run: () => tidy(false),
    },
    {
      id: "tidy-selection",
      title: "Tidy the selection",
      shortcut: "Ctrl+Shift+L",
      menu: "Arrange",
      disabled: boardView || tidyCount < 2,
      run: () => tidy(true),
    },
    {
      id: "layout",
      title: "Lay out the whole tree",
      menu: "Arrange",
      hint: "Arranges the whole tree from the root down, as on import",
      icon: Workflow,
      disabled: !inTauri || boardView,
      run: autoLayout,
    },
    ...(
      [
        ["left", "Align left edges", AlignStartVertical],
        ["center", "Align centres", AlignCenterVertical],
        ["right", "Align right edges", AlignEndVertical],
        ["top", "Align top edges", AlignStartHorizontal],
        ["middle", "Align middles", AlignCenterHorizontal],
        ["bottom", "Align bottom edges", AlignEndHorizontal],
      ] as const
    ).map(([how, title, icon]) => ({
      id: `align-${how}`,
      title,
      menu: "Arrange" as const,
      group: how === "left" || how === "center" || how === "right" ? 1 : 2,
      icon,
      disabled: boardView || arrangeCount < 2,
      run: () => alignSelection(how),
    })),
    {
      id: "distribute-horizontal",
      title: "Distribute horizontally",
      menu: "Arrange",
      group: 3,
      icon: AlignHorizontalSpaceAround,
      disabled: boardView || arrangeCount < 3,
      run: () => distributeSelection("horizontal"),
    },
    {
      id: "distribute-vertical",
      title: "Distribute vertically",
      menu: "Arrange",
      group: 3,
      icon: AlignVerticalSpaceAround,
      disabled: boardView || arrangeCount < 3,
      run: () => distributeSelection("vertical"),
    },

    { id: "palette", title: "Command palette…", shortcut: "Ctrl+K", menu: "View", run: () => setShowPalette(true) },
    {
      id: "open-scope",
      title: "Open selected node",
      menu: "View",
      hint: "Show its children (double-click does the same)",
      disabled: selectedDt.length !== 1,
      run: () => openNode(selectedDt[0].id),
    },
    {
      id: "up-scope",
      title: "Up one scope",
      menu: "View",
      disabled: scope === main,
      run: () => showScope(scope === null ? main : scopeOf(scope, main, parents)),
    },
    {
      id: "outline",
      title: "Outline",
      shortcut: "Ctrl+Shift+O",
      menu: "View",
      group: 2,
      hint: "The whole devicetree as a tree, in the side bar",
      checked: layout.library.open && layout.library.view === "outline",
      run: () =>
        onLayout((l) => {
          const shown = l.library.open && l.library.view === "outline";
          return { ...l, library: { ...l.library, open: true, view: shown ? "library" : "outline" } };
        }),
    },
    { id: "mode-graph", title: "Graph", shortcut: "Ctrl+1", menu: "View", group: 1, checked: mode === "graph", run: () => setMode("graph") },
    {
      id: "mode-split",
      title: "Graph and DTS source",
      shortcut: "Ctrl+2",
      menu: "View",
      group: 1,
      checked: mode === "split",
      run: () => setMode("split"),
    },
    { id: "mode-dts", title: "DTS source", shortcut: "Ctrl+3", menu: "View", group: 1, checked: mode === "dts", run: () => setMode("dts") },
    {
      id: "library",
      title: "Library",
      shortcut: PANE_SHORTCUTS.library,
      menu: "View",
      group: 2,
      checked: layout.library.open,
      run: () => togglePane("library"),
    },
    {
      id: "inspector",
      title: "Inspector",
      shortcut: PANE_SHORTCUTS.inspector,
      menu: "View",
      group: 2,
      checked: layout.inspector.open,
      run: () => togglePane("inspector"),
    },
    { id: "panel", title: "Bottom panel", shortcut: "Ctrl+J", menu: "View", group: 2, checked: layout.panel.open, run: () => togglePane("panel") },
    {
      id: "problems",
      title: "Problems",
      shortcut: "Ctrl+Shift+M",
      menu: "View",
      group: 3,
      checked: panelTab === "problems",
      run: () => togglePanel("problems"),
    },
    { id: "build-output", title: "Build output", menu: "View", group: 3, checked: panelTab === "build", run: () => togglePanel("build") },
    {
      id: "board",
      title: "Board view",
      menu: "View",
      hint: "Place devices where they sit on the board",
      checked: boardView,
      group: 4,
      run: () => setBoardView((v) => !v),
    },
    {
      id: "interrupts",
      title: "Interrupt tree",
      menu: "View",
      group: 3,
      checked: showInterrupts,
      disabled: !inTauri,
      run: () => togglePanel("interrupts"),
    },
    {
      id: "address-map",
      title: "Address map",
      menu: "View",
      group: 3,
      checked: showAddressMap,
      disabled: !inTauri,
      run: () => togglePanel("address-map"),
    },
    { id: "fit", title: "Fit the design in view", menu: "View", group: 4, run: () => fitView({ maxZoom: 1, duration: 300 }) },
    { id: "add", title: "Empty node", menu: "Insert", icon: SquarePlus, hint: "Add a node with no binding", run: () => addNode(null) },
    {
      id: "connect",
      title: "Reference from selected node to…",
      menu: "Insert",
      disabled: selectedDt.length !== 1,
      run: () =>
        pickNode("Node to reference", (target) =>
          onConnect({ source: selectedDt[0].id, sourceHandle: REF_HANDLE, target, targetHandle: PHANDLE_HANDLE }),
        ),
    },
    {
      id: "build",
      title: "Build .dtb",
      shortcut: "Ctrl+B",
      menu: "Tools",
      icon: Hammer,
      disabled: !inTauri || errors.length > 0,
      run: buildDtb,
    },
    {
      id: "kernels",
      title: "Kernel checkouts…",
      menu: "Tools",
      group: 1,
      hint: "Kernel checkouts the library can be built from (Settings › Kernel)",
      disabled: !inTauri,
      run: () => onOpenSettings("Kernel"),
    },
    {
      id: "dtc",
      title: "Set dtc path…",
      menu: "Tools",
      group: 1,
      hint: "Use a dtc program that is not in PATH (Settings › Build)",
      disabled: !inTauri,
      run: () => onOpenSettings("Build"),
    },
    { id: "shortcuts", title: "Keyboard shortcuts", shortcut: "F1", menu: "Help", run: () => setShowShortcuts(true) },
    { id: "updates", title: "Check for updates now", menu: "Help", disabled: !inTauri, run: onCheckUpdates },
  ];
  const commands = withShortcuts(registry, settings.shortcuts, FIXED_SHORTCUTS);
  const byId = (id: string) => commands.find((c) => c.id === id)!;
  const shortcutList: [string, string][] = [
    ...commands.filter((c) => c.shortcut).map((c): [string, string] => [c.shortcut!, c.title.replace(/…$/, "")]),
    ["Ctrl+Y", "Redo"],
    ["Ctrl+C", "Copy the selected nodes"],
    ["Ctrl+V", "Paste into the scope on show"],
    ["Ctrl+Tab", "Next tab (Ctrl+Shift+Tab: previous)"],
    ["Ctrl+W", "Close the tab"],
    ["Alt+letter", "Open a menu (Alt+F: File)"],
    ["Delete", "Delete the selection"],
    ["Shift+drag", "Select an area"],
  ];
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const combo = comboOf(e);
      // Undo and redo have their own handler, which knows about text fields.
      if (!combo || combo === "Ctrl+Z" || combo === "Ctrl+Shift+Z") return;
      const command = commandsRef.current.find((c) => c.shortcut === combo);
      if (!command) return;
      // Save works from a text field too; the rest belong to the canvas.
      const target = e.target as HTMLElement | null;
      const inText = !!target?.closest(`${TEXT_INPUTS}, textarea, select, [contenteditable], .cm-editor`);
      if (inText && command.id !== "save") return;
      e.preventDefault();
      if (!command.disabled) command.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const updateNodeData = (id: string, data: object) =>
    setNodes((ns) => {
      const next = ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...data } } as FlowNode) : n));
      // Values that name the label (`serial0 = &uart0`) follow its rename, as
      // reference edges do. Not to an empty label or one another node has:
      // the field commits as the user types.
      const before = ns.find((n) => n.id === id);
      const from = before && isDtNode(before) ? before.data.label : undefined;
      const to = (data as { label?: string }).label;
      if (!from || !to || from === to || !("label" in data)) return next;
      if (ns.some((n) => n.id !== id && isDtNode(n) && (n.data.label === to || n.data.extraLabels?.includes(to)))) return next;
      const labels = new Map([[from, to]]);
      return next.map((n) =>
        isDtNode(n) && n.data.properties.some((p) => p.value.type === "mixed")
          ? { ...n, data: { ...n.data, properties: n.data.properties.map((p) => ({ ...p, value: renameLabels(p.value, labels) })) } }
          : n,
      );
    });
  const updateEdgeData = (id: string, data: RefData) =>
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data } : e)));

  return (
    <div className="editor" hidden={!active}>
      <header className="toolbar">
        <div className="menubar-row">
          <span className="brand">DesignTree</span>
          <MenuBar
            commands={commands}
            active={active}
            onRun={(result) => {
              // A command that still needs a node continues in the palette.
              const next = pickOf(result);
              if (next) {
                setPalettePick(next);
                setShowPalette(true);
              }
            }}
          />
        </div>
        <div className="toolbar-row" role="toolbar" aria-label="Main actions">
          {[["new", "open", "save"], ["undo", "redo"], ["add", "tidy"]].map((ids, g) => (
            <div className="tool-group" key={g}>
              {ids.map((id) => {
                const c = byId(id);
                const Icon = c.icon!;
                return (
                  <button
                    key={id}
                    className="tool"
                    aria-label={c.title.replace(/…$/, "")}
                    title={tooltipOf(c)}
                    disabled={c.disabled}
                    onClick={() => c.run()}
                  >
                    <Icon size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                );
              })}
            </div>
          ))}
          <button className="command-search" onClick={() => setShowPalette(true)} title={tooltipOf(byId("palette"))}>
            <Search size={14} strokeWidth={2} aria-hidden />
            <span>Search commands and elements</span>
            <kbd>Ctrl+K</kbd>
          </button>
          {(() => {
            const build = byId("build");
            return (
              <button className="primary tool-primary" title={tooltipOf(build)} disabled={build.disabled} onClick={() => build.run()}>
                <Hammer size={16} strokeWidth={2} aria-hidden />
                Build .dtb
              </button>
            );
          })()}
        </div>
      </header>
      <main className={`canvas mode-${mode}`}>
        <ModeSwitch mode={mode} onMode={setMode} />
        <div ref={canvasRef} className="graph" hidden={mode === "dts"} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          {kernelWarning && (
            <div className="kernel-warning" role="alert">
              This design was edited against Linux {extras.kernel}, but the library is built from Linux {kernel?.version}.
              Bindings may differ; pick another checkout under Kernels…
            </div>
          )}
          {active &&
          outlineSlot &&
          createPortal(
            <Navigator
              rows={navRows}
              nodes={navNodes}
              selected={new Set(selectedKey ? selectedKey.split(" ") : [])}
              onToggle={toggleExpanded}
              onSelect={focusNode}
              onOpen={openNode}
            />,
            outlineSlot,
          )}
        {!boardView && (
          <ScopeBar
            tabs={[tabOf(main), ...liveScopes.map(tabOf), ...(passing ? [{ ...tabOf(passing), passing: true }] : [])]}
            active={scope === main ? null : scope}
            path={scopePath(scope, main, parents).map(tabOf)}
            onOpen={(id) => showScope(id ?? main)}
            onSelectScope={() => scope && selectOnly([scope])}
            onClose={closeScope}
          />
        )}
        {boardView ? (
            <BoardView
              colorMode={settings.theme}
              nodes={nodes}
              board={extras.board}
              designPath={designPath}
              onPlace={placeOnBoard}
              onSelect={selectOnly}
              edges={edges}
              pinCheck={pinCheck}
              links={boardLinks}
              onBoardChange={(board) =>
                setExtras((x) => ({ ...x, board: board.background || board.connectors?.length ? board : undefined }))
              }
            />
          ) : (
            <NodeProblems.Provider value={nodeProblems}>
            <NodePorts.Provider value={stablePorts}>
            <ReactFlow
              nodes={view.nodes}
              edges={view.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onBeforeDelete={onBeforeDelete}
              colorMode={settings.theme}
              fitView
              fitViewOptions={{ maxZoom: 1 }}
              minZoom={0.1}
              deleteKeyCode={active ? ["Backspace", "Delete"] : null}
              onNodeDoubleClick={(_, node) => {
                // The bar is the scope's own controller: edit its properties.
                if (node.id.startsWith(BUSBAR_PREFIX)) editNode(node.id.slice(BUSBAR_PREFIX.length));
                else openNode(node.id);
              }}
              onNodeClick={(_, node) => {
                // The bar stands for the scope's controller; a port for its node elsewhere.
                if (node.id.startsWith(BUSBAR_PREFIX)) selectOnly([node.id.slice(BUSBAR_PREFIX.length)]);
                else if (realId(node.id) !== node.id) focusNode(realId(node.id));
              }}
              onConnectEnd={(_, state) => {
                // A reference dropped on empty canvas asks which node it is
                // for, anywhere in the design: the way to reach other scopes.
                if (state.isValid || state.toNode || !state.fromNode || state.fromHandle?.type !== "source") return;
                const source = realId(state.fromNode.id);
                const sourceHandle = state.fromHandle.id ?? REF_HANDLE;
                setPalettePick(
                  pickNode(
                    "Node to reference",
                    (target) => onConnect({ source, sourceHandle, target, targetHandle: PHANDLE_HANDLE }),
                    new Set([source]),
                  ),
                );
                setShowPalette(true);
              }}
              zoomOnDoubleClick={false}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
            </NodePorts.Provider>
            </NodeProblems.Provider>
          )}
        </div>
        {/* Kept mounted in graph mode, so the cursor and scroll stay put. */}
        <div className="source-pane" hidden={mode === "graph"}>
          <DtsPreview
            text={editorText.text}
            textVersion={editorText.version}
            spans={spans}
            selected={selectedNodes.map((n) => n.id)}
            sourceError={sourceError}
            onEdit={onSourceEdit}
            onCursorNode={onCursorNode}
            appliedDts={appliedDts}
            overlayBase={extras.overlay?.base}
            showApplied={showApplied}
            onShowApplied={setShowApplied}
            errors={errors}
          />
        </div>
      </main>
      <div className="pane inspector-pane">
        <div className="pane-body" hidden={!layout.inspector.open}>
          <aside className="panel side">
            <Inspector
              node={inspected}
              references={inspectedRefs}
              edge={selectedNodes.length === 0 ? selectedEdge : null}
              onNodeChange={updateNodeData}
              overriding={overriding}
              onOverride={(id) => setOverriding((s) => new Set(s).add(id))}
              onEdgeChange={updateEdgeData}
              providerCells={providerCells}
              regCells={inspectedRegCells}
            />
          </aside>
          <Splitter
            pane="inspector"
            size={layout.inspector.size}
            label="Inspector width"
            onResize={(size) => onLayout((l) => ({ ...l, inspector: { ...l.inspector, size } }))}
          />
        </div>
        <PaneRail pane="inspector" layout={layout} onLayout={onLayout} />
      </div>
      {layout.panel.open && (
        <BottomPanel
          tabs={[
            { id: "problems", title: "Problems", count: problemCount.errors + problemCount.warnings },
            { id: "build", title: "Build", count: buildStale ? undefined : build?.problems.length },
            { id: "interrupts", title: "Interrupts" },
            { id: "address-map", title: "Address map" },
          ]}
          tab={layout.panel.tab}
          size={layout.panel.size}
          onTab={showPanel}
          onResize={(size) => onLayout((l) => ({ ...l, panel: { ...l.panel, size } }))}
          onClose={() => togglePane("panel")}
        >
          {layout.panel.tab === "problems" && errors.length > 0 && <ProblemList problems={errors} nodeName={nodeName} onFocusNode={focusNode} />}
          {layout.panel.tab === "problems" &&
            (kernel ? (
              <SchemaPanel schema={schema} nodeName={nodeName} onFocusNode={focusNode} />
            ) : (
              <p className="hint">Load a kernel checkout to check the design against its binding schemas.</p>
            ))}
          {layout.panel.tab === "build" &&
            (build ? (
              <BuildPanel build={build} stale={buildStale} nodeName={nodeName} onFocusNode={focusNode} />
            ) : (
              <p className="hint">Build .dtb (Ctrl+B) to see dtc's output here.</p>
            ))}
          {layout.panel.tab === "interrupts" &&
            (!inTauri ? (
              <p className="hint">The interrupt tree needs the desktop app.</p>
            ) : interrupts ? (
              <InterruptPanel tree={interrupts} nodeName={nodeName} onFocusNode={focusNode} />
            ) : (
              <p className="hint">Working out the interrupt tree…</p>
            ))}
          {layout.panel.tab === "address-map" &&
            (!inTauri ? (
              <p className="hint">The address map needs the desktop app.</p>
            ) : addressMap ? (
              <AddressMapPanel map={addressMap} nodeName={nodeName} onFocusNode={focusNode} />
            ) : (
              <p className="hint">Working out the address map…</p>
            ))}
        </BottomPanel>
      )}
      <StatusBar
        kernel={kernel}
        dtcVersion={dtcVersion}
        errors={problemCount.errors}
        warnings={problemCount.warnings}
        nodes={nodes.filter(isDtNode).length}
        selected={selectedNodes.length}
        onKernels={() => onOpenSettings("Kernel")}
        onDtc={() => onOpenSettings("Build")}
        onProblems={() => showPanel("problems")}
      />
      {showPalette && (
        <CommandPalette
          commands={commands}
          library={!!kernel}
          onAdd={(b) => addNode(b)}
          initialPick={palettePick}
          onClose={() => {
            setShowPalette(false);
            setPalettePick(null);
          }}
        />
      )}
      {active && settingsSection && (
        <SettingsPanel
          settings={settings}
          onChange={onSettings}
          saveError={settingsError}
          section={settingsSection}
          onClose={() => onOpenSettings(null)}
          commands={commands}
          defaults={new Map(registry.map((c) => [c.id, c.shortcut]))}
          fixed={FIXED_SHORTCUTS}
          kernelPath={kernel?.path ?? null}
          onUseKernel={onUseKernel}
          onResetLayout={onResetLayout}
          onCheckUpdates={onCheckUpdates}
        />
      )}
      {showShortcuts && <ShortcutSheet shortcuts={shortcutList} onClose={() => setShowShortcuts(false)} />}
      {pickingSoc && (
        <SocPicker
          onClose={() => setPickingSoc(false)}
          onPick={(soc) => {
            setPickingSoc(false);
            onOpen({ load: () => backend.newBoard(soc.path), path: null, name: baseName(soc.path).replace(/\.dtsi$/, "") });
          }}
        />
      )}
    </div>
  );
}
