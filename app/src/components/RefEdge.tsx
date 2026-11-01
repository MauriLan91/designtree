import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { RefData } from "../model";

/**
 * Dashed edge for phandle references, labelled with the property name.
 * The label is SVG, drawn with the edge: an `EdgeLabelRenderer` portal
 * looks up its container on every viewport change, which on boards with
 * thousands of edges made panning crawl (US-11.1).
 */
export function RefEdge(props: EdgeProps<Edge<RefData>>) {
  const [path, labelX, labelY] = getBezierPath(props);
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
