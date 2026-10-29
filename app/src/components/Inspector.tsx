import { useEffect, useState } from "react";
import type { Edge } from "@xyflow/react";
import { backend, inTauri } from "../backend";
import { SpecifierEditor } from "./SpecifierEditor";
import {
  checkValue,
  clearEditedTodo,
  editorKind,
  fromInputText,
  setProperty,
  toInputText,
  typedSpecs,
  type EditorKind,
} from "../schemaProps";
import {
  baseName,
  formatProperties,
  parseProperties,
  type DtFlowNode,
  type DtNodeData,
  type Binding,
  type GroupFlowNode,
  type Property,
  type PropertySpec,
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
}

export function Inspector({ node, edge, onNodeChange, onEdgeChange, providerCells, overriding, onOverride }: Props) {
  if (node?.type === "dt") {
    return (
      <NodeInspector
        key={node.id}
        node={node}
        onChange={onNodeChange}
        overriding={overriding.has(node.id)}
        onOverride={() => onOverride(node.id)}
      />
    );
  }
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
}: {
  node: DtFlowNode;
  onChange: Props["onNodeChange"];
  overriding: boolean;
  onOverride: () => void;
}) {
  const { data } = node;
  const binding = useBinding(data.binding, data.compatible[0]);
  const typed = binding?.properties ? typedSpecs(binding.properties, data.properties) : [];
  const typedNames = new Set(typed.map((s) => s.name));
  const rawProps = data.properties.filter((p) => !typedNames.has(p.name));
  const [propsText, setPropsText] = useState(formatProperties(rawProps));
  const [propsError, setPropsError] = useState<string | null>(null);
  const rawKey = formatProperties(rawProps);
  useEffect(() => setPropsText(rawKey), [rawKey]);

  const setProps = (properties: Property[]) =>
    onChange(node.id, { properties, todo: clearEditedTodo(data.todo, data.properties, properties) });

  const commitProps = () => {
    try {
      const parsed = parseProperties(propsText, rawProps);
      const replaced = new Set(parsed.map((p) => p.name));
      const kept = data.properties.filter((p) => typedNames.has(p.name) && !replaced.has(p.name));
      setProps([...kept, ...parsed]);
      setPropsError(null);
    } catch (e) {
      setPropsError((e as Error).message);
    }
  };

  const present = new Set(["compatible", ...data.properties.map((p) => p.name)]);
  const missing =
    binding?.properties?.filter((p) => p.required && p.name !== "compatible" && !present.has(p.name) && !typedNames.has(p.name)) ??
    [];
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
          <input
            value={data.name}
            disabled={isRoot || data.inherited !== undefined}
            onChange={(e) => onChange(node.id, { name: e.target.value })}
          />
        </label>
        <label>
          Unit address
          <input
            value={data.unitAddress ?? ""}
            disabled={isRoot || data.inherited !== undefined}
            onChange={(e) => onChange(node.id, { unitAddress: e.target.value })}
          />
        </label>
      </div>
      <label>
        Label
        <input
          value={data.label ?? ""}
          disabled={data.inherited?.labels?.includes(data.label ?? "") || locked}
          onChange={(e) => onChange(node.id, { label: e.target.value })}
        />
      </label>
      <label>
        Compatible (comma separated)
        <input
          value={data.compatible.join(", ")}
          disabled={locked}
          onChange={(e) =>
            onChange(node.id, { compatible: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
          }
        />
      </label>
      {typed.length > 0 && (
        <fieldset className="typed-props" disabled={locked}>
          <legend>Binding properties</legend>
          {typed.map((spec) => (
            <TypedField
              key={spec.name}
              spec={spec}
              prop={data.properties.find((p) => p.name === spec.name)}
              todo={data.todo?.includes(spec.name)}
              onSet={(value) => setProps(setProperty(data.properties, spec.name, value))}
            />
          ))}
        </fieldset>
      )}
      <label>
        {typed.length > 0 ? "Other properties" : "Properties"}
        <textarea
          rows={8}
          spellCheck={false}
          readOnly={locked}
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
              <li key={p.name} title={p.description ?? undefined}>{p.name}</li>
            ))}
          </ul>
        </div>
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

function TypedField({
  spec,
  prop,
  todo: placeholder,
  onSet,
}: {
  spec: PropertySpec;
  prop: Property | undefined;
  todo?: boolean;
  onSet: (value: Property["value"] | null) => void;
}) {
  const kind = editorKind(spec) as EditorKind;
  const current = toInputText(kind, prop);
  const [text, setText] = useState(current);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(current), [current]);

  const commit = (next: string) => {
    try {
      onSet(fromInputText(kind, next));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const warning = error ?? checkValue(spec, prop?.value);
  const todo = placeholder || (spec.required && !prop);
  const hint = [spec.description, spec.default !== undefined ? `Default: ${JSON.stringify(spec.default)}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const hintText = spec.default !== undefined ? String(spec.default) : kind === "numbers" ? "e.g. 0x10 0x20" : "";

  let input;
  if (kind === "flag") {
    input = <input type="checkbox" checked={prop !== undefined} onChange={(e) => onSet(e.target.checked ? { type: "empty" } : null)} />;
  } else if (kind === "enum") {
    input = (
      <select value={current} onChange={(e) => commit(e.target.value)}>
        <option value="">{spec.required ? "(select)" : "(not set)"}</option>
        {spec.enum!.map((v) => (
          <option key={String(v)} value={typeof v === "number" ? formatNumberOption(v) : String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  } else {
    input = (
      <input
        value={text}
        placeholder={hintText}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => e.key === "Enter" && commit(text)}
      />
    );
  }

  return (
    <label className={`typed-field${kind === "flag" ? " toggle" : ""}${todo ? " todo" : ""}`} title={hint || undefined}>
      <span>
        {spec.name}
        {spec.required && <b title="required"> *</b>}
        {todo && <em> to do</em>}
      </span>
      {input}
      {warning && <span className="error">{warning}</span>}
    </label>
  );
}

function formatNumberOption(n: number): string {
  return n < 10 ? String(n) : `0x${n.toString(16)}`;
}
