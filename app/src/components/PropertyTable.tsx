// The property table (US-17.1): Key · Type · Value rows, plist style. Each
// property is one row; values with parts (string lists, cells, bytes, mixed
// chunks, the references of a phandle list) expand into one row per part.
// The rows are drawn from the model in propertyTable.ts.
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { backend, inTauri } from "../backend";
import type { DtMacro, Property, PropertySpec, PropertyValue } from "../model";
import {
  KIND_TITLES,
  blank,
  blankItem,
  convert,
  formatNumber,
  itemsOf,
  kindOf,
  parseCellText,
  parseSummary,
  summaryOf,
  withItem,
  withoutItem,
  type ValueKind,
} from "../propertyTable";
import { checkValue } from "../schemaProps";
import { SpecifierEditor } from "./SpecifierEditor";

/** A phandle reference of the node, drawn on the canvas as an edge. */
export interface Reference {
  id: string;
  property: string;
  /** `&label` or the name of the node it points to. */
  target: string;
  args: number[];
  /** Cells the provider expects, when it says. */
  expected?: number;
}

interface Props {
  properties: Property[];
  specs: PropertySpec[];
  /** Properties still holding a placeholder value. */
  todo?: string[];
  references: Reference[];
  locked: boolean;
  onChange: (properties: Property[]) => void;
  onReferenceChange: (id: string, args: number[]) => void;
}

const KINDS = Object.keys(KIND_TITLES) as ValueKind[];

/** The table kind a schema type is edited as, when the schema gives one. */
function specKind(spec: PropertySpec | undefined): ValueKind | null {
  const t = spec?.type;
  if (!t) return null;
  if (t === "flag") return "flag";
  if (t === "string") return "string";
  if (t === "string-array" || t === "non-unique-string-array") return "strings";
  if (/^u?int8-array$/.test(t)) return "bytes";
  if (/^u?int(8|16|32|64)(-array|-matrix)?$/.test(t) || t === "phandle" || t === "address") return "cells";
  return null;
}

