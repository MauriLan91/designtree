import { useEffect, useState } from "react";
import type { Edge } from "@xyflow/react";
import {
  formatProperties,
  parseProperties,
  type DtFlowNode,
  type DtNodeData,
  type GroupFlowNode,
  type RefData,
} from "../model";

interface Props {
  node: DtFlowNode | GroupFlowNode | null;
  edge: Edge | null;
  onNodeChange: (id: string, data: Partial<DtNodeData> | { title: string }) => void;
  onEdgeChange: (id: string, data: RefData) => void;
}

export function Inspector({ node, edge, onNodeChange, onEdgeChange }: Props) {
  if (node?.type === "dt") return <NodeInspector key={node.id} node={node} onChange={onNodeChange} />;
  if (node?.type === "group") {
    return (
      <section className="inspector">
        <h2>Group</h2>
        <label>
          Title
          <input value={node.data.title} onChange={(e) => onNodeChange(node.id, { title: e.target.value })} />
        </label>
      </section>
    );
  }
  if (edge?.data && edge.sourceHandle === "ref") {
    const data = edge.data as RefData;
    return (
      <section className="inspector">
        <h2>Reference</h2>
        <label>
          Property
          <input value={data.property} onChange={(e) => onEdgeChange(edge.id, { ...data, property: e.target.value })} />
        </label>
        <label>
          Specifier cells
          <input
            value={data.args.join(" ")}
            placeholder="e.g. 1 0"
            onChange={(e) =>
              onEdgeChange(edge.id, {
                ...data,
                args: e.target.value.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger),
              })
            }
          />
        </label>
      </section>
    );
  }
  return (
    <section className="inspector">
      <h2>Inspector</h2>
      <p className="hint">Select a node, group or reference to edit it.</p>
    </section>
  );
}

function NodeInspector({ node, onChange }: { node: DtFlowNode; onChange: Props["onNodeChange"] }) {
  const { data } = node;
  const [propsText, setPropsText] = useState(formatProperties(data.properties));
  const [propsError, setPropsError] = useState<string | null>(null);
  useEffect(() => setPropsText(formatProperties(data.properties)), [data.properties]);

  const commitProps = () => {
    try {
      onChange(node.id, { properties: parseProperties(propsText) });
      setPropsError(null);
    } catch (e) {
      setPropsError((e as Error).message);
    }
  };

  const present = new Set(["compatible", ...data.properties.map((p) => p.name)]);
  const missing = data.binding?.properties?.filter((p) => p.required && !present.has(p.name)) ?? [];
  const isRoot = data.name === "/";

  return (
    <section className="inspector">
      <h2>Node</h2>
      {data.binding?.title && <p className="hint">{data.binding.title}</p>}
      <div className="row">
        <label>
          Name
          <input value={data.name} disabled={isRoot} onChange={(e) => onChange(node.id, { name: e.target.value })} />
        </label>
        <label>
          Unit address
          <input
            value={data.unitAddress ?? ""}
            disabled={isRoot}
            onChange={(e) => onChange(node.id, { unitAddress: e.target.value })}
          />
        </label>
      </div>
      <label>
        Label
        <input value={data.label ?? ""} onChange={(e) => onChange(node.id, { label: e.target.value })} />
      </label>
      <label>
        Compatible (comma separated)
        <input
          value={data.compatible.join(", ")}
          onChange={(e) =>
            onChange(node.id, { compatible: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
          }
        />
      </label>
      <label>
        Properties
        <textarea
          rows={8}
          spellCheck={false}
          value={propsText}
          placeholder={'reg = <0x10000000 0x100>\nstatus = "okay"'}
          onChange={(e) => setPropsText(e.target.value)}
          onBlur={commitProps}
        />
      </label>
      {propsError && <p className="error">{propsError}</p>}
      {missing.length > 0 && (
        <div className="missing">
          <strong>Required by the binding:</strong>
          <ul>
            {missing.map((p) => (
              <li key={p.name} title={p.description}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
