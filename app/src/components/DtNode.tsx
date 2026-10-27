import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CHILD_HANDLE, PARENT_HANDLE, PHANDLE_HANDLE, REF_HANDLE, baseName, type DtFlowNode } from "../model";

/** Canvas node for a devicetree node: hierarchy handles top/bottom, phandle handles left/right. */
export function DtNode({ data, selected }: NodeProps<DtFlowNode>) {
  const isRoot = data.name === "/";
  const fullName = data.unitAddress ? `${data.name}@${data.unitAddress}` : data.name;
  return (
    <div
      className={`dt-node${selected ? " selected" : ""}${isRoot ? " root" : ""}${data.inherited ? " inherited" : ""}`}
      title={data.inherited ? `Defined in ${data.inherited.file}` : undefined}
    >
      {!isRoot && <Handle type="target" id={PARENT_HANDLE} position={Position.Top} className="h-tree" />}
      <Handle type="target" id={PHANDLE_HANDLE} position={Position.Left} className="h-ref" title="Referenced by (phandle)" />
      <div className="dt-node-title">
        {data.label && <span className="dt-node-label">{data.label}:</span>}
        {fullName}
      </div>
      {data.compatible.length > 0 && <div className="dt-node-compat">{data.compatible[0]}</div>}
      {data.inherited && <div className="dt-node-origin">{baseName(data.inherited.file)}</div>}
      {data.properties.length > 0 && (
        <div className="dt-node-props">
          {data.properties.length} propert{data.properties.length === 1 ? "y" : "ies"}
        </div>
      )}
      {data.todo && data.todo.length > 0 && (
        <div className="dt-node-todo" title={`Fill in: ${data.todo.join(", ")}`}>to do: {data.todo.join(", ")}</div>
      )}
      <Handle type="source" id={REF_HANDLE} position={Position.Right} className="h-ref" title="References (phandle)" />
      <Handle type="source" id={CHILD_HANDLE} position={Position.Bottom} className="h-tree" title="Children" />
    </div>
  );
}
