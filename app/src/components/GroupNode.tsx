import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { HEADER_HEIGHT, PORT_ROW_HEIGHT, isGroupNode, toggleCollapsed } from "../collapse";
import type { FlowNode, GroupFlowNode } from "../model";

/**
 * Visual frame grouping nodes, like a Simulink subsystem; collapsed, one
 * block whose ports are the edges that cross the group's border.
 */
export function GroupNode({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const { setNodes } = useReactFlow<FlowNode>();
  const collapsed = !!data.collapsed;
  const toggle = (
    <button
      className="group-toggle nodrag"
      onClick={() => setNodes((ns) => ns.map((n) => (n.id === id && isGroupNode(n) ? toggleCollapsed(n) : n)))}
      title={collapsed ? "Expand the group" : "Collapse the group into a block"}
      aria-expanded={!collapsed}
    >
      {collapsed ? "▸" : "▾"}
    </button>
  );

  if (!collapsed) {
    return (
      <>
        <NodeResizer isVisible={selected} minWidth={160} minHeight={100} />
        <div className="group-title">
          {toggle}
          {data.title}
        </div>
      </>
    );
  }

  const ports = data.ports ?? [];
  const portsOf = (direction: "in" | "out") => ports.filter((p) => p.direction === direction);
  return (
    <div className={`group-block${selected ? " selected" : ""}`}>
      <div className="group-block-title">
        {toggle}
        {data.title}
      </div>
      {(["in", "out"] as const).map((direction) =>
        portsOf(direction).map((port, i) => {
          const top = HEADER_HEIGHT + i * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
          return (
            <div key={port.id}>
              <Handle
                type={direction === "in" ? "target" : "source"}
                id={port.id}
                position={direction === "in" ? Position.Left : Position.Right}
                isConnectable={false}
                className="h-ref"
                style={{ top }}
              />
              <div
                className={`group-port ${direction}`}
                style={{ top: top - PORT_ROW_HEIGHT / 2, height: PORT_ROW_HEIGHT }}
                title={port.label}
              >
                {port.label}
              </div>
            </div>
          );
        }),
      )}
    </div>
  );
}
