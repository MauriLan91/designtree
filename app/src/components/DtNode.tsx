import { useContext, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { NodePorts } from "../nodePorts";
import { NodeProblems } from "../nodeProblems";
import { consumerHandle, providerHandle } from "../ports";
import { CHILD_HANDLE, PARENT_HANDLE, PHANDLE_HANDLE, REF_HANDLE, baseName, type DtFlowNode } from "../model";

/**
 * Canvas node for a devicetree node: hierarchy handles top/bottom, phandle
 * handles left/right. Typed ports list what the node provides (left) and the
 * phandle properties it consumes (right).
 */
export function DtNode({ id, data, selected }: NodeProps<DtFlowNode>) {
  const problems = useContext(NodeProblems).get(id) ?? [];
  const ports = useContext(NodePorts).get(id);
  // Optional ports nothing is wired to only show on the selected node, so a
  // board with hundreds of nodes stays readable.
  const consumers = ports?.consumers.filter((c) => selected || c.required || c.wired) ?? [];
  const hidden = (ports?.consumers.length ?? 0) - consumers.length;
  // React Flow measures handles only on resize; a renamed port must be
  // registered, or its edges disappear.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleKey = [...consumers.map((c) => c.property), "|", ...(ports?.providers.map((p) => p.cells) ?? [])].join(" ");
  useEffect(() => updateNodeInternals(id), [id, handleKey, updateNodeInternals]);
  const isRoot = data.name === "/";
  const fullName = data.unitAddress ? `${data.name}@${data.unitAddress}` : data.name;
  return (
    <div
      className={`dt-node${selected ? " selected" : ""}${isRoot ? " root" : ""}${data.inherited ? " inherited" : ""}${problems.length ? " invalid" : ""}`}
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
      {problems.length > 0 && (
        <div className="dt-node-errors" title={problems.join("\n")}>
          {problems.length} schema error{problems.length === 1 ? "" : "s"}
        </div>
      )}
      {ports && (ports.providers.length > 0 || consumers.length > 0 || hidden > 0) && (
        <div className="dt-node-ports">
          <ul className="ports-in">
            {ports.providers.map((p) => (
              <li key={p.cells} title={`Provider: consumers use ${p.cells} specifier cells`}>
                <Handle type="target" id={providerHandle(p.cells)} position={Position.Left} className="h-port" />
                {p.label}
              </li>
            ))}
          </ul>
          <ul className="ports-out">
            {consumers.map((c) => (
              <li
                key={c.property}
                className={c.required ? "required" : undefined}
                title={c.cells ? `${c.property}: points at a node with ${c.cells}` : `${c.property}: points at any node`}
              >
                {c.property}
                <Handle type="source" id={consumerHandle(c.property)} position={Position.Right} className="h-port" />
              </li>
            ))}
            {hidden > 0 && (
              <li className="more" title="Select the node to wire them">
                +{hidden} optional
              </li>
            )}
          </ul>
        </div>
      )}
      <Handle type="source" id={REF_HANDLE} position={Position.Right} className="h-ref" title="References (phandle)" />
      <Handle type="source" id={CHILD_HANDLE} position={Position.Bottom} className="h-tree" title="Children" />
    </div>
  );
}
