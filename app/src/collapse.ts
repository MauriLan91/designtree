// Collapsed groups: the canvas shows a group as one block, its members hidden,
// and the edges that cross its border end at ports on the block. This is a
// view of the real nodes and edges, which stay as they are (so the design
// file and the DTS export do not change).

import type { Edge } from "@xyflow/react";
import type { FlowNode, GroupFlowNode, GroupPort, RefData } from "./model";

export const COLLAPSED_WIDTH = 240;
export const HEADER_HEIGHT = 36;
export const PORT_ROW_HEIGHT = 22;

export const isGroupNode = (n: FlowNode): n is GroupFlowNode => n.type === "group";

/** The collapsed groups that contain `id`, innermost first. */
function collapsedChain(byId: Map<string, FlowNode>, id: string): string[] {
  const chain: string[] = [];
  for (let cur = byId.get(id)?.parentId; cur; cur = byId.get(cur)?.parentId) {
    const g = byId.get(cur);
    if (g && isGroupNode(g) && g.data.collapsed) chain.push(cur);
  }
  return chain;
}

/**
 * The nodes and edges to draw. Without collapsed groups these are the
 * arguments themselves. `nameOf` gives the display name of a devicetree node.
 */
export function collapseView(
  nodes: FlowNode[],
  edges: Edge[],
  nameOf: (id: string) => string,
): { nodes: FlowNode[]; edges: Edge[] } {
  if (!nodes.some((n) => isGroupNode(n) && n.data.collapsed)) return { nodes, edges };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** The outermost collapsed group that contains `id`, if any: the one that is drawn. */
  const blockOf = (id: string) => collapsedChain(byId, id).at(-1);
  const display = (id: string) => {
    const block = blockOf(id) ?? id;
    const g = byId.get(block);
    return g && isGroupNode(g) ? g.data.title : nameOf(block);
  };

  const ports = new Map<string, GroupPort[]>();
  const addPort = (block: string, port: GroupPort) => {
    const own = ports.get(block);
    if (own) own.push(port);
    else ports.set(block, [port]);
  };

  const viewEdges = edges.map((e): Edge => {
    const from = blockOf(e.source);
    const to = blockOf(e.target);
    if (!from && !to) return e;
    if (from === to) return { ...e, hidden: true };
    const property = e.type === "ref" ? (e.data as RefData | undefined)?.property : undefined;
    const sourceHandle = from ? `out-${e.id}` : e.sourceHandle;
    const targetHandle = to ? `in-${e.id}` : e.targetHandle;
    if (from) addPort(from, { id: `out-${e.id}`, direction: "out", label: `${property ?? "child"} → ${display(e.target)}` });
    if (to) addPort(to, { id: `in-${e.id}`, direction: "in", label: `${property ?? "parent"} ← ${display(e.source)}` });
    return { ...e, source: from ?? e.source, target: to ?? e.target, sourceHandle, targetHandle };
  });

  const viewNodes = nodes.map((n): FlowNode => {
    if (blockOf(n.id)) return { ...n, hidden: true };
    if (!isGroupNode(n) || !n.data.collapsed) return n;
    const own = ports.get(n.id) ?? [];
    const rows = Math.max(own.filter((p) => p.direction === "in").length, own.filter((p) => p.direction === "out").length);
    const height = HEADER_HEIGHT + rows * PORT_ROW_HEIGHT + 8;
    return {
      ...n,
      data: { ...n.data, ports: own },
      width: COLLAPSED_WIDTH,
      height,
      style: { ...n.style, width: COLLAPSED_WIDTH, height },
    };
  });

  return { nodes: viewNodes, edges: viewEdges };
}

/** Collapsed groups that hide `id`, innermost first. */
export const collapsedAncestors = (nodes: FlowNode[], id: string): string[] =>
  collapsedChain(new Map(nodes.map((n) => [n.id, n])), id);

/** The group collapsed, or expanded with the frame size it had. */
export function toggleCollapsed(group: GroupFlowNode): GroupFlowNode {
  if (!group.data.collapsed) {
    const width = group.measured?.width ?? Number(group.style?.width ?? 300);
    const height = group.measured?.height ?? Number(group.style?.height ?? 200);
    return { ...group, data: { ...group.data, collapsed: true, expandedSize: { width, height } } };
  }
  const size = group.data.expandedSize ?? { width: 300, height: 200 };
  return {
    ...group,
    ...size,
    style: { ...group.style, ...size },
    data: { ...group.data, collapsed: false, expandedSize: undefined },
  };
}
