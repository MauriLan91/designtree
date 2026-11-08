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
  const left = boxes.length ? Math.min(...boxes.map((b) => b.x)) : 0;
  const right = boxes.length ? Math.max(...boxes.map((b) => b.x + b.width)) : 0;
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

/** Bus bars (US-16.3, D8): in a bus controller's scope the controller is
 * drawn as a bar above its devices, with a read-only edge to each. */
export type BusKind = "i2c" | "spi" | "bus";
export interface BusBarData extends Record<string, unknown> {
  /** The controller, whose scope this is. */
  node: string;
  title: string;
  kind: BusKind;
  /** Where each device's edge leaves the bar, from its left end. */
  taps: { id: string; x: number }[];
}
export type BusBarNode = Node<BusBarData, "busbar">;

export const BUSBAR_PREFIX = "busbar:";
/** The handle on a device that bus edges arrive at. */
export const BUS_IN_HANDLE = "bus-in";
const BAR_HEIGHT = 32;
const BAR_GAP = 90;
const BAR_PAD = 40;

/** The kind of bus a controller drives, or null when it is not one: an
 * I²C, SPI or other serial bus whose devices sit at unit addresses. */
export function busKind(node: DtFlowNode): BusKind | null {
  const name = node.data.name;
  const category = node.data.binding?.category;
  const compatible = node.data.compatible.join(" ");
  if (category === "i2c" || category === "i3c" || /^i[23]c$/.test(name) || /\bi2c\b|-i2c\b|i2c-/.test(compatible)) return "i2c";
  if (category === "spi" || /^q?spi$/.test(name) || /\bspi\b|-spi\b|spi-/.test(compatible)) return "spi";
  if (/^(mdio|spmi|w1|can|serial-bus|onewire)$/.test(name)) return "bus";
  return null;
}

/**
 * The bar for a bus scope and its edges, one per device, labelled with the
 * device's unit address. The bar spans the devices with some margin and sits
 * above them; `boxOf` places the devices on the canvas.
 */
export function busBar(
  controller: DtFlowNode,
  kind: BusKind,
  title: string,
  devices: DtFlowNode[],
  boxOf: (id: string) => Box | undefined,
): { node: BusBarNode; edges: Edge[] } {
  const placed = devices.map((d) => ({ d, b: boxOf(d.id) })).filter((x): x is { d: DtFlowNode; b: Box } => !!x.b);
  const minX = placed.length ? Math.min(...placed.map((p) => p.b.x)) : 0;
  const maxX = placed.length ? Math.max(...placed.map((p) => p.b.x + p.b.width)) : 240;
  const top = placed.length ? Math.min(...placed.map((p) => p.b.y)) : 0;
  const x = minX - BAR_PAD;
  const width = Math.max(maxX - minX + 2 * BAR_PAD, 240);
  const id = `${BUSBAR_PREFIX}${controller.id}`;
  const taps = placed.map((p) => ({ id: p.d.id, x: p.b.x + p.b.width / 2 - x }));
  const node: BusBarNode = {
    id,
    type: "busbar",
    position: { x, y: top - BAR_GAP - BAR_HEIGHT },
    data: { node: controller.id, title, kind, taps },
    width,
    height: BAR_HEIGHT,
    measured: { width, height: BAR_HEIGHT },
    draggable: false,
    deletable: false,
    selectable: false,
    connectable: false,
  };
  const edges: Edge[] = placed.map((p) => ({
    id: `bus:${p.d.id}`,
    type: "step",
    source: id,
    sourceHandle: `tap:${p.d.id}`,
    target: p.d.id,
    targetHandle: BUS_IN_HANDLE,
    label: p.d.data.unitAddress ? `@${p.d.data.unitAddress}` : undefined,
    className: `bus-edge bus-${kind}`,
    selectable: false,
    deletable: false,
    focusable: false,
  }));
  return { node, edges };
}
