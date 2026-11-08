import { useEffect, useState } from "react";
import type { Edge } from "@xyflow/react";
import { backend, inTauri } from "../backend";
import { PropertyTable, type Reference } from "./PropertyTable";
import { SpecifierEditor } from "./SpecifierEditor";
import { TextInput } from "./TextInput";
import { clearEditedTodo } from "../schemaProps";
import {
  baseName,
  formatProperties,
  parseProperties,
  type DtFlowNode,
  type DtNodeData,
  type Binding,
  type GroupFlowNode,
  type Property,
  type RefData,
} from "../model";

interface Props {
  node: DtFlowNode | GroupFlowNode | null;
  edge: Edge | null;
  onNodeChange: (id: string, data: Partial<DtNodeData> | { title: string }) => void;
  onEdgeChange: (id: string, data: RefData) => void;
  /** Inherited nodes unlocked for editing. */
  /** Specifier cells the selected reference's provider expects. */
  providerCells?: number;
  overriding: Set<string>;
  onOverride: (id: string) => void;
  /** The references of the inspected node, shown in its property table. */
  references: Reference[];
}

export function Inspector({ node, edge, onNodeChange, onEdgeChange, providerCells, overriding, onOverride, references }: Props) {
  if (node?.type === "dt") {
    return (
      <NodeInspector
        key={node.id}
        node={node}
        onChange={onNodeChange}
        overriding={overriding.has(node.id)}
        onOverride={() => onOverride(node.id)}
        references={references}
        onReferenceChange={(id, args) => {
          const ref = references.find((r) => r.id === id);
          if (ref) onEdgeChange(id, { property: ref.property, args });
        }}
      />
    );
  }
  if (node?.type === "group") {
    return (
      <section className="inspector">
        <h2>Group</h2>
        <label>
          Title
          <TextInput key={node.id} value={node.data.title} onCommit={(title) => onNodeChange(node.id, { title })} />
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
          <TextInput key={edge.id} value={data.property} onCommit={(property) => onEdgeChange(edge.id, { ...data, property })} />
        </label>
        <SpecifierEditor
          args={data.args}
          expected={providerCells}
          onChange={(args) => onEdgeChange(edge.id, { ...data, args })}
        />
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

function NodeInspector({
  node,
  onChange,
  overriding,
  onOverride,
  references,
  onReferenceChange,
}: {
  node: DtFlowNode;
  onChange: Props["onNodeChange"];
  overriding: boolean;
  onOverride: () => void;
  references: Reference[];
  onReferenceChange: (id: string, args: number[]) => void;
}) {
  const { data } = node;
  const binding = useBinding(data.binding, data.compatible[0]);
  // The table is the editor; the text stays for pasting and bulk edits (US-17.1).
  const [raw, setRaw] = useState(false);
  const allText = formatProperties(data.properties);
  const [propsText, setPropsText] = useState(allText);
  const [propsError, setPropsError] = useState<string | null>(null);
  useEffect(() => setPropsText(allText), [allText]);

  const setProps = (properties: Property[]) =>
    onChange(node.id, { properties, todo: clearEditedTodo(data.todo, data.properties, properties) });

  const commitProps = () => {
    try {
      setProps(parseProperties(propsText, data.properties));
      setPropsError(null);
    } catch (e) {
      setPropsError((e as Error).message);
    }
  };

  const have = new Set(["compatible", ...data.properties.map((p) => p.name), ...references.map((r) => r.property)]);
  const missing = [...new Set(binding?.properties?.filter((p) => p.required && !have.has(p.name)).map((p) => p.name))];
  const isRoot = data.name === "/";
  // Inherited nodes are read-only until the user chooses to override them.
  const locked = data.inherited !== undefined && !overriding;

  return (
    <section className="inspector">
      <h2>Node</h2>
      {binding?.title && <p className="hint">{binding.title}</p>}
      {data.inherited && (
        <div className="inherited-note">
          Defined in <code title={data.inherited.file}>{baseName(data.inherited.file)}</code>. Changes are exported as
          an override in the board file, the included file stays as it is.
          {locked && (
            <div>
              <button onClick={onOverride}>Override</button>
            </div>
          )}
        </div>
      )}
      <div className="row">
        <label>
          Name
          <TextInput
            key={node.id}
            value={data.name}
            disabled={isRoot || data.inherited !== undefined}
            onCommit={(name) => onChange(node.id, { name })}
          />
        </label>
        <label>
          Unit address
          <TextInput
            key={node.id}
            value={data.unitAddress ?? ""}
            disabled={isRoot || data.inherited !== undefined}
            onCommit={(unitAddress) => onChange(node.id, { unitAddress })}
          />
        </label>
      </div>
      <label>
        Label
        <TextInput
          key={node.id}
          value={data.label ?? ""}
          disabled={data.inherited?.labels?.includes(data.label ?? "") || locked}
          onCommit={(label) => onChange(node.id, { label })}
        />
      </label>
      <label>
        Compatible (comma separated)
        <TextInput
          key={node.id}
          value={data.compatible.join(", ")}
          disabled={locked}
          onCommit={(text) => onChange(node.id, { compatible: text.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </label>
      <div className="props-head">
        <span>Properties</span>
        <div className="segmented" role="group" aria-label="Property view">
          <button aria-pressed={!raw} onClick={() => setRaw(false)}>
            Table
          </button>
          <button aria-pressed={raw} onClick={() => setRaw(true)} title="One name = value per line, as in DTS">
            Text
          </button>
        </div>
      </div>
      {raw ? (
        <>
          <textarea
            aria-label="Properties as text"
            rows={10}
            spellCheck={false}
            readOnly={locked}
            value={propsText}
            placeholder={'reg = <0x10000000 0x100>\nstatus = "okay"'}
            onChange={(e) => setPropsText(e.target.value)}
            onBlur={commitProps}
          />
          {references.length > 0 && <p className="hint">References are edited in the table or on the canvas.</p>}
          {missing.length > 0 && <p className="hint">Required, not set yet: {missing.join(", ")}</p>}
          {propsError && <p className="error">{propsError}</p>}
        </>
      ) : (
        <PropertyTable
          properties={data.properties}
          specs={binding?.properties ?? []}
          todo={data.todo}
          references={references}
          locked={locked}
          onChange={setProps}
          onReferenceChange={onReferenceChange}
        />
      )}
    </section>
  );
}

/** The node's binding: the one it was created from, else the one its first compatible matches. */
function useBinding(created: Binding | undefined, compatible: string | undefined): Binding | undefined {
  const [found, setFound] = useState<Binding | undefined>();
  useEffect(() => {
    setFound(undefined);
    if (created || !compatible || !inTauri) return;
    let stale = false;
    backend
      .searchBindings(compatible, null, 50)
      .then((list) => {
        if (!stale) setFound(list.find((b) => b.compatibles?.includes(compatible)));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [created, compatible]);
  return created ?? found;
}
