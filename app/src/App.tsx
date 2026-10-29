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
} from "@xyflow/react";
import { backend, dialogs, inTauri } from "./backend";
import { DtNode } from "./components/DtNode";
import { DtsPreview } from "./components/DtsPreview";
import { GroupNode } from "./components/GroupNode";
import { initialProperties } from "./schemaProps";
import { BuildPanel, type BuildState } from "./components/BuildPanel";
import { Inspector } from "./components/Inspector";
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
  expectedSpecifierCells,
  guessReferenceProperty,
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
  type RefData,
} from "./model";

const nodeTypes = { dt: DtNode, group: GroupNode };
const edgeTypes = { ref: RefEdge };
const GROUP_PADDING = 40;

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
  const [errors, setErrors] = useState<string[]>([]);
  /** File the design was last opened from or saved to; the .dtb goes next to it. */
  const [designPath, setDesignPath] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildState | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLElement>(null);

  const [initialKernel, setInitialKernel] = useState<string | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    backend.startupArgs().then((args) => {
      if (args.design) {
        const d = fromDesign(args.design);
        setNodes(d.nodes);
        setEdges(d.edges);
        setExtras(d.extras);
      }
      setInitialKernel(args.linux_src);
    }, (e) => setErrors([String(e)]));
  }, [setNodes, setEdges]);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected) ?? null;
  const providerNode = selectedEdge && nodes.find((n) => n.id === selectedEdge.target);
  const providerCells =
    selectedEdge?.data && providerNode && isDtNode(providerNode)
      ? expectedSpecifierCells(providerNode.data, (selectedEdge.data as RefData).property)
      : undefined;

  // Regenerate the preview whenever the design changes.
  useEffect(() => {
    if (!inTauri) {
      setErrors(["Backend not available: run the app with `npm run tauri dev`."]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setDts(await backend.exportDts(toDesign(nodes, edges, extras)));
        setErrors([]);
      } catch (e) {
        setErrors(Array.isArray(e) ? e : [String(e)]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [nodes, edges, extras]);

  const isValidConnection: IsValidConnection = useCallback(
    (c) => {
      // Inherited nodes keep their place in the tree; only overrides can change them.
      const target = nodes.find((n) => n.id === c.target);
      const inherited = target !== undefined && isDtNode(target) && target.data.inherited !== undefined;
      return (
        c.source !== c.target &&
        ((c.sourceHandle === CHILD_HANDLE && c.targetHandle === PARENT_HANDLE && !inherited) ||
          (c.sourceHandle === REF_HANDLE && c.targetHandle === PHANDLE_HANDLE))
      );
    },
    [nodes],
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
      const data: RefData = { property: guessReferenceProperty(target.data), args: [] };
      setEdges((es) => addEdge({ ...c, id: newId("e"), type: "ref", data }, es));
    },
    [nodes, setNodes, setEdges],
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
      await backend.saveDesign(path, toDesign(nodes, edges, extras));
      setDesignPath(path);
    }
  };

  const exportDts = async () => {
    if (!dts) return;
    const path = await dialogs.pickDtsToSave();
    if (path) await backend.writeText(path, dts);
  };

  const buildDtb = async () => {
    const target = designPath ? designPath.replace(/\.[^./\\]*$/, "") + ".dtb" : await dialogs.pickDtbToSave();
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
    setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === id) ? n : ({ ...n, selected: n.id === id } as FlowNode))));
    fitView({ nodes: [{ id }], maxZoom: 1, duration: 300 });
  };

  const nodeName = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node || !isDtNode(node)) return undefined;
    return node.data.unitAddress ? `${node.data.name}@${node.data.unitAddress}` : node.data.name;
  };

  const chooseDtc = async () => {
    const path = await dialogs.pickDtc();
    if (path) await backend.setDtcPath(path);
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
        <button onClick={openDesign} disabled={!inTauri}>Open…</button>
        <button onClick={importDts} disabled={!inTauri}>Import .dts…</button>
        <button onClick={saveDesign} disabled={!inTauri}>Save…</button>
        <button onClick={exportDts} disabled={!inTauri || !dts || errors.length > 0}>Export .dts…</button>
        <button onClick={buildDtb} disabled={!inTauri || errors.length > 0}>Build .dtb</button>
        <button onClick={chooseDtc} disabled={!inTauri} title="Use a dtc program that is not in PATH">dtc path…</button>
        <span className="sep" />
        <button onClick={autoLayout} disabled={!inTauri}>Auto layout</button>
        <button onClick={groupSelection} disabled={!selectedNodes.some((n) => !n.parentId)}>Group</button>
        <button onClick={ungroupSelection} disabled={!selectedNodes.some((n) => n.type === "group")}>Ungroup</button>
      </header>
      <Palette onAdd={(b) => addNode(b)} initialKernel={initialKernel} />
      <main ref={canvasRef} className="canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
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
        {build && <BuildPanel build={build} nodeName={nodeName} onFocusNode={focusNode} />}
        <DtsPreview dts={dts} errors={errors} />
      </aside>
    </div>
  );
}
