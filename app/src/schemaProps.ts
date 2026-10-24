// Typed editing of the properties a binding describes (US-2.2). Each editable
// spec maps to one kind of input; anything the typed inputs cannot represent
// stays in the raw text area so no value is ever lost or hidden.
import { parseCell, type Binding, type Property, type PropertySpec, type PropertyValue } from "./model";

export type EditorKind = "flag" | "enum" | "string" | "strings" | "number" | "numbers";

const SCALAR_CELLS = new Set(["uint32"]);
const CELL_LISTS = new Set(["uint32-array", "uint32-matrix"]);

/** The input used for a spec, or null when only the raw text area can edit it. */
export function editorKind(spec: PropertySpec): EditorKind | null {
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

/** Whether the property's current value fits the spec's input. */
function fits(kind: EditorKind, value: PropertyValue): boolean {
  switch (kind) {
    case "flag":
      return value.type === "empty";
    case "enum":
    case "string":
      return value.type === "strings" && value.value.length === 1;
    case "strings":
      return value.type === "strings";
    case "number":
      return value.type === "cells" && value.value.length === 1;
    case "numbers":
      return value.type === "cells";
  }
}

/** Specs the typed inputs edit for these properties, in binding order. */
export function typedSpecs(specs: PropertySpec[], props: Property[]): PropertySpec[] {
  const byName = new Map(props.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const out = specs.filter((s) => {
    const kind = editorKind(s);
    if (!kind || seen.has(s.name)) return false;
    const current = byName.get(s.name);
    if (current && !fits(kind, current.value)) return false;
    seen.add(s.name);
    return true;
  });
  return [...out.filter((s) => s.required), ...out.filter((s) => !s.required)];
}

export function parseNumbers(text: string): number[] {
  return text.split(/[\s,]+/).filter(Boolean).map(parseCell);
}

export function formatNumber(n: number): string {
  return n < 10 ? String(n) : `0x${n.toString(16)}`;
}

/** The text a typed input shows for the current property (empty when unset). */
export function toInputText(kind: EditorKind, prop: Property | undefined): string {
  const v = prop?.value;
  if (!v) return "";
  switch (kind) {
    case "enum":
    case "string":
      return v.type === "strings" ? (v.value[0] ?? "") : "";
    case "strings":
      return v.type === "strings" ? v.value.join(", ") : "";
    case "number":
    case "numbers":
      return v.type === "cells" ? v.value.map(formatNumber).join(" ") : "";
    case "flag":
      return "";
  }
}

/**
 * Value for the text typed into an input; null removes the property. Throws
 * when the text is not valid for the kind (e.g. a non-number).
 */
export function fromInputText(kind: EditorKind, text: string): PropertyValue | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  switch (kind) {
    case "enum":
    case "string":
      return { type: "strings", value: [trimmed] };
    case "strings":
      return { type: "strings", value: trimmed.split(",").map((s) => s.trim()).filter(Boolean) };
    case "number":
    case "numbers": {
      const cells = parseNumbers(trimmed);
      if (kind === "number" && cells.length !== 1) throw new Error("expected one number");
      return { type: "cells", value: cells };
    }
    case "flag":
      return { type: "empty" };
  }
}

/** Returns the properties with `name` set to `value` (or removed when null), keeping order. */
export function setProperty(props: Property[], name: string, value: PropertyValue | null): Property[] {
  const i = props.findIndex((p) => p.name === name);
  if (value === null) return i < 0 ? props : props.filter((_, j) => j !== i);
  if (i < 0) return [...props, { name, value }];
  return props.map((p, j) => (j === i ? { name, value } : p));
}

/** Problems with a value against the spec's limits, for inline warnings. */
export function checkValue(spec: PropertySpec, value: PropertyValue | undefined): string | null {
  if (!value) return null;
  if (value.type === "cells") {
    const n = value.value;
    if (spec.minimum !== undefined && n.some((x) => x < spec.minimum!)) return `minimum is ${spec.minimum}`;
    if (spec.maximum !== undefined && n.some((x) => x > spec.maximum!)) return `maximum is ${spec.maximum}`;
    if (spec.min_items !== undefined && n.length < spec.min_items) return `at least ${spec.min_items} items`;
    if (spec.max_items !== undefined && n.length > spec.max_items) return `at most ${spec.max_items} items`;
  } else if (value.type === "strings") {
    if (spec.min_items !== undefined && value.value.length < spec.min_items) return `at least ${spec.min_items} items`;
    if (spec.max_items !== undefined && value.value.length > spec.max_items) return `at most ${spec.max_items} items`;
    if (spec.enum?.length && spec.type === "string" && !spec.enum.includes(value.value[0])) return "not an allowed value";
  }
  return null;
}

/** The value a spec's default gives for its input, or null when it has none the input can hold. */
function defaultValue(spec: PropertySpec, kind: EditorKind): PropertyValue | null {
  const d = spec.default;
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

/**
 * Properties a node dropped from the palette starts with (US-2.3): `status`,
 * a `reg` placeholder when the binding has one, and required properties that
 * have a default. `todo` names the placeholders the user still has to fill in;
 * required properties without a default are left out and show as missing.
 */
export function initialProperties(binding: Binding): { properties: Property[]; todo: string[] } {
  const specs = binding.properties ?? [];
  const properties: Property[] = [{ name: "status", value: { type: "strings", value: ["okay"] } }];
  const todo: string[] = [];
  const reg = specs.find((s) => s.name === "reg");
  if (reg) {
    const len = Math.max(reg.min_items ?? 2, 1);
    properties.push({ name: "reg", value: { type: "cells", value: Array(len).fill(0) } });
    todo.push("reg");
  }
  for (const spec of specs) {
    if (!spec.required || properties.some((p) => p.name === spec.name) || spec.name === "compatible") continue;
    const kind = editorKind(spec);
    const value = kind && defaultValue(spec, kind);
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
