// Tidying the canvas (US-9.5): a layered layout of the nodes on show, with
// the references between them drawn as right angles, plus aligning and
// distributing a selection. Pure functions over boxes; the editor applies
// the positions and routes as one edit, so one undo takes them back.

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A reference from a consumer to the provider it points at. */
export interface Link {
  id: string;
  source: string;
  target: string;
}

export interface Tidied {
  positions: Map<string, { x: number; y: number }>;
  /** The x of the vertical run of each link drawn as right angles. */
  routes: Map<string, number>;
}

/** Room between columns, where the references turn. */
export const COLUMN_GAP = 160;
export const ROW_GAP = 40;

/**
 * Lays the boxes out in columns, left to right along the references, the
 * way a devicetree reads: a consumer left of the providers it uses (a UART
 * left of its clock and interrupt controller). Within a column, boxes
 * follow the order of what points at them, so references cross less. Boxes
 * with no reference among them go in rows below. The result starts at
 * `origin`, the top left corner of the area tidied.
 */
export function layered(boxes: Box[], links: Link[], origin: { x: number; y: number }): Tidied {
  const ids = new Set(boxes.map((b) => b.id));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const inside = links.filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target);
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const l of inside) {
    out.set(l.source, [...(out.get(l.source) ?? []), l.target]);
    into.set(l.target, [...(into.get(l.target) ?? []), l.source]);
  }
  const linked = boxes.filter((b) => out.has(b.id) || into.has(b.id));
  const loose = boxes.filter((b) => !out.has(b.id) && !into.has(b.id));

  // Ranks: the longest path from a box nothing points at. A reference that
  // closes a cycle is left out of the ranking.
  const rank = new Map<string, number>();
  const state = new Map<string, "open" | "done">();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const t of out.get(id) ?? []) {
      if (state.get(t) === "open") back.add(`${id}>${t}`);
      else if (!state.has(t)) visit(t);
    }
    state.set(id, "done");
  };
  for (const b of linked) if (!state.has(b.id)) visit(b.id);
  const order = topological(linked.map((b) => b.id), out, back);
  for (const id of order) {
    const r = rank.get(id) ?? 0;
    rank.set(id, r);
    for (const t of out.get(id) ?? []) if (!back.has(`${id}>${t}`)) rank.set(t, Math.max(rank.get(t) ?? 0, r + 1));
  }

  // Columns, ordered by the mean place of their neighbours, down then up.
  const columns: string[][] = [];
  for (const b of linked) (columns[rank.get(b.id)!] ??= []).push(b.id);
  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0;
    const range = down ? columns.keys() : [...columns.keys()].reverse();
    for (const c of range) {
      const neighbours = down ? into : out;
      const ref = columns[down ? c - 1 : c + 1];
      if (!ref) continue;
      const at = new Map(ref.map((id, i) => [id, i]));
      const score = (id: string) => {
        const places = (neighbours.get(id) ?? []).map((n) => at.get(n)).filter((i): i is number => i !== undefined);
        return places.length ? places.reduce((a, b) => a + b, 0) / places.length : Infinity;
      };
      const before = new Map(columns[c].map((id, i) => [id, i]));
      columns[c] = [...columns[c]].sort((a, b) => score(a) - score(b) || before.get(a)! - before.get(b)!);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  const heightOf = (col: string[]) => col.reduce((h, id) => h + byId.get(id)!.height, 0) + ROW_GAP * (col.length - 1);
  const tallest = Math.max(0, ...columns.map(heightOf));
  const right: number[] = [];
  let x = origin.x;
  columns.forEach((col, c) => {
    const width = Math.max(...col.map((id) => byId.get(id)!.width));
    // Columns are centred on the tallest one.
    let y = origin.y + (tallest - heightOf(col)) / 2;
    for (const id of col) {
      const b = byId.get(id)!;
      positions.set(id, { x: x + (width - b.width) / 2, y });
      y += b.height + ROW_GAP;
    }
    right[c] = x + width;
    x += width + COLUMN_GAP;
  });

  // Each reference turns in the gap right of its consumer's column; those
  // sharing a gap are spread across it so their vertical runs stay apart.
  const routes = new Map<string, number>();
  const byGap = new Map<number, Link[]>();
  for (const l of inside) {
    const c = rank.get(l.source)!;
    byGap.set(c, [...(byGap.get(c) ?? []), l]);
  }
  for (const [c, list] of byGap) {
    if (right[c] === undefined) continue;
    const y = (l: Link) => positions.get(l.target)!.y;
    const sorted = [...list].sort((a, b) => y(a) - y(b));
    const step = Math.min(14, (COLUMN_GAP - 40) / Math.max(1, sorted.length));
    sorted.forEach((l, i) => routes.set(l.id, right[c] + COLUMN_GAP / 2 + (i - (sorted.length - 1) / 2) * step));
  }

  // Loose boxes in rows below, as wide as the layered part (or four boxes).
  const top = linked.length ? origin.y + tallest + ROW_GAP * 2 : origin.y;
  const maxWidth = Math.max(x - COLUMN_GAP - origin.x, ...loose.slice(0, 4).map((b) => b.width * 4 + ROW_GAP * 3));
  let lx = origin.x;
  let ly = top;
  let rowHeight = 0;
  for (const b of loose) {
    if (lx > origin.x && lx + b.width > origin.x + maxWidth) {
      lx = origin.x;
      ly += rowHeight + ROW_GAP;
      rowHeight = 0;
    }
    positions.set(b.id, { x: lx, y: ly });
    lx += b.width + ROW_GAP;
    rowHeight = Math.max(rowHeight, b.height);
  }
  return { positions, routes };
}

