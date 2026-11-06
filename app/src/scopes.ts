// Scopes (US-16.1, D7): the canvas shows one node's children at a time,
// instead of the whole tree wired with parent/child edges. The tree itself
// is unchanged (it is still the child edges, so design files and the DTS
// export stay as they were); a scope is only a view of it.
import type { Edge, Node } from "@xyflow/react";
import { kindOf } from "./categories";
import { CHILD_HANDLE, PHANDLE_HANDLE, REF_HANDLE, isDtNode, type DtFlowNode, type FlowNode } from "./model";

export const isTreeEdge = (e: Edge) => e.sourceHandle === CHILD_HANDLE;

/** Each node's parent in the devicetree, by id. */
export function parentsOf(edges: Edge[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const e of edges) if (isTreeEdge(e)) parents.set(e.target, e.source);
  return parents;
}

/** The scope of the main canvas: the root node, or null when the design has
 * none (an overlay is a list of top-level fragments and `&label` blocks). */
export function mainScope(nodes: FlowNode[], parents: Map<string, string>): string | null {
  return nodes.find((n) => isDtNode(n) && n.data.name === "/" && !parents.has(n.id))?.id ?? null;
}

/** Whether `id` is drawn in `scope`: its children, and on the main canvas
 * also the other top-level nodes (`&label` overrides beside the root). */
export function inScope(id: string, scope: string | null, main: string | null, parents: Map<string, string>): boolean {
  const parent = parents.get(id);
  if (parent !== undefined) return parent === scope;
  return scope === main && id !== main;
}

/**
 * The part of the design a scope shows: its devicetree nodes, the groups
 * that frame them, and the references between them. References to nodes
 * elsewhere are left out here (US-16.2 draws them as ports).
 */
export function scopeView(
  nodes: FlowNode[],
  edges: Edge[],
  scope: string | null,
  main: string | null,
  parents: Map<string, string>,
): { nodes: FlowNode[]; edges: Edge[] } {
  const shown = scopeIds(nodes, scope, main, parents);
  return { nodes: nodes.filter((n) => shown.has(n.id)), edges: scopeEdges(edges, shown) };
}

/** The ids `scopeView` draws. */
export function scopeIds(nodes: FlowNode[], scope: string | null, main: string | null, parents: Map<string, string>): Set<string> {
  const shown = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const framed = new Set<string>();
  for (const n of nodes) {
    if (!isDtNode(n)) continue;
    for (let g = n.parentId; g; g = byId.get(g)?.parentId) framed.add(g);
    if (!inScope(n.id, scope, main, parents)) continue;
    shown.add(n.id);
    // The groups around it, out to the outermost.
    for (let g = n.parentId; g && !shown.has(g); g = byId.get(g)?.parentId) shown.add(g);
  }
  // A group with no node in it would be on no scope at all: keep it on the
  // main canvas, where it can be deleted.
  if (scope === main) for (const n of nodes) if (!isDtNode(n) && !framed.has(n.id) && !n.parentId) shown.add(n.id);
  return shown;
}

/** The references between nodes that are both drawn. */
export const scopeEdges = (edges: Edge[], shown: Set<string>) =>
  edges.filter((e) => !isTreeEdge(e) && shown.has(e.source) && shown.has(e.target));

/** The scopes from the main one down to `scope`, for the breadcrumb. */
export function scopePath(scope: string | null, main: string | null, parents: Map<string, string>): (string | null)[] {
  const path: (string | null)[] = [];
  // A top-level node beside the root has no parent: it hangs off the main scope.
  for (let s = scope; s !== null && s !== main; s = parents.get(s) ?? main) path.unshift(s);
  return [main, ...path];
}

/** The scope that shows `id`: its parent, or the main one for top-level nodes. */
export const scopeOf = (id: string, main: string | null, parents: Map<string, string>) => parents.get(id) ?? main;

// Generic names of nodes that hold other nodes (devicetree spec, kernel use).
const CONTAINERS = /^(cpus|soc|bus|pinctrl|leds|gpio-keys|keys|reserved-memory|clocks|regulators|thermal-zones|ports|fragment|__overlay__)$/;

/**
 * Whether double-clicking opens the node's scope (D7). It does for nodes
 * with children and for those that usually hold some: buses, containers,
 * and bindings with `#address-cells`. The others open their properties.
 */
