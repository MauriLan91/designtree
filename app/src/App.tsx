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
import { initialProperties } from "./schemaProps";
import { InterruptPanel } from "./components/InterruptPanel";
import { AddressMapPanel } from "./components/AddressMapPanel";
import { KernelSettings } from "./components/KernelSettings";
import { SocPicker } from "./components/SocPicker";
import { BuildPanel, type BuildState } from "./components/BuildPanel";
import { SchemaPanel, type SchemaState } from "./components/SchemaPanel";
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
import { DRAG_MIME, Palette } from "./components/Palette";
import { RefEdge } from "./components/RefEdge";
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
  type PinCheck,
  type RefData,
} from "./model";

const nodeTypes = { dt: DtNode, group: GroupNode };
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

let nextId = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export default function App() {
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
  const [showApplied, setShowApplied] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  /** File the design was last opened from or saved to; the .dtb goes next to it. */
  const [designPath, setDesignPath] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [schema, setSchema] = useState<SchemaState>({ checking: false, problems: [] });
  const schemaRun = useRef(0);
  const [showInterrupts, setShowInterrupts] = useState(false);
  const [pickingSoc, setPickingSoc] = useState(false);
  const [interrupts, setInterrupts] = useState<InterruptTree | null>(null);
  const [showAddressMap, setShowAddressMap] = useState(false);
  const [boardView, setBoardView] = useState(false);
  const [addressMap, setAddressMap] = useState<AddressMap | null>(null);
  const [pinCheck, setPinCheck] = useState<PinCheck | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLElement>(null);

  const [requestedKernel, setRequestedKernel] = useState<string | null>(null);
  /** The kernel the library is built from. */
  const [kernel, setKernel] = useState<{ path: string; version: string | null } | null>(null);
  const [showKernels, setShowKernels] = useState(false);

  useEffect(() => {
    if (!inTauri) return;
    backend.startupArgs().then((args) => {
      if (args.design) {
        const d = fromDesign(args.design);
        setNodes(d.nodes);
        setEdges(d.edges);
        setExtras(d.extras);
        setDesignPath(args.design_path);
      }
      setRequestedKernel(args.linux_src);
    }, (e) => setErrors([String(e)]));
  }, [setNodes, setEdges]);

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
      setErrors(["Backend not available: run the app with `npm run tauri dev`."]);
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
        if (!stale) setErrors(Array.isArray(e) ? e : [String(e)]);
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
    for (const p of schema.problems ?? []) {
      if (p.node) byNode.set(p.node, [...(byNode.get(p.node) ?? []), p.message]);
    }
    return byNode;
  }, [schema.problems]);

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
  const portCache = useRef(new Map<string, { key: unknown[]; ports: NodePortSet }>());
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
        out.set(n.id, nodePorts(n.data, binding, refs, known));
      }
      portCache.current.set(n.id, { key, ports: out.get(n.id)! });
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
    (c) => {
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
    (c: Connection) => {
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
      const initial = binding ? initialProperties(binding) : null;
      const node: DtFlowNode = {
        id,
        type: "dt",
        position: at,
        data: {
          name: binding ? genericNodeName(binding) : "node",
          compatible: binding?.compatibles?.slice(0, 1) ?? [],
          properties: initial?.properties ?? [],
          binding: binding ?? undefined,
          todo: initial?.todo.length ? initial.todo : undefined,
        },
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
      // New nodes hang off the root so the design stays valid; rewire as needed.
      const root = nodes.find((n) => isDtNode(n) && n.data.name === "/");
      if (root) {
        setEdges((es) => [
          ...es,
          { id: newId("e"), source: root.id, target: id, sourceHandle: CHILD_HANDLE, targetHandle: PARENT_HANDLE },
        ]);
      }
    },
    [nodes, screenToFlowPosition, setNodes, setEdges],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      addNode(JSON.parse(raw) as Binding, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const onBeforeDelete: OnBeforeDelete<FlowNode, Edge> = useCallback(
    async ({ nodes: del, edges: delEdges }) => {
      const ids = new Set(del.filter((n) => !(isDtNode(n) && n.data.name === "/")).map((n) => n.id));
      const isChildEdge = (e: Edge) => e.sourceHandle === CHILD_HANDLE;
      // Deleting an inherited node deletes its subtree, as /delete-node/ does.
      const stack = nodes.filter((n) => ids.has(n.id) && isDtNode(n) && n.data.inherited).map((n) => n.id);
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

  const newDesign = () => {
    const d = fromDesign(emptyDesign());
    setNodes(d.nodes);
    setEdges(d.edges);
    setExtras(d.extras);
    setOverriding(new Set());
    setDesignPath(null);
    setBuild(null);
  };

  const loadDesign = async (load: () => Promise<Design>, path: string | null = null) => {
    try {
      const d = fromDesign(await load());
      setNodes(d.nodes);
      setEdges(d.edges);
      setExtras(d.extras);
      setOverriding(new Set());
      setShowApplied(false);
      setDesignPath(path);
      setBuild(null);
      requestAnimationFrame(() => fitView({ maxZoom: 1 }));
    } catch (e) {
      setErrors([String(e)]);
    }
  };

  const autoLayout = async () => {
    try {
      const d = fromDesign(await backend.autoLayout(toDesign(nodes, edges)));
      // Keep editor-only data (bindings) that the design file does not carry.
      const old = new Map(nodes.map((n) => [n.id, n]));
      setNodes(d.nodes.map((n) => (isDtNode(n) ? { ...n, data: { ...n.data, binding: (old.get(n.id) as DtFlowNode | undefined)?.data.binding, todo: (old.get(n.id) as DtFlowNode | undefined)?.data.todo } } : n)));
      setTimeout(() => fitView({ maxZoom: 1, duration: 300 }), 50);
    } catch (e) {
      setErrors([String(e)]);
    }
  };

  const openDesign = async () => {
    const path = await dialogs.pickDesignToOpen();
    if (path) await loadDesign(() => backend.openDesign(path), path);
  };

  const importDts = async () => {
    const path = await dialogs.pickDtsToOpen();
    if (path) await loadDesign(() => backend.importDts(path));
  };

  const saveDesign = async () => {
    const path = await dialogs.pickDesignToSave();
    if (path) {
      // The design is now built against the library's kernel.
      const version = kernel?.version ?? extras.kernel;
      await backend.saveDesign(path, { ...toDesign(nodes, edges, extras), kernel: version });
      setExtras((x) => ({ ...x, kernel: version }));
      setDesignPath(path);
    }
  };

  const newOverlay = async () => {
    const base = await dialogs.pickOverlayBase();
    if (base) await loadDesign(() => backend.newOverlay(base));
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
    try {
      const result = await backend.buildDtb(toDesign(nodes, edges, extras), target);
      setBuild({
        running: false,
        output: result.output ?? undefined,
        message: result.log,
        problems: result.problems,
      });
    } catch (e) {
      setBuild({ running: false, message: String(e), problems: [] });
    }
  };

  const focusNode = (id: string) => {
    // A node inside a collapsed group is not drawn: open the group first.
    const closed = new Set(collapsedAncestors(nodes, id));
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setNodes((ns) =>
      ns.map((n) => {
        const opened = closed.has(n.id) && isGroupNode(n) ? toggleCollapsed(n) : n;
        return opened.selected === (n.id === id) ? opened : ({ ...opened, selected: n.id === id } as FlowNode);
      }),
    );
    if (closed.size) setTimeout(() => fitView({ nodes: [{ id }], maxZoom: 1 }), 60);
    else fitView({ nodes: [{ id }], maxZoom: 1, duration: 300 });
  };

  const nodeName = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !isDtNode(node)) return undefined;
    return node.data.unitAddress ? `${node.data.name}@${node.data.unitAddress}` : node.data.name;
  };

  const view = useMemo(() => collapseView(nodes, portEdges, (id) => nodeName(id) ?? id), [nodes, portEdges]);

  const chooseDtc = async () => {
    const path = await dialogs.pickDtc();
    if (path) await backend.setDtcPath(path);
  };

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

  const updateNodeData = (id: string, data: object) =>
    setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...data } } as FlowNode) : n)));
  const updateEdgeData = (id: string, data: RefData) =>
    setEdges((es) => es.map((e) => (e.id === id ? { ...e, data } : e)));

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">DesignTree</span>
        <button onClick={newDesign}>New</button>
        <button onClick={() => setPickingSoc(true)} disabled={!inTauri} title="Start a board from a SoC .dtsi of the loaded kernel tree">
          New from SoC…
        </button>
        <button onClick={newOverlay} disabled={!inTauri} title="Start an overlay (.dtso) for a design or board file">
          New overlay…
        </button>
        <button onClick={openDesign} disabled={!inTauri}>Open…</button>
        <button onClick={importDts} disabled={!inTauri}>Import .dts…</button>
        <button onClick={saveDesign} disabled={!inTauri}>Save…</button>
        <button
          onClick={exportDts}
          disabled={!inTauri || !dts || errors.length > 0 || sourceError !== null}
          title={sourceError ? "Fix the error in the DTS source first" : undefined}
        >
          Export .dts…
        </button>
        <button onClick={buildDtb} disabled={!inTauri || errors.length > 0}>Build .dtb</button>
        <button onClick={() => setShowKernels(true)} disabled={!inTauri} title="Kernel checkouts the library can be built from">
          Kernels…
        </button>
        <button onClick={chooseDtc} disabled={!inTauri} title="Use a dtc program that is not in PATH">dtc path…</button>
        <span className="sep" />
        <button onClick={() => setShowInterrupts((v) => !v)} disabled={!inTauri} aria-pressed={showInterrupts}>
          Interrupts
        </button>
        <button onClick={() => setShowAddressMap((v) => !v)} disabled={!inTauri} aria-pressed={showAddressMap}>
          Address map
        </button>
        <button onClick={() => setBoardView((v) => !v)} aria-pressed={boardView} title="Place devices where they sit on the board">
          Board view
        </button>
        <button onClick={autoLayout} disabled={!inTauri || boardView}>Auto layout</button>
        <button onClick={groupSelection} disabled={!selectedNodes.some((n) => !n.parentId)}>Group</button>
        <button onClick={ungroupSelection} disabled={!selectedNodes.some((n) => n.type === "group")}>Ungroup</button>
      </header>
      <Palette onAdd={(b) => addNode(b)} requestedKernel={requestedKernel} onKernelLoaded={(k) => setKernel({ path: k.path, version: k.version })} />
      <main ref={canvasRef} className="canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        {kernelWarning && (
          <div className="kernel-warning" role="alert">
            This design was edited against Linux {extras.kernel}, but the library is built from Linux {kernel?.version}.
            Bindings may differ; pick another checkout under Kernels…
          </div>
        )}
        {boardView ? (
          <BoardView
            nodes={nodes}
            board={extras.board}
            designPath={designPath}
            onPlace={placeOnBoard}
            onSelect={selectOnly}
            edges={edges}
            pinCheck={pinCheck}
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
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            minZoom={0.1}
            deleteKeyCode={["Backspace", "Delete"]}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          </NodePorts.Provider>
          </NodeProblems.Provider>
        )}
      </main>
      <aside className="panel side">
        <Inspector
          node={selectedNodes.length === 1 ? selectedNodes[0] : null}
          edge={selectedNodes.length === 0 ? selectedEdge : null}
          onNodeChange={updateNodeData}
          overriding={overriding}
          onOverride={(id) => setOverriding((s) => new Set(s).add(id))}
          onEdgeChange={updateEdgeData}
          providerCells={providerCells}
        />
        {showInterrupts && interrupts && <InterruptPanel tree={interrupts} nodeName={nodeName} onFocusNode={focusNode} />}
        {showAddressMap && addressMap && <AddressMapPanel map={addressMap} nodeName={nodeName} onFocusNode={focusNode} />}
        {kernel && <SchemaPanel schema={schema} nodeName={nodeName} onFocusNode={focusNode} />}
        {build && <BuildPanel build={build} nodeName={nodeName} onFocusNode={focusNode} />}
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
      </aside>
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
      {pickingSoc && (
        <SocPicker
          onClose={() => setPickingSoc(false)}
          onPick={(soc) => {
            setPickingSoc(false);
            loadDesign(() => backend.newBoard(soc.path));
          }}
        />
      )}
    </div>
  );
}
