// Copy and paste of nodes and subtrees (US-9.2). The clipboard holds a
// piece of design in the design file format, so it pastes into another
// design, or another window, through the system clipboard.
import type { Edge } from "@xyflow/react";
import {
  fromDesign,
  isDtNode,
  toDesign,
  uniqueLabel,
  type DesignEdge,
  type DesignNode,
  type FlowNode,
  type PropertyValue,
} from "./model";

export const CLIPBOARD_MIME = "application/x-designtree";
const FORMAT = "designtree-clipboard";

export interface Clipboard {
  format: typeof FORMAT;
  version: 1;
  /** The copied nodes, each with its whole subtree, in design order. */
  nodes: DesignNode[];
  /** Child edges inside the copy, and references from it to any node. */
  edges: DesignEdge[];
  /** Where each copied subtree hung in the design it was copied from. */
  parents: Record<string, string>;
}

/** The selected nodes and their subtrees; null when nothing is selected. */
export function copySelection(nodes: FlowNode[], edges: Edge[]): Clipboard | null {
  const design = toDesign(nodes, edges);
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of design.edges) {
    if (e.kind !== "child") continue;
    children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
    parentOf.set(e.to, e.from);
  }
  const root = design.nodes.find((n) => n.name === "/");
  const picked = new Set<string>();
  const add = (id: string) => {
    if (picked.has(id)) return;
    picked.add(id);
    children.get(id)?.forEach(add);
  };
  // The root cannot be copied: it exists once in every design.
  nodes.filter((n) => n.selected && isDtNode(n) && n.id !== root?.id).forEach((n) => add(n.id));
  if (!picked.size) return null;

  const parents: Record<string, string> = {};
  for (const id of picked) {
    const parent = parentOf.get(id);
    if (parent && !picked.has(parent)) parents[id] = parent;
  }
  return {
    format: FORMAT,
    version: 1,
    nodes: design.nodes.filter((n) => picked.has(n.id)),
    edges: design.edges.filter((e) => picked.has(e.from) && (e.kind !== "child" || picked.has(e.to))),
    parents,
  };
}

export function parseClipboard(text: string): Clipboard | null {
  try {
    const data = JSON.parse(text);
    return data?.format === FORMAT && Array.isArray(data.nodes) && Array.isArray(data.edges) ? data : null;
  } catch {
    return null;
  }
}

const OFFSET = 40;

/**
 * The flow nodes and edges that paste `clip` into a design. Nodes get new
 * ids and labels that the design does not use yet; references between
 * pasted nodes follow them, and references to nodes outside the copy stay
 * where the target exists. Each subtree goes under `into` when given,
 * else under its old parent when the design has it, else under the root.
 */
export function pasteClipboard(
  clip: Clipboard,
  nodes: FlowNode[],
  into: string | null,
  newId: (prefix: string) => string,
): { nodes: FlowNode[]; edges: Edge[] } {
  const ids = new Map(clip.nodes.map((n) => [n.id, newId("n")]));
  const existing = new Set(nodes.map((n) => n.id));
  const root = nodes.find((n) => isDtNode(n) && n.data.name === "/");

  // Labels the pasted nodes take, unique against the design and each other.
  const taken = [...nodes];
  const labels = new Map<string, string>();
  for (const n of clip.nodes) {
    for (const label of [n.label, ...(n.extra_labels ?? [])]) {
      if (!label || labels.has(label)) continue;
      const fresh = uniqueLabel(label, taken);
      labels.set(label, fresh);
      taken.push({ id: "", type: "dt", position: { x: 0, y: 0 }, data: { name: "", compatible: [], properties: [], label: fresh } });
    }
  }

  const pasted: DesignNode[] = clip.nodes.map((n) => ({
    ...n,
    id: ids.get(n.id)!,
    label: n.label ? labels.get(n.label) : undefined,
    extra_labels: n.extra_labels?.map((l) => labels.get(l) ?? l),
    properties: (n.properties ?? []).map((p) => ({ ...p, value: renameLabels(p.value, labels) })),
    // A pasted node is the board's own, wherever the original came from.
    inherited: undefined,
    board_position: undefined,
    position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
  }));
  const edges: DesignEdge[] = [];
  for (const e of clip.edges) {
    const to = ids.get(e.to) ?? (existing.has(e.to) ? e.to : null);
    if (to) edges.push({ ...e, from: ids.get(e.from)!, to });
  }
  for (const [id, parent] of Object.entries(clip.parents)) {
    const target = into ?? (existing.has(parent) ? parent : root?.id);
    if (target && ids.has(id)) edges.push({ kind: "child", from: target, to: ids.get(id)! });
  }

  const flow = fromDesign({ nodes: pasted, edges, groups: [] });
  return {
    nodes: flow.nodes.map((n) => ({ ...n, selected: true }) as FlowNode),
    edges: flow.edges.map((e) => ({ ...e, id: newId("e") })),
  };
}

/** Label references inside a value (`<&gpio1 5 0>`, `&uart0`) follow renamed labels. */
function renameLabels(value: PropertyValue, labels: Map<string, string>): PropertyValue {
  if (value.type !== "mixed") return value;
  return {
    type: "mixed",
    value: value.value.map((chunk) => {
      if (chunk.type === "path") return { ...chunk, target: labels.get(chunk.target) ?? chunk.target };
      if (chunk.type !== "cells") return chunk;
      return {
        ...chunk,
        cells: chunk.cells.map((c) =>
          typeof c === "object" && labels.has(c.phandle) ? { phandle: labels.get(c.phandle)! } : c,
        ),
      };
    }),
  };
}
