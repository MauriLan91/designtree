// The property table (US-17.1): Key · Type · Value rows, plist style. Each
// property is one row; values with parts (string lists, cells, bytes, mixed
// chunks, the references of a phandle list) expand into one row per part.
// The rows are drawn from the model in propertyTable.ts. The binding's
// required properties are pinned on top and never go away (US-17.2): one
// without a value is an empty to-do row until it gets one.
import { ChevronDown, ChevronLeft, ChevronRight, Plus, RotateCcw, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { backend, inTauri } from "../backend";
import { baseOf, type DtMacro, type NumberBase, type Property, type PropertySpec, type PropertyValue } from "../model";
import {
  KIND_TITLES,
  blank,
  blankItem,
  convert,
  entriesOf,
  formatNumber,
  HEX_LINE,
  hexLines,
  kindOf,
  PAGE,
  parseCellText,
  parseSummary,
  referenceOf,
  referenceTo,
  sizeOf,
  sizeText,
  summaryOf,
  itemRows,
  withEntry,
  withHexLine,
  withItem,
  withoutEntry,
  withoutItem,
  type ValueKind,
} from "../propertyTable";
import { checkValue, specDefault } from "../schemaProps";
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
  /** Cells per entry of `reg`, `ranges` and `interrupts`, from the
   * devicetree around the node; other properties take the schema's. */
  entryCells?: Record<string, number>;
  /** The labels of the design, which a Reference value picks from. */
  labels?: string[];
  /** Every property is a node reference, as under `/aliases` (US-17.5). */
  referencesOnly?: boolean;
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


/** Rows drawn before "Show more": past it a table of every row is slow to draw. */
const ROW_LIMIT = 100;

export function PropertyTable({ properties, specs, todo, references, locked, onChange, onReferenceChange, entryCells, labels = [], referencesOnly }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One-string values the user made a list; the binding says so for its own.
  const [lists, setLists] = useState<ReadonlySet<string>>(new Set());
  // The page shown of each long list (US-17.8).
  const [pages, setPages] = useState<Record<string, number>>({});
  // A node with thousands of properties draws the first ones until asked (US-11.3).
  const [allRows, setAllRows] = useState(false);
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
      else onChange(properties.map((p) => (p.name === name ? { ...p, value: result } : p)));
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
    const kind = referencesOnly ? "reference" : (specKind(specOf(n)) ?? "flag");
    onChange([...properties, { name: n, value: blank(kind) }]);
    if (kind !== "flag" && kind !== "reference") setOpen((s) => new Set(s).add(n));
  };

  const refGroups = new Map<string, Reference[]>();
  for (const r of references) refGroups.set(r.property, [...(refGroups.get(r.property) ?? []), r]);
  const unused = specs.filter((s) => !s.required && s.name !== "compatible" && !properties.some((p) => p.name === s.name) && !refGroups.has(s.name));

  // Required first, in binding order, then the properties and references
  // in their own order. A row is a property, a reference group, or a
  // required property the node lacks.
  const pinned = [...new Set(specs.filter((s) => s.required && s.name !== "compatible").map((s) => s.name))];
  const isPinned = new Set(pinned);
  type Row = { name: string; prop?: Property; refs?: Reference[] };
  const row = (name: string): Row => ({ name, prop: properties.find((p) => p.name === name), refs: refGroups.get(name) });
  const rows: Row[] = [
    ...pinned.map(row),
    ...properties.filter((p) => !isPinned.has(p.name)).map((p) => row(p.name)),
    ...[...refGroups.keys()].filter((n) => !isPinned.has(n) && !properties.some((p) => p.name === n)).map(row),
  ];

  /** A required property back to its binding default, or to its to-do row. */
  const reset = (name: string) => {
    const value = specDefault(specOf(name)!);
    if (!value) return attempt(name, () => null);
    if (properties.some((p) => p.name === name)) attempt(name, () => value);
    else onChange([...properties, { name, value }]);
  };

  /** A reference property: one row, with a child row per target for its specifier cells. */
  const refRows = (property: string, refs: Reference[], required: boolean) => {
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
              {required && <b title="Required by the binding">*</b>}
            </div>
          </th>
          <td className="type">{refs.length > 1 ? "Phandle list" : "Phandle"}</td>
          <td className="ref-summary">{refs.map((r) => `${r.target}${r.args.length ? ` ${r.args.map((c) => formatNumber(c)).join(" ")}` : ""}`).join(", ")}</td>
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
  };

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
        {(allRows ? rows : rows.slice(0, ROW_LIMIT)).map(({ name, prop: p, refs }) => {
          const spec = specOf(name);
          if (refs && !p) return refRows(name, refs, spec?.required ?? false);
          if (!p) return <MissingRow key={name} spec={spec!} locked={locked} onSet={(value) => onChange([...properties, { name, value }])} onReset={() => reset(name)} />;
          const fixed = specKind(spec);
          const kind = kindOf(p.value, fixed === "strings" || lists.has(p.name));
          const base = baseOf(p);
          const items = itemRows(p.value, kind, base, spec?.type);
          // A cell list with a known entry width expands into its entries.
          const width = entryCells?.[p.name] ?? spec?.entry_cells;
          const entries = width && width > 1 && items && isCellList(p.value) ? entriesOf(items, width) : null;
          const expanded = open.has(p.name) && items !== null;
          // A byte array is edited as a hex grid; long lists go by pages.
          const grid = p.value.type === "bytes" ? p.value.value : null;
          const total = entries?.length ?? items?.length ?? 0;
          const pageCount = Math.max(1, Math.ceil(total / PAGE));
          const page = Math.min(pages[p.name] ?? 0, pageCount - 1);
          const first = page * PAGE;
          const shown = <T,>(list: T[]) => (total > PAGE ? list.slice(first, first + PAGE) : list);
          const warning = errors[p.name] ?? checkValue(spec ?? { name: p.name, required: false }, p.value, width);
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
                  ) : referencesOnly && kind === "reference" ? (
                    <span className="type" title="Every property of this node is a reference">
                      Reference
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
                      {(referencesOnly ? [kind, "reference" as const] : KINDS).map((k) => (
                        <option key={k} value={k}>
                          {KIND_TITLES[k]}
                        </option>
                      ))}
                    </select>
                  )}
                  {hasNumbers(p.value) && (
                    <select
                      className="base-select"
                      aria-label={`Number base of ${p.name}`}
                      title="Show and write the numbers in decimal, hexadecimal or octal"
                      value={base}
                      disabled={locked}
                      onChange={(e) => onChange(properties.map((q) => (q.name === p.name ? { ...q, base: e.target.value as NumberBase } : q)))}
                    >
                      {BASES.map(([b, title]) => (
                        <option key={b} value={b}>
                          {title}
                        </option>
                      ))}
                    </select>
                  )}
                  {kind !== "flag" && kind !== "reference" && (
                    <span className="value-size" title="Size of the value in the blob">
                      {sizeText(sizeOf(p.value))}
                    </span>
                  )}
                </td>
                <td>
                  <ValueCell
                    name={p.name}
                    value={p.value}
                    base={base}
                    kind={kind}
                    width={entries ? width : undefined}
                    spec={spec}
                    disabled={locked}
                    // Clearing a value removes the property, as deleting its line in the DTS
                    // would; a required one goes back to its to-do row.
                    onCommit={(text) => {
                      attempt(p.name, () => (text.trim() ? parseSummary(kind, text, p.value) : null));
                    }}
                    onSet={(value) => attempt(p.name, () => value)}
                    labels={labels}
                    onClear={() => (spec?.required ? reset(p.name) : attempt(p.name, () => null))}
                  />
                  {warning && <span className="row-error">{warning}</span>}
                  {isTodo && !warning && <span className="row-todo">to do</span>}
                </td>
                <td>
                  {!locked &&
                    (spec?.required ? (
                      <ResetButton spec={spec} onReset={() => reset(p.name)} />
                    ) : (
                      <button className="row-remove" aria-label={`Remove ${p.name}`} onClick={() => attempt(p.name, () => null)}>
                        <X size={12} aria-hidden />
                      </button>
                    ))}
                </td>
              </tr>
              {expanded && grid && (
                <tr className="item-row hex-row">
                  <td colSpan={4}>
                    <HexGrid
                      name={p.name}
                      bytes={grid}
                      disabled={locked}
                      onLine={(line, text) => attempt(`${p.name}#${line}`, () => ({ type: "bytes", value: withHexLine(grid, line, text) }), p.name)}
                      errors={errors}
                    />
                  </td>
                </tr>
              )}
              {expanded && !grid && total > PAGE && (
                <tr className="item-row pager-row">
                  <td colSpan={4}>
                    <Pager
                      name={p.name}
                      first={first}
                      count={Math.min(PAGE, total - first)}
                      total={total}
                      what={entries ? "entries" : "items"}
                      page={page}
                      pages={pageCount}
                      onPage={(n) => setPages((s) => ({ ...s, [p.name]: n }))}
                    />
                  </td>
                </tr>
              )}
              {expanded &&
                entries &&
                shown(entries).map((cells, k) => {
                  const i = first + k;
                  const key = `${p.name}[${i}]`;
                  return (
                    <tr key={key} className="item-row entry-row">
                      {/* One cell across key, type and value: an entry is a few
                          numbers side by side, and the inspector is narrow. */}
                      <td colSpan={3}>
                        <div className="entry">
                          <span className="item-index">{i}</span>
                          <div className="entry-cells" role="group" aria-label={`${p.name} entry ${i}`}>
                            {cells.map((text, j) => (
                              <CellInput
                                key={j}
                                value={text}
                                label={`${p.name} entry ${i} cell ${j}`}
                                disabled={locked}
                                onCommit={(t) => attempt(key, () => withItem(p.value, i * width! + j, t), p.name)}
                              />
                            ))}
                          </div>
                        </div>
                        {errors[key] && <span className="row-error">{errors[key]}</span>}
                      </td>
                      <td>
                        {!locked && (
                          <button className="row-remove" aria-label={`Remove entry ${i}`} onClick={() => attempt(key, () => withoutEntry(p.value, i, width!), p.name)}>
                            <X size={12} aria-hidden />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {expanded &&
                !entries &&
                !grid &&
                shown(items!).map((text, k) => {
                  const i = first + k;
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
                            multiline={p.value.type === "strings"}
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
              {expanded && !locked && !grid && (
                <tr className="item-row add-item">
                  <th scope="row" />
                  <td colSpan={3}>
                    {entries ? (
                      <button className="link" onClick={() => attempt(p.name, () => withEntry(p.value, width!))}>
                        <Plus size={12} aria-hidden /> Add entry
                      </button>
                    ) : (
                      <button
                        className="link"
                        onClick={() => attempt(p.name, () => withItem(p.value, items!.length, blankItem(p.value)))}
                      >
                        <Plus size={12} aria-hidden /> Add {itemKind(p.value).toLowerCase()}
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {!allRows && rows.length > ROW_LIMIT && (
          <tr className="more-rows">
            <td colSpan={4}>
              <button className="link" onClick={() => setAllRows(true)}>
                Show {rows.length - ROW_LIMIT} more properties
              </button>
            </td>
          </tr>
        )}
        {!locked && (
          <tr className="add-row">
            <td colSpan={4}>
              <AddProperty specs={unused} onAdd={add} />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** Required rows reset instead of going away: to the default, else to empty. */
function ResetButton({ spec, onReset }: { spec: PropertySpec; onReset: () => void }) {
  const value = specDefault(spec);
  const title = value ? `Reset to the default, ${summaryOf(value) || "present"}` : "Clear: a required property stays as a to-do";
  return (
    <button className="row-remove" aria-label={`Reset ${spec.name}`} title={title} onClick={onReset}>
      <RotateCcw size={12} aria-hidden />
    </button>
  );
}

/** A required property the node does not have yet: typing a value adds it. */
function MissingRow({
  spec,
  locked,
  onSet,
  onReset,
}: {
  spec: PropertySpec;
  locked: boolean;
  onSet: (value: PropertyValue) => void;
  onReset: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const kind = specKind(spec);
  // A phandle is a reference, which the canvas draws as an edge.
  const reference = spec.type === "phandle" || spec.type === "phandle-array";
  const hasDefault = specDefault(spec) !== null;
  const commit = (text: string) => {
    if (!text.trim()) return;
    try {
      // Without a schema type, a value is DTS chunks or a bare cell list.
      onSet(kind ? parseSummary(kind, text) : parseUntyped(text));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <tr className="todo missing-row">
      <th scope="row" title={spec.description ?? undefined}>
        <div className="key">
          <span className="twisty" aria-hidden />
          <span className="key-text">{spec.name}</span>
          <b title="Required by the binding">*</b>
        </div>
      </th>
      <td>
        <span className="type">{spec.type ?? "Any"}</span>
      </td>
      <td>
        {reference ? (
          <span className="row-hint" title="A phandle is drawn as a reference: connect this node to its target on the canvas">
            Connect on canvas
          </span>
        ) : kind === "flag" ? (
          <input type="checkbox" aria-label={spec.name} checked={false} disabled={locked} onChange={() => onSet({ type: "empty" })} />
        ) : spec.enum?.length && (kind === "string" || kind === "cells") ? (
          <select aria-label={spec.name} value="" disabled={locked} onChange={(e) => commit(e.target.value)}>
            <option value="">(select)</option>
            {spec.enum.map((v) => (
              <option key={String(v)} value={typeof v === "number" ? formatNumber(v, baseOf(spec)) : String(v)}>
                {String(v)}
              </option>
            ))}
          </select>
        ) : (
          <CommitInput
            value=""
            label={spec.name}
            placeholder={hasDefault ? "default available" : "required"}
            disabled={locked}
            onInput={() => setError(null)}
            onCommit={commit}
          />
        )}
        {error && <span className="row-error">{error}</span>}
      </td>
      <td>
        {!locked && hasDefault && <ResetButton spec={spec} onReset={onReset} />}
      </td>
    </tr>
  );
}

function parseUntyped(text: string): PropertyValue {
  try {
    return parseSummary("mixed", text);
  } catch {
    return parseSummary("cells", text);
  }
}

const BASES: [NumberBase, string][] = [
  ["dec", "Dec"],
  ["hex", "Hex"],
  ["oct", "Oct"],
];

/** Whether a value holds a number a base applies to. */
function hasNumbers(v: PropertyValue): boolean {
  if (v.type === "cells") return v.value.length > 0;
  return v.type === "mixed" && v.value.some((c) => c.type === "cells" && c.cells.some((x) => typeof x === "number"));
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
  base,
  kind,
  width,
  spec,
  disabled,
  onCommit,
  onSet,
  onClear,
  labels,
}: {
  labels: string[];
  name: string;
  value: PropertyValue;
  base: NumberBase;
  kind: ValueKind;
  /** Cells per entry, when the value reads as `<…>, <…>` groups. */
  width?: number;
  spec: PropertySpec | undefined;
  disabled: boolean;
  onCommit: (text: string) => void;
  onSet: (value: PropertyValue) => void;
  /** Unticking a flag: a flag is set by being present, so it goes away. */
  onClear: () => void;
}): ReactNode {
  if (kind === "flag") return <input type="checkbox" aria-label={name} checked disabled={disabled} onChange={onClear} title="Untick to remove it" />;
  if (kind === "reference") {
    const target = referenceOf(value) ?? "";
    const shown = (t: string) => (t.startsWith("/") ? `&{${t}}` : `&${t}`);
    return (
      <select aria-label={name} value={target} disabled={disabled} onChange={(e) => onSet(referenceTo(e.target.value))}>
        {!labels.includes(target) && <option value={target}>{target ? shown(target) : "(select a node)"}</option>}
        {labels.map((l) => (
          <option key={l} value={l}>
            {shown(l)}
          </option>
        ))}
      </select>
    );
  }
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
    const current = summaryOf(value, kind, base);
    return (
      <select aria-label={name} value={current} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
        {!spec.enum.map((v) => formatNumber(v as number, base)).includes(current) && <option value={current}>{current || "(select)"}</option>}
        {spec.enum.map((v) => (
          <option key={String(v)} value={formatNumber(v as number, base)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }
  return <CommitInput value={summaryOf(value, kind, base, width)} label={name} multiline={kind === "string"} disabled={disabled} onCommit={onCommit} />;
}

/** Characters past which a string gets a box of several lines. */
const LONG_TEXT = 40;

/** A text input that applies its value on Enter or when it loses focus. */
function CommitInput({
  value,
  label,
  disabled,
  onCommit,
  list,
  onInput,
  placeholder,
  multiline,
}: {
  value: string;
  label: string;
  placeholder?: string;
  /** A long text (a string over a line) is edited in a box of several
   * lines (US-17.8). Enter still applies it; Shift+Enter breaks the line. */
  multiline?: boolean;
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
  if (multiline && (value.length > LONG_TEXT || value.includes("\n"))) {
    return (
      <textarea
        className="long-text"
        aria-label={label}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        spellCheck={false}
        rows={Math.min(8, Math.max(2, Math.ceil(text.length / 40) + text.split("\n").length - 1))}
        onChange={(e) => {
          setText(e.target.value);
          onInput?.(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setText(value);
        }}
      />
    );
  }
  return (
    <input
      aria-label={label}
      value={text}
      disabled={disabled}
      list={list}
      placeholder={placeholder}
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

/** The last row: a property name, with the binding's optional ones offered. */
function AddProperty({ specs, onAdd }: { specs: PropertySpec[]; onAdd: (name: string) => void }) {
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
        {specs.map((s) => (
          <option key={s.name} value={s.name} label={[s.type, s.description?.split("\n")[0]].filter(Boolean).join(" · ")} />
        ))}
      </datalist>
    </div>
  );
}

/** A byte array as a hex dump (US-17.8): an offset, 16 bytes to edit and
 * their printable text per line. A line may be given more or fewer bytes;
 * the empty line at the end adds bytes. */
function HexGrid({
  name,
  bytes,
  disabled,
  onLine,
  errors,
}: {
  name: string;
  bytes: number[];
  disabled: boolean;
  onLine: (line: number, text: string) => void;
  errors: Record<string, string>;
}) {
  const [page, setPage] = useState(0);
  const lines = hexLines(bytes);
  // A full last line leaves room for one more, to append to.
  if (!disabled && bytes.length % HEX_LINE === 0) lines.push({ offset: bytes.length.toString(16).padStart(4, "0"), hex: "", ascii: "" });
  const pages = Math.max(1, Math.ceil(lines.length / PAGE));
  const at = Math.min(page, pages - 1) * PAGE;
  return (
    <div className="hex-grid" role="group" aria-label={`${name} bytes`}>
      {pages > 1 && (
        <Pager name={name} first={at * HEX_LINE} count={Math.min(PAGE * HEX_LINE, bytes.length - at * HEX_LINE)} total={bytes.length} what="bytes" page={Math.min(page, pages - 1)} pages={pages} onPage={setPage} />
      )}
      {lines.slice(at, at + PAGE).map((l, k) => {
        const line = at + k;
        return (
          <Fragment key={line}>
            <div className="hex-line">
              <span className="hex-offset">{l.offset}</span>
              <CommitInput value={l.hex} label={`${name} bytes ${l.offset}`} placeholder="add bytes" disabled={disabled} onCommit={(t) => onLine(line, t)} />
              <span className="hex-ascii" aria-hidden>
                {l.ascii}
              </span>
            </div>
            {errors[`${name}#${line}`] && <span className="row-error">{errors[`${name}#${line}`]}</span>}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Where a long list is, and buttons to the pages before and after. */
function Pager({
  name,
  first,
  count,
  total,
  what,
  page,
  pages,
  onPage,
}: {
  name: string;
  first: number;
  count: number;
  total: number;
  what: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="pager" role="group" aria-label={`Pages of ${name}`}>
      <button className="link" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={12} aria-hidden />
      </button>
      <span>
        {what} {first}–{first + count - 1} of {total}
      </span>
      <button className="link" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <ChevronRight size={12} aria-hidden />
      </button>
    </div>
  );
}
