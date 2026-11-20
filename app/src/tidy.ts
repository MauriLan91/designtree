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
/** Room between the vertical runs of references that turn in one gap. */
const RUN_SPACING = 12;
/** Room between a gap's outermost run and the boxes beside it. */
const GAP_MARGIN = 30;
/** A gap grows with its references up to this, then they move closer. */
const MAX_GAP = 600;

/**
 * Lays the boxes out in columns, left to right along the references, the
 * way a devicetree reads: a consumer left of the providers it uses (a UART
 * left of its clock and interrupt controller). Within a column, boxes
 * follow the order of what points at them, so references cross less; one
 * too tall for the viewport's shape wraps into several. Boxes
 * with no reference among them go in rows below, as many to a row as
 * shapes the whole like the viewport (`aspect`, its width over its height).
 * The result starts at `origin`, the top left corner of the area tidied.
 */
export function layered(boxes: Box[], links: Link[], origin: { x: number; y: number }, aspect = 16 / 9): Tidied {
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

  // Only a reference to the next column turns at a right angle: one that
  // goes back or skips a column would cross the boxes on its way, and
  // stays a curve. A gap is as wide as its references need to stay apart.
  const routed = inside.filter((l) => rank.get(l.target) === rank.get(l.source)! + 1);
  const perGap = new Map<number, Link[]>();
  for (const l of routed) {
    const c = rank.get(l.source)!;
    perGap.set(c, [...(perGap.get(c) ?? []), l]);
  }
  const gapAfter = (c: number) => Math.min(MAX_GAP, Math.max(COLUMN_GAP, 2 * GAP_MARGIN + RUN_SPACING * (perGap.get(c)?.length ?? 0)));

  const positions = new Map<string, { x: number; y: number }>();
  const heightOf = (col: string[]) => col.reduce((h, id) => h + byId.get(id)!.height, 0) + ROW_GAP * (col.length - 1);
  // A column taller than the viewport's shape allows for all the boxes
  // (hundreds of devices using one clock controller) wraps into several,
  // side by side.
  const area = boxes.reduce((a, b) => a + (b.width + COLUMN_GAP / 2) * (b.height + ROW_GAP), 0);
  const limit = Math.sqrt(area / aspect);
  const wrapped = columns.map((col) => {
    const parts = Math.max(1, Math.ceil(heightOf(col) / limit));
    const per = Math.ceil(col.length / parts);
    return Array.from({ length: parts }, (_, i) => col.slice(i * per, (i + 1) * per)).filter((p) => p.length);
  });
  const tallest = Math.max(0, ...wrapped.flat().map(heightOf));
  const right: number[] = [];
  let x = origin.x;
  wrapped.forEach((parts, c) => {
    parts.forEach((col, i) => {
      const width = Math.max(...col.map((id) => byId.get(id)!.width));
      // Columns are centred on the tallest one.
      let y = origin.y + (tallest - heightOf(col)) / 2;
      for (const id of col) {
        const b = byId.get(id)!;
        positions.set(id, { x: x + (width - b.width) / 2, y });
        y += b.height + ROW_GAP;
      }
      right[c] = x + width;
      x += width + (i < parts.length - 1 ? ROW_GAP : gapAfter(c));
    });
  });

  // Each reference turns in the gap right of its consumer's column; those
  // sharing a gap are spread across it so their vertical runs stay apart.
  const routes = new Map<string, number>();
  for (const [c, list] of perGap) {
    const y = (l: Link) => positions.get(l.target)!.y;
    const sorted = [...list].sort((a, b) => y(a) - y(b));
    const gap = gapAfter(c);
    const step = Math.min(RUN_SPACING, (gap - 2 * GAP_MARGIN) / Math.max(1, sorted.length));
    sorted.forEach((l, i) => routes.set(l.id, right[c] + gap / 2 + (i - (sorted.length - 1) / 2) * step));
  }

  // Loose boxes in rows below, at least as wide as the layered part, and
  // wide enough for the whole to take the viewport's shape.
  const top = linked.length ? origin.y + tallest + ROW_GAP * 2 : origin.y;
  const layeredWidth = right.length ? right[right.length - 1] - origin.x : 0;
  const maxWidth = Math.max(layeredWidth, gridWidth(loose, aspect, linked.length ? tallest + ROW_GAP * 2 : 0, layeredWidth));
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

/**
 * The row width that gives `loose` boxes, under a part `above` tall and
 * `aboveWidth` wide, the shape `aspect` as a whole.
 */
function gridWidth(loose: Box[], aspect: number, above: number, aboveWidth: number): number {
  if (!loose.length) return 0;
  const cellW = loose.reduce((w, b) => w + b.width, 0) / loose.length + ROW_GAP;
  const cellH = loose.reduce((h, b) => h + b.height, 0) / loose.length + ROW_GAP;
  // The narrowest row count whose block, with what is above, is no taller
  // than the aspect allows.
  for (let columns = 1; columns < loose.length; columns++) {
    const width = Math.max(aboveWidth, columns * cellW - ROW_GAP);
    const height = above + Math.ceil(loose.length / columns) * cellH - ROW_GAP;
    if (width / height >= aspect) return columns * cellW - ROW_GAP;
  }
  return loose.length * cellW - ROW_GAP;
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

/** The boxes spaced evenly from the first to the far edge of the last. */
export function distribute(boxes: Box[], axis: "horizontal" | "vertical"): Map<string, { x: number; y: number }> {
  const h = axis === "horizontal";
  const start = (b: Box) => (h ? b.x : b.y);
  const size = (b: Box) => (h ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => start(a) - start(b));
  const first = sorted[0];
  const span = Math.max(...sorted.map((b) => start(b) + size(b))) - start(first);
  // Boxes wider than the room left between them touch rather than overlap.
  const gap = Math.max(0, (span - sorted.reduce((s, b) => s + size(b), 0)) / Math.max(1, sorted.length - 1));
  const out = new Map<string, { x: number; y: number }>();
  let at = start(first);
  for (const b of sorted) {
    out.set(b.id, h ? { x: at, y: b.y } : { x: b.x, y: at });
    at += size(b) + gap;
  }
  return out;
}

// More layouts for the Arrange menu (US-9.8). Like the ones above they
// only compute places; the editor applies them as one undoable edit.

export type Positions = Map<string, { x: number; y: number }>;

/** Room between cells of a grid and between the boxes of a star. */
export const GRID_GAP = 40;
/** Room between the levels of a tree. */
export const LEVEL_GAP = 80;

/** The boxes in rows of equal cells, as square as it gets, in reading order
 * (top to bottom, then left to right) so the arrangement is predictable. */
export function grid(boxes: Box[], origin: { x: number; y: number }): Positions {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const cellW = Math.max(0, ...sorted.map((b) => b.width)) + GRID_GAP;
  const cellH = Math.max(0, ...sorted.map((b) => b.height)) + GRID_GAP;
  return new Map(
    sorted.map((b, i) => [b.id, { x: origin.x + (i % columns) * cellW, y: origin.y + Math.floor(i / columns) * cellH }]),
  );
}

/**
 * The boxes as the devicetree hangs them: each under (or right of, for a
 * `horizontal` tree) its nearest ancestor among the boxes, centred on its
 * children. `parentOf` gives a node's parent in the devicetree; boxes with no
 * ancestor among the boxes are roots, side by side. Siblings keep their
 * current order across the tree.
 */
export function tree(
  boxes: Box[],
  parentOf: (id: string) => string | undefined,
  origin: { x: number; y: number },
  direction: "vertical" | "horizontal",
): Positions {
  const ids = new Set(boxes.map((b) => b.id));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const up = (id: string) => {
    const seen = new Set([id]);
    for (let p = parentOf(id); p !== undefined && !seen.has(p); p = parentOf(p)) {
      if (ids.has(p)) return p;
      seen.add(p);
    }
    return undefined;
  };
  const v = direction === "vertical";
  // Along a level (`across`) and from one level to the next (`down`).
  const across = (b: Box) => (v ? b.width : b.height);
  const down = (b: Box) => (v ? b.height : b.width);
  const at = (b: Box) => (v ? b.x : b.y);

  const children = new Map<string | undefined, string[]>();
  for (const b of boxes) {
    const p = up(b.id);
    children.set(p, [...(children.get(p) ?? []), b.id]);
  }
  for (const list of children.values()) list.sort((a, b) => at(byId.get(a)!) - at(byId.get(b)!));

  // Each level is as deep as its deepest box.
  const depth = new Map<string, number>();
  const levels: number[] = [];
  const walk = (id: string, d: number) => {
    depth.set(id, d);
    levels[d] = Math.max(levels[d] ?? 0, down(byId.get(id)!));
    for (const c of children.get(id) ?? []) walk(c, d + 1);
  };
  const roots = children.get(undefined) ?? [];
  for (const r of roots) walk(r, 0);
  const levelAt: number[] = [];
  levels.reduce((acc, size, d) => ((levelAt[d] = acc), acc + size + LEVEL_GAP), 0);

  const span = new Map<string, number>();
  const spanOf = (id: string): number => {
    const kids = children.get(id) ?? [];
    const kidsSpan = kids.reduce((s, c) => s + spanOf(c), 0) + GRID_GAP * Math.max(0, kids.length - 1);
    const s = Math.max(across(byId.get(id)!), kidsSpan);
    span.set(id, s);
    return s;
  };
  const out: Positions = new Map();
  const place = (id: string, start: number) => {
    const b = byId.get(id)!;
    const s = span.get(id)!;
    const kids = children.get(id) ?? [];
    const kidsSpan = kids.reduce((sum, c) => sum + span.get(c)!, 0) + GRID_GAP * Math.max(0, kids.length - 1);
    let k = start + (s - kidsSpan) / 2;
    for (const c of kids) {
      place(c, k);
      k += span.get(c)! + GRID_GAP;
    }
    const a = start + (s - across(b)) / 2;
    const d = levelAt[depth.get(id)!];
    out.set(id, v ? { x: origin.x + a, y: origin.y + d } : { x: origin.x + d, y: origin.y + a });
  };
  for (const r of roots) spanOf(r);
  let start = 0;
  for (const r of roots) {
    place(r, start);
    start += span.get(r)! + GRID_GAP;
  }
  return out;
}

/** The box most of `links` point at, ties to the one with more links of
 * any kind, then to the first. */
export function mostReferenced(boxes: Box[], links: Link[]): string | undefined {
  const score = (id: string) => {
    const into = links.filter((l) => l.target === id && l.source !== id).length;
    const any = links.filter((l) => l.source === id || l.target === id).length;
    return into * 1000 + any;
  };
  let best: string | undefined;
  for (const b of boxes) if (best === undefined || score(b.id) > score(best)) best = b.id;
  return best;
}

/** The boxes in a ring around `centre`, which stays where it is. The others
 * keep their order around it, starting at the top, each given room by its
 * size, and the ring is wide enough that none overlap the centre or each other. */
export function star(boxes: Box[], centre: string): Positions {
  const hub = boxes.find((b) => b.id === centre);
  if (!hub) return new Map();
  const cx = hub.x + hub.width / 2;
  const cy = hub.y + hub.height / 2;
  const angleOf = (b: Box) => {
    // From the top, clockwise, so the current order reads like a clock.
    const a = Math.atan2(b.y + b.height / 2 - cy, b.x + b.width / 2 - cx) + Math.PI / 2;
    return (a + 2 * Math.PI) % (2 * Math.PI);
  };
  const ring = boxes.filter((b) => b.id !== centre).sort((a, b) => angleOf(a) - angleOf(b));
  const out: Positions = new Map([[centre, { x: hub.x, y: hub.y }]]);
  if (!ring.length) return out;
  const room = (b: Box) => Math.hypot(b.width, b.height) + GRID_GAP;
  const total = ring.reduce((s, b) => s + room(b), 0);
  const radius = Math.max(total / (2 * Math.PI), (Math.hypot(hub.width, hub.height) + Math.max(...ring.map(room))) / 2);
  let angle = -Math.PI / 2;
  for (const b of ring) {
    const step = (room(b) / total) * 2 * Math.PI;
    // A single box sits straight above; more share the ring by their size.
    const a = ring.length === 1 ? angle : angle + step / 2;
    out.set(b.id, { x: cx + radius * Math.cos(a) - b.width / 2, y: cy + radius * Math.sin(a) - b.height / 2 });
    angle += step;
  }
  return out;
}
