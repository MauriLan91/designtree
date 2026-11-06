// Scopes (US-16.1, D7): the canvas shows one node's children at a time,
// instead of the whole tree wired with parent/child edges. The tree itself
// is unchanged (it is still the child edges, so design files and the DTS
// export stay as they were); a scope is only a view of it.
import type { Edge } from "@xyflow/react";
import { kindOf } from "./categories";
import { CHILD_HANDLE, isDtNode, type DtFlowNode, type FlowNode } from "./model";

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
  const shown = new Set<string>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (!isDtNode(n) || !inScope(n.id, scope, main, parents)) continue;
    shown.add(n.id);
    // The groups around it, out to the outermost.
    for (let g = n.parentId; g && !shown.has(g); g = byId.get(g)?.parentId) shown.add(g);
  }
  return {
    nodes: nodes.filter((n) => shown.has(n.id)),
    edges: edges.filter((e) => !isTreeEdge(e) && shown.has(e.source) && shown.has(e.target)),
  };
}

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