function topological(ids: string[], out: Map<string, string[]>, back: Set<string>): string[] {
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const t of out.get(id) ?? []) if (!back.has(`${id}>${t}`)) indegree.set(t, indegree.get(t)! + 1);
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of out.get(id) ?? []) {
      if (back.has(`${id}>${t}`)) continue;
      indegree.set(t, indegree.get(t)! - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }
  return order;
}

/** The top left corner of the boxes. */
export const cornerOf = (boxes: Box[]) => ({
  x: Math.min(...boxes.map((b) => b.x)),
  y: Math.min(...boxes.map((b) => b.y)),
});

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** The boxes lined up on one edge or centre line of their bounds. */
export function align(boxes: Box[], how: Alignment): Map<string, { x: number; y: number }> {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const place = (b: Box) => {
    switch (how) {
      case "left":
        return { x: x0, y: b.y };
      case "center":
        return { x: (x0 + x1) / 2 - b.width / 2, y: b.y };
      case "right":
        return { x: x1 - b.width, y: b.y };
      case "top":
        return { x: b.x, y: y0 };
      case "middle":
        return { x: b.x, y: (y0 + y1) / 2 - b.height / 2 };
      case "bottom":
        return { x: b.x, y: y1 - b.height };
    }
  };
  return new Map(boxes.map((b) => [b.id, place(b)]));
}

/** The boxes spaced evenly between the first and the last, which stay. */
export function distribute(boxes: Box[], axis: "horizontal" | "vertical"): Map<string, { x: number; y: number }> {
  const h = axis === "horizontal";
  const start = (b: Box) => (h ? b.x : b.y);
  const size = (b: Box) => (h ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => start(a) - start(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = start(last) + size(last) - start(first);
  const gap = (span - sorted.reduce((s, b) => s + size(b), 0)) / Math.max(1, sorted.length - 1);
  const out = new Map<string, { x: number; y: number }>();
  let at = start(first);
  for (const b of sorted) {
    out.set(b.id, h ? { x: at, y: b.y } : { x: b.x, y: at });
    at += size(b) + gap;
  }
  return out;
}
