import { memo } from "react";
import { useInternalNode, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";
import type { LinkKind } from "../model";

export interface LinkData extends Record<string, unknown> {
  kind: LinkKind;
  via: string[];
  lane: number;
  lanes: number;
  /** Joins a selected device: drawn on top, with its label. */
  active: boolean;
  /** Something else is selected. */
  dimmed: boolean;
}
export type LinkFlowEdge = Edge<LinkData, "link">;

const LANE = 10;

type Box = { x: number; y: number; w: number; h: number };
const box = (n: InternalNode): Box => ({
  x: n.internals.positionAbsolute.x,
  y: n.internals.positionAbsolute.y,
  w: n.measured.width ?? 0,
  h: n.measured.height ?? 0,
});

/** Where the line from the centre of `b` along (dx, dy) leaves it. */
function border(b: Box, cx: number, cy: number, dx: number, dy: number) {
  const tx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy ? b.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * A straight line between two devices, border to border: devices sit
 * anywhere on a board, so there is no side a link should leave from.
 * Several links between the same devices run side by side.
 */
export const LinkEdge = memo(function LinkEdge({ id, source, target, data }: EdgeProps<LinkFlowEdge>) {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data) return null;
  const a = box(from);
  const b = box(to);
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const length = Math.hypot(bx - ax, by - ay);
  if (!length) return null;
  const dx = (bx - ax) / length;
  const dy = (by - ay) / length;
  // The same side for both directions, so A→B and B→A do not cross.
  const flip = source < target ? 1 : -1;
  const shift = (data.lane - (data.lanes - 1) / 2) * LANE * flip;
  const ox = -dy * shift;
  const oy = dx * shift;
  const start = border(a, ax + ox, ay + oy, dx, dy);
  const end = border(b, bx + ox, by + oy, -dx, -dy);
  // The arrowhead is drawn here rather than as a marker, so it takes the
  // line's colour from the stylesheet in both themes.
  const head = 7;
  const wing = (side: number) => `${end.x - dx * head - dy * head * 0.5 * side},${end.y - dy * head + dx * head * 0.5 * side}`;
  const label = data.via.join(", ");
  const className = `link-edge link-${data.kind}${data.active ? " active" : ""}${data.dimmed ? " dimmed" : ""}`;
  return (
    <g className={className}>
      <title>{label ? `${data.kind}: ${label}` : data.kind}</title>
      <path id={id} d={`M ${start.x},${start.y} L ${end.x},${end.y}`} className="link-line" />
      <path d={`M ${end.x},${end.y} L ${wing(1)} L ${wing(-1)} Z`} className="link-head" />
      {/* A wider transparent stroke, so the thin line is easy to hover. */}
      <path d={`M ${start.x},${start.y} L ${end.x},${end.y}`} className="link-hit" />
      {data.active && label && (
        <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 4} className="link-label" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
});
