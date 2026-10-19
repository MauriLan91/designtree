import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { RefData } from "../model";

/** Dashed edge for phandle references, labelled with the property name. */
export function RefEdge(props: EdgeProps<Edge<RefData>>) {
  const [path, labelX, labelY] = getBezierPath(props);
  return (
    <>
      <BaseEdge path={path} markerEnd={props.markerEnd} className="ref-edge" style={props.style} />
      <EdgeLabelRenderer>
        <div
          className={`ref-edge-label${props.selected ? " selected" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {props.data?.property}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