export function canHaveChildren(node: DtFlowNode, hasChildren: boolean): boolean {
  if (hasChildren || node.data.name === "/" || CONTAINERS.test(node.data.name)) return true;
  if (node.data.properties.some((p) => p.name === "#address-cells")) return true;
  if (node.data.binding?.properties?.some((p) => p.name === "#address-cells")) return true;
  return kindOf(node.data.binding?.category, node.data.name) === "bus";
}

/** Boundary ports (US-16.2): a node outside the scope that a reference
 * crosses to, drawn on the canvas border. */
export interface BoundaryData extends Record<string, unknown> {
  /** The real node it stands for. */
  node: string;
  /** `&label`, or the node's name when it has none. */
  title: string;
  /** "out": a node in the scope refers to it (port on the right border);
   * "in": it refers to a node in the scope (port on the left border). */
  side: "in" | "out";
}
export type BoundaryNode = Node<BoundaryData, "boundary">;

export const BOUNDARY_PREFIX = "boundary:";
/** The real node a drawn node stands for: itself, or a boundary port's node. */
export const realId = (id: string) => (id.startsWith(BOUNDARY_PREFIX) ? id.slice(id.indexOf(":", BOUNDARY_PREFIX.length) + 1) : id);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PORT_GAP = 140;
const PORT_ROW = 44;
const PORT_WIDTH = 160;
const PORT_HEIGHT = 28;

/**
 * The boundary ports of a scope and the references rewired to them. Each
 * node outside that a reference crosses to gets one port per side, however
 * many references reach it; the edges keep their ids, so selecting or
 * deleting one acts on the real reference. Ports sit in a column beside the
 * scope's nodes (`boxOf` gives their place on the canvas), in the order of
 * the nodes they connect to, so the lines do not cross needlessly.
 */
export function boundaryPorts(
  edges: Edge[],
  shown: Set<string>,
  boxOf: (id: string) => Box | undefined,
  titleOf: (id: string) => string,
): { nodes: BoundaryNode[]; edges: Edge[] } {
  const crossing = edges.filter((e) => !isTreeEdge(e) && shown.has(e.source) !== shown.has(e.target));
  if (crossing.length === 0) return { nodes: [], edges: [] };

  const boxes = [...shown].map(boxOf).filter((b): b is Box => b !== undefined);
  const left = Math.min(...boxes.map((b) => b.x), 0);
  const right = Math.max(...boxes.map((b) => b.x + b.width), 0);
  const centreY = (id: string) => {
    const b = boxOf(id);
    return b ? b.y + b.height / 2 : 0;
  };

  // Per side, the outside node and where its first partner inside sits.
  const ports = new Map<string, { node: string; side: "in" | "out"; y: number }>();
  const rewired = crossing.map((e) => {
    const side = shown.has(e.source) ? "out" : "in";
    const outside = side === "out" ? e.target : e.source;
    const inside = side === "out" ? e.source : e.target;
    const id = `${BOUNDARY_PREFIX}${side}:${outside}`;
    if (!ports.has(id)) ports.set(id, { node: outside, side, y: centreY(inside) });
    return side === "out"
      ? { ...e, target: id, targetHandle: PHANDLE_HANDLE }
      : { ...e, source: id, sourceHandle: REF_HANDLE };
  });

  const nodes: BoundaryNode[] = [];
  for (const side of ["in", "out"] as const) {
    const column = [...ports].filter(([, p]) => p.side === side).sort(([, a], [, b]) => a.y - b.y);
    // Keep the order, but never closer than one row.
    let last = -Infinity;
    for (const [id, p] of column) {
      const y = Math.max(p.y - PORT_ROW / 2, last + PORT_ROW);
      last = y;
      nodes.push({
        id,
        type: "boundary",
        position: { x: side === "out" ? right + PORT_GAP : left - PORT_GAP - PORT_WIDTH, y },
        data: { node: p.node, title: titleOf(p.node), side },
        // Not in the editor's node state, so React Flow's measurements would
        // be dropped: give it its size up front, or it stays unmeasured and hidden.
        width: PORT_WIDTH,
        height: PORT_HEIGHT,
        measured: { width: PORT_WIDTH, height: PORT_HEIGHT },
        draggable: false,
        deletable: false,
        connectable: true,
      });
    }
  }
  return { nodes, edges: rewired };
}
