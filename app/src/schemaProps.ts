// What a binding says about a node's properties: the limits a value is checked
// against, and the values a new node starts with (US-2.2, US-2.3). Editing is
// the property table's (propertyTable.ts).
import { type Binding, type Property, type PropertySpec, type PropertyValue } from "./model";

type EditorKind = "flag" | "enum" | "string" | "strings" | "number" | "numbers";

const SCALAR_CELLS = new Set(["uint32"]);
const CELL_LISTS = new Set(["uint32-array", "uint32-matrix"]);

/** The kind of value a spec holds, or null when it is not a simple one. */
function editorKind(spec: PropertySpec): EditorKind | null {
  if (spec.name === "compatible") return null;
  const enumOk = (check: (v: unknown) => boolean) => spec.enum?.length && spec.enum.every(check);
  switch (spec.type) {
    case "flag":
      return "flag";
    case "string":
      return enumOk((v) => typeof v === "string") ? "enum" : "string";
    case "string-array":
    case "non-unique-string-array":
      return "strings";
    default:
      if (spec.type && SCALAR_CELLS.has(spec.type)) {
        return enumOk((v) => typeof v === "number") ? "enum" : "number";
      }
      if (spec.type && CELL_LISTS.has(spec.type)) return "numbers";
      return null;
  }
}

const items = (n: number) => `${n} item${n === 1 ? "" : "s"}`;

/**
 * Problems with a value against the spec's limits, for inline warnings.
 * The binding counts the entries of a matrix (`reg`, `interrupts`), each
 * `entryCells` wide; without that width the count is left to the schema
 * check, which knows it.
 */
export function checkValue(spec: PropertySpec, value: PropertyValue | undefined, entryCells?: number): string | null {
  if (!value) return null;
  if (value.type === "cells") {
    const n = value.value;
    if (spec.minimum !== undefined && n.some((x) => x < spec.minimum!)) return `minimum is ${spec.minimum}`;
    if (spec.maximum !== undefined && n.some((x) => x > spec.maximum!)) return `maximum is ${spec.maximum}`;
    const flat = /-array$/.test(spec.type ?? "");
    const width = flat ? 1 : entryCells;
    if (!width) return null;
    const count = Math.ceil(n.length / width);
    if (spec.min_items != null && count < spec.min_items) return `at least ${items(spec.min_items)}`;
    if (spec.max_items != null && count > spec.max_items) return `at most ${items(spec.max_items)}`;
  } else if (value.type === "strings") {
    if (spec.min_items != null && value.value.length < spec.min_items) return `at least ${items(spec.min_items)}`;
    if (spec.max_items != null && value.value.length > spec.max_items) return `at most ${items(spec.max_items)}`;
    if (spec.enum?.length && spec.type === "string" && !spec.enum.includes(value.value[0])) return "not an allowed value";
  }
  return null;
}

/** The value a spec's default gives for its input, or null when it has none the input can hold. */
function defaultValue(spec: PropertySpec, kind: EditorKind): PropertyValue | null {
  // A property allowed one value has it as its default (`device_type = "memory"`).
  const d = spec.default ?? (spec.enum?.length === 1 ? spec.enum[0] : undefined);
  if (d === undefined || d === null) return null;
  const isCell = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;
  switch (kind) {
    case "flag":
      return d === true ? { type: "empty" } : null;
    case "enum":
    case "string":
      return typeof d === "string" ? { type: "strings", value: [d] } : isCell(d) && kind === "enum" ? { type: "cells", value: [d] } : null;
    case "strings":
      return typeof d === "string"
        ? { type: "strings", value: [d] }
        : Array.isArray(d) && d.every((x) => typeof x === "string")
          ? { type: "strings", value: d as string[] }
          : null;
    case "number":
      return isCell(d) ? { type: "cells", value: [d] } : null;
    case "numbers":
      return Array.isArray(d) && d.every(isCell) ? { type: "cells", value: d as number[] } : isCell(d) ? { type: "cells", value: [d] } : null;
  }
}

/** The value the binding gives a property by default, or null when it has none. */
export function specDefault(spec: PropertySpec): PropertyValue | null {
  const kind = editorKind(spec);
  return kind && defaultValue(spec, kind);
}

/** `#address-cells` + `#size-cells` of a bus node, which its children's
 * `reg` entries hold: 2 + 1 when it does not say, as dtc assumes. */
export function regEntryCells(properties: Property[] | undefined): number {
  const cell = (name: string, fallback: number) => {
    const p = properties?.find((q) => q.name === name);
    return p?.value.type === "cells" && p.value.value.length === 1 ? p.value.value[0] : fallback;
  };
  return cell("#address-cells", 2) + cell("#size-cells", 1);
}

/**
 * Properties a node dropped from the palette starts with (US-2.3): `status`
 * (not on a basic node),
 * a `reg` placeholder when the binding has one (`regCells` cells per
 * entry, from the parent), and required properties that
 * have a default. `todo` names the placeholders the user still has to fill in;
 * required properties without a default are left out and show as missing.
 */
export function initialProperties(binding: Binding, regCells = 3): { properties: Property[]; todo: string[] } {
  const specs = binding.properties ?? [];
  // The basic nodes (US-18.3) are not devices that can be disabled.
  const properties: Property[] = binding.node_name ? [] : [{ name: "status", value: { type: "strings", value: ["okay"] } }];
  const todo: string[] = [];
  const reg = specs.find((s) => s.name === "reg");
  if (reg) {
    // The binding counts entries; each is the parent's address and size cells.
    const len = Math.max(reg.min_items ?? 1, 1) * Math.max(regCells, 1);
    properties.push({ name: "reg", value: { type: "cells", value: Array(len).fill(0) } });
    todo.push("reg");
  }
  for (const spec of specs) {
    if (!spec.required || properties.some((p) => p.name === spec.name) || spec.name === "compatible") continue;
    const value = specDefault(spec);
    if (value) properties.push({ name: spec.name, value });
  }
  return { properties, todo };
}

/** Drops the to-do mark of every property whose value differs from before. */
export function clearEditedTodo(todo: string[] | undefined, before: Property[], after: Property[]): string[] | undefined {
  if (!todo?.length) return todo;
  const key = (props: Property[], name: string) => JSON.stringify(props.find((p) => p.name === name)?.value);
  const left = todo.filter((name) => key(before, name) === key(after, name));
  return left.length ? left : undefined;
}
