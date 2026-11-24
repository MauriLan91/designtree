// The property table (US-17.1): Key · Type · Value rows, plist style. Each
// property is one row; values with parts (string lists, cells, bytes, mixed
// chunks, the references of a phandle list) expand into one row per part.
// The rows are drawn from the model in propertyTable.ts. The binding's
// required properties are pinned on top and never go away (US-17.2): one
// without a value is an empty to-do row until it gets one.
import { ChevronDown, ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { backend, inTauri } from "../backend";
import {
  baseAt,
  baseOf,
  basesOf,
  literalBase,
  nextBase,
  withCellBase,
  withoutCellBases,
  withTypedBases,
  type Bases,
  type DtMacro,
  type NumberBase,
  type Property,
  type PropertySpec,
  type PropertyValue,
} from "../model";
import {
  KIND_CHIPS,
  KIND_TITLES,
  blank,
  blankItem,
  cellWords,
  convert,
  elideMiddle,
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
  typeChip,
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
  const [keyWidth, setKeyWidth] = useKeyWidth();
  /** Characters of a key that fit its column: the column less the twisty,
   * the field's padding, the size (`16 B`, 10px digits) and the required
   * mark, at the mono's 0.6em per character. */
  const keyFit = (size = "", required = false) =>
    Math.max(4, Math.floor((keyWidth - 30 - (size ? size.length * 6 + 6 : 0) - (required ? 10 : 0)) / 7.2));
  const keyChars = keyFit("", true);
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

  /** Runs an edit of `key`'s row that changes more of property `name` than its value. */
  const update = (key: string, name: string, edit: (p: Property) => Property | null) =>
    attempt(key, () => properties.flatMap((q) => (q.name !== name ? [q] : (edit(q) ?? []))), name);

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
                {elideMiddle(property, keyChars)}
              </span>
              {required && <b title="Required by the binding">*</b>}
            </div>
          </th>
          <td>
            <TypeChip short={refs.length > 1 ? "phandle[]" : "phandle"} title={refs.length > 1 ? "Phandle list" : "Phandle"} />
          </td>
          <td className="ref-summary" title={refSummary(refs)}>
            {refSummary(refs)}
          </td>
          <td />
        </tr>
        {expanded &&
          refs.map((r) => (
            <tr key={r.id} className="item-row">
              <th scope="row">
                <span className="item-index ref-target">{r.target}</span>
              </th>
              <td>
                <TypeChip short="cells" title="Specifier cells" />
              </td>
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
      <colgroup>
        <col style={{ width: keyWidth }} />
        <col className="col-type" />
        <col />
        <col className="col-actions" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="key-head">
            Key
            <KeyResizer width={keyWidth} onResize={setKeyWidth} />
          </th>
          <th scope="col">Type</th>
          <th scope="col">Value</th>
          <th aria-label="Remove" />
        </tr>
      </thead>
      <tbody>
        {(allRows ? rows : rows.slice(0, ROW_LIMIT)).map(({ name, prop: p, refs }) => {
          const spec = specOf(name);
          if (refs && !p) return refRows(name, refs, spec?.required ?? false);
          if (!p) return <MissingRow key={name} spec={spec!} keyChars={keyChars} locked={locked} onSet={(value) => onChange([...properties, { name, value }])} onReset={() => reset(name)} />;
          const fixed = specKind(spec);
          const kind = kindOf(p.value, fixed === "strings" || lists.has(p.name));
          const base = baseOf(p);
          const bases = basesOf(p);
          const items = itemRows(p.value, kind, bases, spec?.type);
          // The base toggle of one cell (US-17.6), and of the whole value.
          const cellToggle = (i: number, label: string) =>
            isCellList(p.value) && typeof cellsAt(p.value, i) === "number" ? (
              <BaseToggle base={baseAt(bases, i)} label={label} disabled={locked} onCycle={() => update(`${p.name}[${i}]`, p.name, (q) => withCellBase(q, nextBase(baseAt(bases, i)), i))} />
            ) : undefined;
          /** A cell typed in a base that tells keeps it. */
          const typedCell = (q: Property, i: number, text: string) => {
            const b = literalBase(text);
            return b ? withCellBase(q, b, i) : q;
          };
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
          const size = kind !== "flag" && kind !== "reference" ? sizeText(sizeOf(p.value)) : "";
          // Items are added at the end of the list, on its last row (US-17.7).
          const what = entries ? "entry" : itemKind(p.value).toLowerCase();
          const addItem = !locked && (
            <button
              className="row-add"
              aria-label={`Add ${what} to ${p.name}`}
              title={`Add ${what}`}
              onClick={() => attempt(p.name, () => (entries ? withEntry(p.value, width!) : withItem(p.value, items!.length, blankItem(p.value))))}
            >
              <Plus size={12} aria-hidden />
            </button>
          );
          const last = (i: number) => i === total - 1;
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
                      shown={elideMiddle(p.name, keyFit(size, spec?.required))}
                      title={spec?.description ? `${p.name}\n${spec.description}` : p.name}
                      label="Property name"
                      disabled={locked || spec?.required}
                      onCommit={(to) => rename(p.name, to)}
                    />
                    {spec?.required && <b title="Required by the binding">*</b>}
                    {size && (
                      <span className="value-size" title="Size of the value in the blob">
                        {size}
                      </span>
                    )}
                  </div>
                </th>
                <td>
                  <span className="type-cell">
                    {fixed ? (
                      <TypeChip short={typeChip(spec!.type!)} title={`Type from the binding: ${spec!.type}`} />
                    ) : referencesOnly && kind === "reference" ? (
                      <TypeChip short={KIND_CHIPS.reference} title="Every property of this node is a reference" />
                    ) : (
                      <TypeChip
                        short={KIND_CHIPS[kind]}
                        title={`${KIND_TITLES[kind]}: click to change the type`}
                        label={`Type of ${p.name}`}
                        value={kind}
                        options={referencesOnly ? [kind, "reference" as const] : KINDS}
                        disabled={locked}
                        onPick={(to) => {
                          setLists((s) => {
                            const next = new Set(s);
                            if (to === "strings") next.add(p.name);
                            else next.delete(p.name);
                            return next;
                          });
                          attempt(p.name, () => convert(p.value, to));
                        }}
                      />
                    )}
                  </span>
                </td>
                <td>
                  <ValueCell
                    name={p.name}
                    value={p.value}
                    base={bases}
                    kind={kind}
                    toggle={
                      hasNumbers(p.value) ? (
                        <BaseToggle
                          base={base}
                          label={`Number base of ${p.name}`}
                          mixed={!!p.bases?.length}
                          disabled={locked}
                          onCycle={() => update(p.name, p.name, (q) => withCellBase(q, nextBase(base)))}
                        />
                      ) : undefined
                    }
                    width={entries ? width : undefined}
                    spec={spec}
                    disabled={locked}
                    // Clearing a value removes the property, as deleting its line in the DTS
                    // would; a required one goes back to its to-do row.
                    onCommit={(text) => {
                      if (!text.trim()) return attempt(p.name, () => null);
                      update(p.name, p.name, (q) => {
                        const next = { ...q, value: parseSummary(kind, text, p.value) };
                        return isCellList(next.value) ? withTypedBases(next, cellWords(text)) : next;
                      });
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
                                toggle={cellToggle(i * width! + j, `Number base of ${p.name} entry ${i} cell ${j}`)}
                                onCommit={(t, typed) =>
                                  update(key, p.name, (q) => {
                                    const next = { ...q, value: withItem(p.value, i * width! + j, t) };
                                    return typed ? typedCell(next, i * width! + j, t) : next;
                                  })
                                }
                              />
                            ))}
                          </div>
                          {last(i) && addItem}
                        </div>
                        {errors[key] && <span className="row-error">{errors[key]}</span>}
                      </td>
                      <td>
                        {!locked && (
                          <span className="item-actions">
                            <button className="row-remove" aria-label={`Remove entry ${i}`} title="Remove this entry" onClick={() => update(key, p.name, (q) => withoutCellBases({ ...q, value: withoutEntry(p.value, i, width!) }, i * width!, width!))}>
                              <Minus size={12} aria-hidden />
                            </button>
                          </span>
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
                      <td>
                        <TypeChip short={itemKind(p.value).toLowerCase()} title={itemKind(p.value)} />
                      </td>
                      <td>
                        <span className="item-value">
                          {isCellList(p.value) ? (
                            <CellInput
                              value={text}
                              label={`${p.name} cell ${i}`}
                              disabled={locked}
                              toggle={cellToggle(i, `Number base of ${p.name} cell ${i}`)}
                              onCommit={(t, typed) =>
                                update(key, p.name, (q) => {
                                  const next = { ...q, value: withItem(p.value, i, t) };
                                  return typed ? typedCell(next, i, t) : next;
                                })
                              }
                            />
                          ) : (
                            <CommitInput
                              value={text}
                              title={text}
                              label={`${p.name} item ${i}`}
                              multiline={p.value.type === "strings"}
                              disabled={locked}
                              onCommit={(t) => attempt(key, () => withItem(p.value, i, t), p.name)}
                            />
                          )}
                          {last(i) && addItem}
                        </span>
                        {errors[key] && <span className="row-error">{errors[key]}</span>}
                      </td>
                      <td>
                        {!locked && (
                          <span className="item-actions">
                            <button
                              className="row-remove"
                              aria-label={`Remove item ${i}`}
                              title={`Remove this ${what}`}
                              onClick={() =>
                                isCellList(p.value)
                                  ? update(key, p.name, (q) => withoutCellBases({ ...q, value: withoutItem(p.value, i) }, i))
                                  : attempt(key, () => withoutItem(p.value, i), p.name)
                              }
                            >
                              <Minus size={12} aria-hidden />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {expanded && !locked && !grid && total === 0 && (
                <tr className="item-row empty-list">
                  <th scope="row" />
                  <td colSpan={3}>
                    <span className="item-value">
                      <span className="row-hint">No {what === "entry" ? "entries" : `${what}s`}</span>
                      {addItem}
                    </span>
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
  keyChars,
  locked,
  onSet,
  onReset,
}: {
  spec: PropertySpec;
  keyChars: number;
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
          <span className="key-text" title={spec.name}>
            {elideMiddle(spec.name, keyChars)}
          </span>
          <b title="Required by the binding">*</b>
        </div>
      </th>
      <td>
        <TypeChip short={spec.type ? typeChip(spec.type) : "any"} title={spec.type ? `Type from the binding: ${spec.type}` : "Any type"} />
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

const refSummary = (refs: Reference[]) =>
  refs.map((r) => `${r.target}${r.args.length ? ` ${r.args.map((c) => formatNumber(c)).join(" ")}` : ""}`).join(", ");

/**
 * The type of a row as a short chip (US-17.7): `u32[]`, `str`, `cells`.
 * With options, a click opens the type list; a native select lies over the
 * chip, so the list and the keyboard work as everywhere else.
 */
function TypeChip<T extends string>({
  short,
  title,
  label,
  value,
  options,
  disabled,
  onPick,
}: {
  short: string;
  title: string;
  label?: string;
  value?: T;
  options?: readonly T[];
  disabled?: boolean;
  onPick?: (to: T) => void;
}) {
  if (!options || !onPick) {
    return (
      <span className="type-chip" title={title}>
        {short}
      </span>
    );
  }
  return (
    <span className={`type-chip pick${disabled ? " disabled" : ""}`} title={title}>
      {short}
      <ChevronDown size={10} aria-hidden />
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((k) => (
          <option key={k} value={k}>
            {KIND_TITLES[k as ValueKind] ?? k}
          </option>
        ))}
      </select>
    </span>
  );
}

const KEY_WIDTH = { key: "designtree.propertyKeyWidth", min: 72, max: 360, initial: 120 };

/** The width of the Key column, kept for the user across nodes and sessions. */
function useKeyWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(KEY_WIDTH.key));
    return Number.isFinite(stored) && stored >= KEY_WIDTH.min ? Math.min(stored, KEY_WIDTH.max) : KEY_WIDTH.initial;
  });
  const set = (w: number) => {
    const clamped = Math.round(Math.min(KEY_WIDTH.max, Math.max(KEY_WIDTH.min, w)));
    setWidth(clamped);
    try {
      localStorage.setItem(KEY_WIDTH.key, String(clamped));
    } catch {
      // Storage can be blocked; the width then lasts for this session.
    }
  };
  return [width, set];
}

/** The edge of the Key header: drag to resize, arrows to nudge, double-click to reset. */
function KeyResizer({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  return (
    <span
      className="col-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Key column width"
      aria-valuenow={width}
      aria-valuemin={KEY_WIDTH.min}
      aria-valuemax={KEY_WIDTH.max}
      tabIndex={0}
      title="Drag to resize the Key column; double-click to reset"
      onPointerDown={(e) => {
        const start = e.clientX;
        const from = width;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => onResize(from + m.clientX - start);
        const up = () => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", up);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", up);
      }}
      onDoubleClick={() => onResize(KEY_WIDTH.initial)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onResize(width - 8);
        else if (e.key === "ArrowRight") onResize(width + 8);
        else return;
        e.preventDefault();
      }}
    />
  );
}

const BASE_NAMES: Record<NumberBase, string> = { dec: "decimal", hex: "hexadecimal", oct: "octal" };

/**
 * The base of a number field (US-17.6): its letter inside the field, h, d
 * or o. One click goes on to the next base and the field shows the number
 * in it at once; the tooltip says which base comes next.
 */
function BaseToggle({ base, label, mixed, disabled, onCycle }: { base: NumberBase; label: string; mixed?: boolean; disabled?: boolean; onCycle: () => void }) {
  const next = nextBase(base);
  const title = `Shown in ${BASE_NAMES[base]}${mixed ? " (some cells have their own base)" : ""}. Click for ${BASE_NAMES[next]}${mixed ? ", for every cell" : ""}.`;
  return (
    <button type="button" className={`base-toggle base-${base}${mixed ? " mixed" : ""}`} aria-label={`${label}: ${BASE_NAMES[base]}`} title={title} disabled={disabled} onClick={onCycle}>
      {base[0]}
    </button>
  );
}

/** Cell `i` of a cell list. */
function cellsAt(v: PropertyValue, i: number) {
  if (v.type === "cells") return v.value[i];
  return v.type === "mixed" && v.value[0]?.type === "cells" ? v.value[0].cells[i] : undefined;
}

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
  toggle,
}: {
  labels: string[];
  name: string;
  value: PropertyValue;
  base: Bases;
  /** The base toggle drawn inside the field. */
  toggle?: ReactNode;
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
    const first = baseAt(base, 0);
    const select = (
      <select aria-label={name} value={current} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
        {!spec.enum.map((v) => formatNumber(v as number, first)).includes(current) && <option value={current}>{current || "(select)"}</option>}
        {spec.enum.map((v) => (
          <option key={String(v)} value={formatNumber(v as number, first)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
    return toggle ? <WithAddon addon={toggle}>{select}</WithAddon> : select;
  }
  const text = summaryOf(value, kind, base, width);
  return <CommitInput value={text} title={text} label={name} multiline={kind === "string"} disabled={disabled} onCommit={onCommit} addon={toggle} />;
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
  addon,
  shown: display,
  title,
}: {
  value: string;
  label: string;
  /** What the field shows while it is not being edited (a key elided in the middle). */
  shown?: string;
  /** The tooltip: the full text, when the field may cut it. */
  title?: string;
  placeholder?: string;
  /** A control drawn inside the field, at its end (the base toggle). */
  addon?: ReactNode;
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
  const [editing, setEditing] = useState(false);
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
  const input = (
    <input
      aria-label={label}
      value={display !== undefined && !editing && text === value ? display : text}
      title={title}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      list={list}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        onInput?.(e.target.value);
      }}
      onBlur={() => {
        setEditing(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setText(value);
      }}
    />
  );
  return addon ? <WithAddon addon={addon}>{input}</WithAddon> : input;
}

/** A field with a control inside its end. */
const WithAddon = ({ addon, children }: { addon: ReactNode; children: ReactNode }) => (
  <span className="with-addon">
    {children}
    {addon}
  </span>
);

/**
 * A cell: a number, a reference, or a `dt-bindings` constant, suggested as
 * it is typed. A constant becomes its number when the loaded kernel knows it,
 * as in the specifier editor; otherwise its name is kept.
 */
/** A cell: a number, a macro or a reference. `typed` is false when the
 * text is a macro's value filled in for it, whose base tells nothing. */
function CellInput({
  value,
  label,
  disabled,
  onCommit,
  toggle,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onCommit: (text: string, typed: boolean) => void;
  toggle?: ReactNode;
}) {
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
      if (typeof n === "number") return onCommit(formatNumber(n), false);
    }
    onCommit(text, true);
  };
  return (
    <>
      <CommitInput value={value} label={label} disabled={disabled} list={id} onInput={search} onCommit={commit} addon={toggle} />
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
