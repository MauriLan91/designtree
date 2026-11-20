// Searching the nodes of a design (US-16.6), for Go to node and the
// Outline filter: by name, label, compatible, path and phandle.
import { isDtNode, type DtFlowNode, type FlowNode } from "./model";

export interface NodeMatch {
  id: string;
  /** `label: name@address`. */
  title: string;
  /** The node's path in the tree. */
  path: string;
}

const nameOf = (n: DtFlowNode) => (n.data.unitAddress ? `${n.data.name}@${n.data.unitAddress}` : n.data.name);

/** Every devicetree node's path, from the child-to-parent map. */
export function nodePaths(nodes: FlowNode[], parents: Map<string, string>): Map<string, string> {
  const byId = new Map(nodes.filter(isDtNode).map((n) => [n.id, n]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, depth = 0): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const n = byId.get(id);
    if (!n) return "";
    const parent = parents.get(id);
    // A top-level node is the root, or an override written by its label.
    let path: string;
    if (parent === undefined || !byId.has(parent) || depth > 256) path = n.data.name === "/" ? "/" : nameOf(n);
    else {
      const above = pathOf(parent, depth + 1);
      path = `${above === "/" ? "" : above}/${nameOf(n)}`;
    }
    paths.set(id, path);
    return path;
  };
  for (const id of byId.keys()) pathOf(id);
  return paths;
}

/**
 * The nodes that match every word of `query`, best first: a name or label
 * that is the query, then one that starts with it, then one that holds it,
 * then a match in the compatible, the path (for a word with a slash) or
 * the whole phandle (decimal or `0x` hex). Ties keep the order of the
 * design. An empty query matches all.
 */
export function searchNodes(nodes: FlowNode[], paths: Map<string, string>, query: string): NodeMatch[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const found: (NodeMatch & { rank: number; at: number })[] = [];
  nodes.forEach((n, at) => {
    if (!isDtNode(n)) return;
    const name = nameOf(n).toLowerCase();
    const labels = [n.data.label, ...(n.data.extraLabels ?? [])].filter((l): l is string => !!l).map((l) => l.toLowerCase());
    const phandle = n.data.phandle;
    const phandles = phandle === undefined ? [] : [String(phandle), `0x${phandle.toString(16)}`];
    const path = paths.get(n.id) ?? name;
    const fields = [name, ...labels, ...n.data.compatible.map((c) => c.toLowerCase())];
    // A phandle is a number: it matches whole, or 0x1f would find 0x1f0. A
    // word is looked for in the path only if it has a slash, or every node
    // under an i2c bus would match "i2c".
    const has = (w: string) =>
      phandles.includes(w) || fields.some((f) => f.includes(w)) || (w.includes("/") && path.toLowerCase().includes(w));
    if (!words.every(has)) return;
    const names = [name, n.data.name.toLowerCase(), ...labels];
    const rank = !q
      ? 0
      : names.includes(q) || phandles.includes(q)
        ? 0
        : names.some((s) => s.startsWith(q))
          ? 1
          : names.some((s) => s.includes(q))
            ? 2
            : 3;
    const title = n.data.label ? `${n.data.label}: ${nameOf(n)}` : nameOf(n);
    found.push({ id: n.id, title, path, rank, at });
  });
  found.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return found.map(({ id, title, path }) => ({ id, title, path }));
}
