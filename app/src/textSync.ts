// Applying an edit of the DTS text (US-10.1) replaces the whole design;
// reconciling it with the current canvas keeps the objects of what did not
// change, so React Flow only re-renders what the edit touched, and keeps
// what the text does not carry (selection, the binding a node was made from).
import type { Edge } from "@xyflow/react";
import { isDtNode, type FlowNode } from "./model";

/** React Flow's own bookkeeping, not part of what a node is. */
const VOLATILE = new Set(["selected", "dragging", "measured", "width", "height", "resizing"]);

function stable(value: object): string {
  return JSON.stringify(value, (key, v) => (VOLATILE.has(key) ? undefined : v));
}

export function reconcileNodes(current: FlowNode[], next: FlowNode[]): FlowNode[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  return next.map((n) => {
    const old = byId.get(n.id);
    if (!old) return n;
    let merged = n;
    // Editor-only data the design file does not keep.
    if (isDtNode(old) && isDtNode(n) && old.data.binding && !n.data.binding) {
      merged = { ...n, data: { ...n.data, binding: old.data.binding, todo: old.data.todo } } as FlowNode;
    }
    if (stable(merged) === stable(old)) return old;
    return old.selected ? ({ ...merged, selected: true } as FlowNode) : merged;
  });
}

const signature = (e: Edge) =>
  stable({ source: e.source, target: e.target, sourceHandle: e.sourceHandle, type: e.type, data: e.data });

/**
 * Edge ids come from the edge's index in the design, which an edit shifts:
 * edges are matched by what they connect instead, and new ones get fresh ids.
 */
export function reconcileEdges(current: Edge[], next: Edge[], newId: () => string): Edge[] {
  const pool = new Map<string, { edges: Edge[]; next: number }>();
  for (const e of current) {
    const key = signature(e);
    const bucket = pool.get(key);
    if (bucket) bucket.edges.push(e);
    else pool.set(key, { edges: [e], next: 0 });
  }
  return next.map((e) => {
    const bucket = pool.get(signature(e));
    const old = bucket?.edges[bucket.next++];
    return old ?? { ...e, id: newId() };
  });
}
