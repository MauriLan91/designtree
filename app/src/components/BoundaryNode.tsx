// A boundary port (US-16.2): a node in another scope that a reference
// crosses to, drawn on the scope's border and named by its label. Wiring to
// it writes the reference; clicking it goes to the node.
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CornerDownRight, CornerUpLeft } from "lucide-react";
import { PHANDLE_HANDLE, REF_HANDLE } from "../model";
import type { BoundaryNode as Boundary } from "../scopes";

export function BoundaryNode({ data, selected }: NodeProps<Boundary>) {
  const out = data.side === "out";
  const Icon = out ? CornerDownRight : CornerUpLeft;
  return (
    <div
      className={`boundary-port ${data.side}${selected ? " selected" : ""}`}
      title={`${data.title} is in another scope; click to go there`}
    >
      {out ? (
        <Handle type="target" id={PHANDLE_HANDLE} position={Position.Left} className="h-ref" />
      ) : (
        <Handle type="source" id={REF_HANDLE} position={Position.Right} className="h-ref" />
      )}
      <Icon size={12} strokeWidth={2} aria-hidden />
      <span>{data.title}</span>
    </div>
  );
}
