import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { RefData } from "../model";

/** Radius of the corners of a reference drawn as right angles. */
const CORNER = 8;

/**
 * A path out right from the source, down or up at `x`, and in right to the
 * target, with rounded corners; the label sits on the vertical run.
 */
export function orthogonalPath(sx: number, sy: number, x: number, tx: number, ty: number): [string, number, number] {
  const dy = ty - sy;
  const r = Math.min(CORNER, Math.abs(dy) / 2, Math.abs(x - sx), Math.abs(tx - x));
  const v = Math.sign(dy);
  const h1 = Math.sign(x - sx) || 1;
  const h2 = Math.sign(tx - x) || 1;
  const path =
    r < 0.5
      ? `M ${sx},${sy} H ${x} V ${ty} H ${tx}`
      : `M ${sx},${sy} H ${x - h1 * r} Q ${x},${sy} ${x},${sy + v * r} V ${ty - v * r} Q ${x},${ty} ${x + h2 * r},${ty} H ${tx}`;
  return [path, x, (sy + ty) / 2];
}

/**
 * Dashed edge for phandle references, labelled with the property name.
 * A reference the canvas was tidied with is drawn as right angles that turn
 * where the layout put it (US-9.5); others are curves.
 * The label is SVG, drawn with the edge: an `EdgeLabelRenderer` portal
 * looks up its container on every viewport change, which on boards with
 * thousands of edges made panning crawl (US-11.1).
 */
export function RefEdge(props: EdgeProps<Edge<RefData>>) {
  const route = props.data?.route;
  const [path, labelX, labelY] =
    route !== undefined ? orthogonalPath(props.sourceX, props.sourceY, route, props.targetX, props.targetY) : getBezierPath(props);
  return (
    <BaseEdge
      path={path}
      markerEnd={props.markerEnd}
      className="ref-edge"
      style={props.style}
      label={props.data?.property}
      labelX={labelX}
      labelY={labelY}
      labelShowBg
      labelBgPadding={[5, 1]}
      labelBgBorderRadius={4}
    />
  );
}