export function PropertyTable({ properties, specs, todo, references, locked, onChange, onReferenceChange }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One-string values the user made a list; the binding says so for its own.
  const [lists, setLists] = useState<ReadonlySet<string>>(new Set());
  // Errors are keyed by row; any change of the properties can shift the rows.
  useEffect(() => setErrors({}), [properties]);
  const specOf = (name: string) => specs.find((s) => s.name === name);
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  /** Runs an edit of `key`'s row, showing its error there instead of applying it. */
  const attempt = (key: string, edit: () => PropertyValue | Property[] | null, name = key) => {
    try {
      const result = edit();
      setErrors(({ [key]: _, ...rest }) => rest);
      if (result === null) onChange(properties.filter((p) => p.name !== name));
      else if (Array.isArray(result)) onChange(result);
      else onChange(properties.map((p) => (p.name === name ? { name, value: result } : p)));
    } catch (e) {
      setErrors((s) => ({ ...s, [key]: (e as Error).message }));
    }
  };

  const rename = (from: string, to: string) => {
    const name = to.trim();
    if (!name || name === from) return;
    if (properties.some((p) => p.name === name)) {
      setErrors((s) => ({ ...s, [from]: `${name} is already set` }));
      return;
    }
    onChange(properties.map((p) => (p.name === from ? { ...p, name } : p)));
  };

  const add = (name: string) => {
    const n = name.trim();
    if (!n || properties.some((p) => p.name === n) || references.some((r) => r.property === n)) return;
    const kind = specKind(specOf(n)) ?? "flag";
    onChange([...properties, { name: n, value: blank(kind) }]);
    if (kind !== "flag") setOpen((s) => new Set(s).add(n));
  };

  const refGroups = new Map<string, Reference[]>();
  for (const r of references) refGroups.set(r.property, [...(refGroups.get(r.property) ?? []), r]);
  const unused = specs.filter((s) => s.name !== "compatible" && !properties.some((p) => p.name === s.name) && !refGroups.has(s.name));

  return (
    <table className="prop-table">
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Type</th>
          <th scope="col">Value</th>
          <th aria-label="Remove" />
        </tr>
      </thead>
      <tbody>
        {properties.map((p) => {
          const spec = specOf(p.name);
          const fixed = specKind(spec);
          const kind = kindOf(p.value, fixed === "strings" || lists.has(p.name));
          const items = itemsOf(p.value, kind);
          const expanded = open.has(p.name) && items !== null;
          const warning = errors[p.name] ?? checkValue(spec ?? { name: p.name, required: false }, p.value);
          const isTodo = todo?.includes(p.name);
          return (
            <Fragment key={p.name}>
              <tr className={`${isTodo ? "todo " : ""}${warning ? "invalid" : ""}`}>
                <th scope="row" title={spec?.description ?? undefined}>
                  <div className="key">
                    <button
                      className="twisty"
                      aria-label={expanded ? `Collapse ${p.name}` : `Expand ${p.name}`}
                      aria-expanded={items ? expanded : undefined}
                      style={{ visibility: items ? "visible" : "hidden" }}
                      onClick={() => toggle(p.name)}
                    >
                      {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    </button>
                    <CommitInput
                      value={p.name}
                      label="Property name"
                      disabled={locked || spec?.required}
                      onCommit={(to) => rename(p.name, to)}
                    />
                    {spec?.required && <b title="Required by the binding">*</b>}
                  </div>
                </th>
                <td>
                  {fixed ? (
                    <span className="type" title={`Type from the binding: ${spec!.type}`}>
                      {spec!.type}
                    </span>
                  ) : (
                    <select
                      aria-label={`Type of ${p.name}`}
                      value={kind}
                      disabled={locked}
                      onChange={(e) => {
                        const to = e.target.value as ValueKind;
                        setLists((s) => {
                          const next = new Set(s);
                          if (to === "strings") next.add(p.name);
                          else next.delete(p.name);
                          return next;
                        });
                        attempt(p.name, () => convert(p.value, to));
                      }}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_TITLES[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <ValueCell
                    name={p.name}
                    value={p.value}
                    kind={kind}
                    spec={spec}
                    disabled={locked}
                    // Clearing a value removes the property, as deleting its line in the DTS would.
                    onCommit={(text) => attempt(p.name, () => (text.trim() ? parseSummary(kind, text, p.value) : null))}
                    onSet={(value) => attempt(p.name, () => value)}
                  />
                  {warning && <span className="row-error">{warning}</span>}
                  {isTodo && !warning && <span className="row-todo">to do</span>}
                </td>
                <td>
                  {!locked && !spec?.required && (
                    <button className="row-remove" aria-label={`Remove ${p.name}`} onClick={() => attempt(p.name, () => null)}>
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </td>
              </tr>
              {expanded &&
                items!.map((text, i) => {
                  const key = `${p.name}[${i}]`;
                  return (
                    <tr key={key} className="item-row">
                      <th scope="row">
                        <span className="item-index">{i}</span>
                      </th>
                      <td className="type">{itemKind(p.value)}</td>
                      <td>
                        {isCellList(p.value) ? (
                          <CellInput
                            value={text}
                            label={`${p.name} cell ${i}`}
                            disabled={locked}
                            onCommit={(t) => attempt(key, () => withItem(p.value, i, t), p.name)}
                          />
                        ) : (
                          <CommitInput
                            value={text}
                            label={`${p.name} item ${i}`}
                            disabled={locked}
                            onCommit={(t) => attempt(key, () => withItem(p.value, i, t), p.name)}
                          />
                        )}
                        {errors[key] && <span className="row-error">{errors[key]}</span>}
                      </td>
                      <td>
                        {!locked && (
                          <button className="row-remove" aria-label={`Remove item ${i}`} onClick={() => attempt(key, () => withoutItem(p.value, i), p.name)}>
                            <X size={12} aria-hidden />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {expanded && !locked && (
                <tr className="item-row add-item">
                  <th scope="row" />
                  <td colSpan={3}>
                    <button
                      className="link"
                      onClick={() => attempt(p.name, () => withItem(p.value, items!.length, blankItem(p.value)))}
                    >
                      <Plus size={12} aria-hidden /> Add {itemKind(p.value).toLowerCase()}
                    </button>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {[...refGroups].map(([property, refs]) => {
          const key = `ref:${property}`;
          // A reference to a provider that takes no specifier cells has nothing to edit.
          const editable = refs.some((r) => r.args.length > 0 || r.expected !== 0);
          const expanded = editable && open.has(key);
          return (
            <Fragment key={key}>
              <tr className="ref-row">
                <th scope="row" title="Drawn on the canvas as a reference">
                  <div className="key">
                    <button
                      className="twisty"
                      aria-label={expanded ? `Collapse ${property}` : `Expand ${property}`}
                      aria-expanded={editable ? expanded : undefined}
                      style={{ visibility: editable ? "visible" : "hidden" }}
                      onClick={() => toggle(key)}
                    >
                      {expanded ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    </button>
                    <span className="key-text" title={property}>
                      {property}
                    </span>
                  </div>
                </th>
                <td className="type">{refs.length > 1 ? "Phandle list" : "Phandle"}</td>
                <td className="ref-summary">{refs.map((r) => `${r.target}${r.args.length ? ` ${r.args.map(formatNumber).join(" ")}` : ""}`).join(", ")}</td>
                <td />
              </tr>
              {expanded &&
                refs.map((r) => (
                  <tr key={r.id} className="item-row">
                    <th scope="row">
                      <span className="item-index ref-target">{r.target}</span>
                    </th>
                    <td className="type">Cells</td>
                    <td colSpan={2}>
                      <SpecifierEditor compact disabled={locked} args={r.args} expected={r.expected} onChange={(args) => onReferenceChange(r.id, args)} />
                    </td>
                  </tr>
                ))}
            </Fragment>
          );
        })}
        {!locked && (
          <tr className="add-row">
            <td colSpan={4}>
              <AddProperty names={unused.map((s) => s.name)} onAdd={add} />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

const isCellList = (v: PropertyValue) =>
  v.type === "cells" || (v.type === "mixed" && v.value.length === 1 && v.value[0].type === "cells");

function itemKind(v: PropertyValue): string {
  if (isCellList(v)) return "Cell";
  if (v.type === "strings") return "String";
  if (v.type === "bytes") return "Byte";
  return "Chunk";
}

/** The value column of a property row, by type. */
function ValueCell({
  name,
  value,
  kind,
  spec,
  disabled,
  onCommit,
  onSet,
}: {
  name: string;
  value: PropertyValue;
  kind: ValueKind;
  spec: PropertySpec | undefined;
  disabled: boolean;
  onCommit: (text: string) => void;
  onSet: (value: PropertyValue) => void;
}): ReactNode {
  if (kind === "flag") return <input type="checkbox" aria-label={name} checked disabled readOnly title="Present: remove the row to clear it" />;
  if (kind === "string" && spec?.enum?.length && spec.enum.every((v) => typeof v === "string")) {
    const current = summaryOf(value);
    return (
      <select aria-label={name} value={current} disabled={disabled} onChange={(e) => onSet({ type: "strings", value: [e.target.value] })}>
        {!spec.enum.includes(current) && <option value={current}>{current || "(select)"}</option>}
        {spec.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }
  if (kind === "cells" && spec?.enum?.length && spec.enum.every((v) => typeof v === "number") && isCellList(value) && summaryOf(value).split(" ").length <= 1) {
    const current = summaryOf(value);
    return (
      <select aria-label={name} value={current} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
        {!spec.enum.map((v) => formatNumber(v as number)).includes(current) && <option value={current}>{current || "(select)"}</option>}
        {spec.enum.map((v) => (
          <option key={String(v)} value={formatNumber(v as number)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }
  return <CommitInput value={summaryOf(value, kind)} label={name} disabled={disabled} onCommit={onCommit} />;
}

/** A text input that applies its value on Enter or when it loses focus. */
function CommitInput({
  value,
  label,
  disabled,
  onCommit,
  list,
  onInput,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onCommit: (text: string) => void;
  list?: string;
  onInput?: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const shown = useRef(value);
  // Follow outside changes (undo, the canvas, the text) unless mid-edit.
  if (shown.current !== value) {
    shown.current = value;
    if (text !== value) setText(value);
  }
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      aria-label={label}
      value={text}
      disabled={disabled}
      list={list}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onInput?.(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}

/**
 * A cell: a number, a reference, or a `dt-bindings` constant, suggested as
 * it is typed. A constant becomes its number when the loaded kernel knows it,
 * as in the specifier editor; otherwise its name is kept.
 */
function CellInput({ value, label, disabled, onCommit }: { value: string; label: string; disabled?: boolean; onCommit: (text: string) => void }) {
  const [suggestions, setSuggestions] = useState<DtMacro[]>([]);
  const id = useId();
  const latest = useRef(0);
  const search = (text: string) => {
    const word = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(text.trim())?.[0];
    const request = ++latest.current;
    if (!inTauri || !word || word.length < 2) return setSuggestions([]);
    backend.searchDtMacros(word.toUpperCase()).then(
      (found) => request === latest.current && setSuggestions(found),
      () => {},
    );
  };
  const commit = async (text: string) => {
    const cell = (() => {
      try {
        return parseCellText(text);
      } catch {
        return null;
      }
    })();
    if (typeof cell === "string" && inTauri) {
      const [n] = await backend.resolveDtMacros([cell]).catch(() => [null]);
      if (typeof n === "number") return onCommit(formatNumber(n));
    }
    onCommit(text);
  };
  return (
    <>
      <CommitInput value={value} label={label} disabled={disabled} list={id} onInput={search} onCommit={commit} />
      <datalist id={id}>
        {suggestions.map((m) => (
          <option key={`${m.header}:${m.name}`} value={m.name} label={`${formatNumber(m.value)} · ${m.header}`} />
        ))}
      </datalist>
    </>
  );
}

/** The last row: a property name, with the binding's unused ones offered. */
function AddProperty({ names, onAdd }: { names: string[]; onAdd: (name: string) => void }) {
  const [text, setText] = useState("");
  const id = useId();
  const add = () => {
    onAdd(text);
    setText("");
  };
  return (
    <div className="add-property">
      <Plus size={12} aria-hidden />
      <input
        aria-label="Add a property"
        placeholder="Add a property…"
        value={text}
        list={id}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={() => text.trim() && add()}
      />
      <datalist id={id}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}
