import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { GroupFlowNode } from "../model";

/** Visual frame grouping nodes, like a Simulink subsystem. */
export function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} />
      <div className="group-title">{data.title}</div>
    </>
  );
}
