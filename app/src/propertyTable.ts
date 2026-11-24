// The property table (US-17.1): every property as a row with a key, a type
// and a value, the way an Apple plist editor shows them. A value that holds
// several things (strings, cells, bytes, the chunks of a mixed value) expands
// into one child row per item, each edited the same way. This module is the
// table's model: what a value looks like as rows and how an edit of one row
// changes the value. The component only draws it.
import { baseAt, formatCell, withCellOffsets, type Bases, type Cell, type NumberBase, type PropertyValue, type ValueChunk } from "./model";

/** The types the table offers for a property. */
export type ValueKind = "flag" | "string" | "strings" | "cells" | "bytes" | "reference" | "mixed";

export const KIND_TITLES: Record<ValueKind, string> = {
  flag: "Boolean",
  string: "String",
  strings: "String list",
  cells: "Cells",
  bytes: "Bytes",
  reference: "Reference",
  mixed: "Mixed",
};

/**
 * The table type of a value. A one-string list is a plain string unless
 * `list` says it is a list (the binding, or the type the user picked), since
 * the two are the same bytes.
 */
export function kindOf(value: PropertyValue, list = false): ValueKind {
  switch (value.type) {
    case "empty":
      return "flag";
    case "strings":
      return value.value.length === 1 && !list ? "string" : "strings";
    case "cells":
      return "cells";
    case "bytes":
      return "bytes";
    case "mixed":
      return referenceOf(value) !== null ? "reference" : "mixed";
  }
}

/**
 * The node a reference value names (US-17.5): one `&label` or `&{/path}`
 * outside cells, which the DTS expands to the node's path (`aliases`,
 * `stdout-path`). "" for a reference not picked yet; null for any other
 * value.
 */
export function referenceOf(value: PropertyValue): string | null {
  return value.type === "mixed" && value.value.length === 1 && value.value[0].type === "path" ? value.value[0].target : null;
}

export const referenceTo = (target: string): PropertyValue => ({ type: "mixed", value: [{ type: "path", target }] });

// ---------------------------------------------------------------------------
// Text of single items

export const formatNumber = formatCell;
const formatByte = (b: number) => b.toString(16).padStart(2, "0");
const formatRef = (target: string) => (target.startsWith("/") ? `&{${target}}` : `&${target}`);

export function cellText(c: Cell, base: NumberBase = "hex"): string {
  return typeof c === "number" ? formatNumber(c, base) : typeof c === "string" ? c : formatRef(c.phandle);
}

/**
 * A cell from its text: a number (decimal, 0x hex or 0 octal), a `dt-bindings` macro name
 * (`GIC_SPI`), or a reference (`&gic`, `&{/soc/gic}`). Throws otherwise.
 */
export function parseCellText(text: string): Cell {
  const t = text.trim();
  const ref = /^&\{(\/[^}]*)\}$/.exec(t) ?? /^&([A-Za-z_][\w-]*)$/.exec(t);
  if (ref) return { phandle: ref[1] };
  if (/^[A-Z_][A-Z0-9_]*$/.test(t)) return t;
  const n = parseNumber(t);
  if (n <= 0xffffffff) return n;
  throw new Error(`"${t}" is not a number, macro or &reference`);
}

/** A number as dtc reads it: decimal, `0x` hex, or octal after a leading 0
 * (`010` is 8); NaN otherwise. */
function parseNumber(t: string): number {
  if (/^0x[0-9a-f]+$/i.test(t)) return Number(t);
  if (/^0[0-7]+$/.test(t)) return parseInt(t, 8);
  return /^(0|[1-9]\d*)$/.test(t) ? Number(t) : NaN;
}

function parseByte(text: string): number {
  const t = text.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{1,2}$/i.test(t)) throw new Error(`"${text}" is not a byte`);
  return parseInt(t, 16);
}

/** Cells as one list, or the mixed value they need when one is not a
 * number or they are not 32 bits wide. */
function cellsValue(cells: Cell[], bits = 32): PropertyValue {
  return bits === 32 && cells.every((c): c is number => typeof c === "number")
    ? { type: "cells", value: cells }
    : { type: "mixed", value: [{ type: "cells", bits, cells }] };
}

/** The one chunk of a mixed value that is a single cell list, shown and
 * edited as its cells. */
function cellChunk(value: PropertyValue): (ValueChunk & { type: "cells" }) | null {
  return value.type === "mixed" && value.value.length === 1 && value.value[0].type === "cells" ? value.value[0] : null;
}

function chunkText(chunk: ValueChunk, base: Bases, first = 0): string {
  switch (chunk.type) {
    case "cells":
      return `${chunk.bits === 32 ? "" : `/bits/ ${chunk.bits} `}<${chunk.cells.map((c, i) => cellText(c, baseAt(base, first + i))).join(" ")}>`;
    case "string":
      return JSON.stringify(chunk.value);
    case "bytes":
      return `[${chunk.value.map(formatByte).join(" ")}]`;
    case "path":
      return formatRef(chunk.target);
  }
}

const mixedTexts = (chunks: ValueChunk[], base: Bases) => withCellOffsets(chunks).map(([c, first]) => chunkText(c, base, first));

/** A chunk of a mixed value from its DTS text: `<…>`, `"…"`, `[…]` or `&ref`. */
export function parseChunkText(text: string): ValueChunk {
  const t = text.trim();
  const bits = /^\/bits\/\s*(8|16|32|64)\s+(<.*>)$/.exec(t);
  const cells = /^<(.*)>$/.exec(bits ? bits[2] : t);
  if (cells) {
    const list = cells[1].trim() ? cells[1].trim().split(/\s+/).map(parseCellText) : [];
    return { type: "cells", bits: bits ? Number(bits[1]) : 32, cells: list };
  }
  if (/^".*"$/.test(t)) return { type: "string", value: JSON.parse(t) as string };
  const bytes = /^\[(.*)\]$/.exec(t);
  if (bytes) return { type: "bytes", value: bytes[1].trim() ? bytes[1].trim().split(/\s+/).map(parseByte) : [] };
  const ref = parseCellText(t);
  if (typeof ref === "object") return { type: "path", target: ref.phandle };
  throw new Error(`"${t}" is not <cells>, "string", [bytes] or &reference`);
}

// ---------------------------------------------------------------------------
// Rows

/**
 * The item rows a property expands into, or null for none. One number is
 * one field with no item rows (`#address-cells = <1>`), whatever the
 * schema says and when there is none, unless the schema's `type` declares a
 * list; typing a second number makes it a list.
 */
export function itemRows(value: PropertyValue, kind: ValueKind, base: Bases, type?: string | null): string[] | null {
  const items = itemsOf(value, kind, base);
  if (kind === "cells" && (items?.length ?? 0) <= 1 && !/array|matrix/.test(type ?? "")) return null;
  return items;
}

/** The child rows of a value, as the text each one edits; null when the
 * value has no parts (a flag, or a plain string). */
export function itemsOf(value: PropertyValue, kind = kindOf(value), base: Bases = "hex"): string[] | null {
  switch (value.type) {
    case "empty":
      return null;
    case "strings":
      return kind === "string" ? null : value.value;
    case "cells":
      return value.value.map((c, i) => formatNumber(c, baseAt(base, i)));
    case "bytes":
      return value.value.map(formatByte);
    case "mixed":
      if (referenceOf(value) !== null) return null;
      // One chunk of cells is shown as its cells, like a plain cell list.
      return cellChunk(value)?.cells.map((c, i) => cellText(c, baseAt(base, i))) ?? mixedTexts(value.value, base);
  }
}

/** The value with item `index` set from `text` (appended when `index` is
 * the length). Throws when the text is not valid for the item. */
export function withItem(value: PropertyValue, index: number, text: string): PropertyValue {
  const put = <T>(list: T[], item: T) => {
    const next = [...list];
    next[index] = item;
    return next;
  };
  switch (value.type) {
    case "empty":
      return value;
    case "strings":
      return { type: "strings", value: put(value.value, text) };
    case "cells":
      return cellsValue(put<Cell>(value.value, parseCellText(text)));
    case "bytes":
      return { type: "bytes", value: put(value.value, parseByte(text)) };
    case "mixed": {
      const chunk = cellChunk(value);
      if (chunk) return cellsValue(put(chunk.cells, parseCellText(text)), chunk.bits);
      return { type: "mixed", value: put(value.value, parseChunkText(text)) };
    }
  }
}

/** The value without item `index`. */
export function withoutItem(value: PropertyValue, index: number): PropertyValue {
  const drop = <T>(list: T[]) => list.filter((_, i) => i !== index);
  switch (value.type) {
    case "empty":
      return value;
    case "strings":
      return { type: "strings", value: drop(value.value) };
    case "cells":
      return { type: "cells", value: drop(value.value) };
    case "bytes":
      return { type: "bytes", value: drop(value.value) };
    case "mixed": {
      const chunk = cellChunk(value);
      return chunk ? cellsValue(drop(chunk.cells), chunk.bits) : { type: "mixed", value: drop(value.value) };
    }
  }
}

/** What a new item of the value starts as. */
export function blankItem(value: PropertyValue): string {
  switch (value.type) {
    case "strings":
      return "";
    case "bytes":
      return "00";
    case "mixed":
      return cellChunk(value) ? "0" : "<0>";
    default:
      return "0";
  }
}

/** The one-line text of a value, as the row shows and edits it. A cell
 * list `width` cells per entry reads as its groups, `<a b>, <c d>`. */
export function summaryOf(value: PropertyValue, kind = kindOf(value), base: Bases = "hex", width?: number): string {
  const cells = cellsOf(value);
  if (cells && width && width > 1 && cells.length > width) {
    return entriesOf(cells.map((c, i) => cellText(c, baseAt(base, i))), width)
      .map((e) => `<${e.join(" ")}>`)
      .join(", ");
  }
  switch (value.type) {
    case "empty":
      return "";
    case "strings":
      return kind === "string" ? value.value[0] : value.value.map((s) => JSON.stringify(s)).join(", ");
    case "cells":
      return value.value.map((c, i) => formatNumber(c, baseAt(base, i))).join(" ");
    case "bytes":
      return value.value.map(formatByte).join(" ");
    case "mixed":
      return cellChunk(value)?.cells.map((c, i) => cellText(c, baseAt(base, i))).join(" ") ?? mixedTexts(value.value, base).join(", ");
  }
}

/** The value of a row typed in one go: space-separated cells or bytes, a
 * string as is, comma-separated chunks for a mixed value. `current` is the
 * value the text replaces, which tells how a mixed row reads it. */
export function parseSummary(kind: ValueKind, text: string, current?: PropertyValue): PropertyValue {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  switch (kind) {
    case "flag":
      return { type: "empty" };
    case "string":
      return { type: "strings", value: [text] };
    case "strings":
      return { type: "strings", value: splitList(text).map((s) => (/^".*"$/.test(s) ? (JSON.parse(s) as string) : s)) };
    case "cells":
      // Entries may be typed as groups, `<a b>, <c d>`: the same cells.
      return cellsValue(cellWords(text).map(parseCellText));
    case "bytes":
      return { type: "bytes", value: words.map(parseByte) };
    case "reference": {
      const ref = parseCellText(text.trim().startsWith("&") ? text : `&${text.trim()}`);
      if (typeof ref !== "object") throw new Error(`"${text}" is not a &label or &{/path}`);
      return referenceTo(ref.phandle);
    }
    case "mixed": {
      // A bare list of cells (`GIC_SPI 37 IRQ_TYPE_LEVEL_HIGH`) is how a
      // one-chunk cell value reads in the row; anything else is chunks.
      const parts = splitList(text);
      const chunk = current && cellChunk(current);
      if (parts.length === 1 && !/^[<"[]|^\/bits\//.test(parts[0]) && (chunk || /\s/.test(parts[0].trim()))) {
        return cellsValue(words.map(parseCellText), chunk?.bits);
      }
      const chunks = parts.map(parseChunkText);
      // Groups of plain cells are one list, as the import reads them; the
      // grouping into entries is only how it is written.
      // References keep their groups: each starts a phandle entry.
      const plain = (c: ValueChunk) => c.type === "cells" && c.bits === 32 && c.cells.every((x) => typeof x !== "object");
      if (chunks.length > 1 && chunks.every(plain)) {
        return cellsValue(chunks.flatMap((c) => (c.type === "cells" ? c.cells : [])));
      }
      return { type: "mixed", value: chunks };
    }
  }
}

export const cellWords = (text: string) => text.replace(/[<>,]/g, " ").trim().split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------
// Entries (US-17.4): a cell list read as groups of `width` cells, such as
// `reg` (#address-cells + #size-cells per entry) or `interrupts`.

/** The cells of a plain cell list, or of a value that is one chunk of cells. */
export function cellsOf(value: PropertyValue): Cell[] | null {
  if (value.type === "cells") return value.value;
  return cellChunk(value)?.cells ?? null;
}

/** Items in groups of `width`; the last is short when they do not divide. */
export function entriesOf<T>(items: T[], width: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += width) out.push(items.slice(i, i + width));
  return out;
}

/** The value without entry `index`. */
export function withoutEntry(value: PropertyValue, index: number, width: number): PropertyValue {
  const cells = cellsOf(value);
  if (!cells) return value;
  const rest = [...cells.slice(0, index * width), ...cells.slice((index + 1) * width)];
  return cellsValue(rest, cellChunk(value)?.bits);
}

/** The value with an entry of zeros appended, after filling a short last one. */
export function withEntry(value: PropertyValue, width: number): PropertyValue {
  const cells = cellsOf(value) ?? [];
  const full = Math.ceil(cells.length / width) * width;
  return cellsValue([...cells, ...Array<Cell>(full - cells.length + width).fill(0)], cellChunk(value)?.bits);
}

/** Splits at commas outside quotes and brackets. */
function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== "\\") quoted = !quoted;
    else if (!quoted && (c === "<" || c === "[")) depth++;
    else if (!quoted && (c === ">" || c === "]")) depth--;
    else if (!quoted && depth === 0 && c === ",") {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last || out.length) out.push(last);
  return out;
}

/**
 * The value turned into another type, keeping what can be kept: cells and
 * bytes convert into each other, strings and numbers through their text, and
 * anything becomes one chunk of a mixed value. What cannot be kept starts
 * empty, so a type change never fails.
 */
export function convert(value: PropertyValue, to: ValueKind): PropertyValue {
  if (kindOf(value) === to) return value;
  const text = summaryOf(value);
  try {
    switch (to) {
      case "flag":
        return { type: "empty" };
      case "string":
        return { type: "strings", value: [value.type === "strings" ? value.value.join(", ") : text] };
      case "strings":
        return value.type === "strings" ? { type: "strings", value: value.value } : { type: "strings", value: text ? [text] : [] };
      case "cells":
        if (value.type === "bytes") return { type: "cells", value: value.value };
        return parseSummary("cells", value.type === "strings" ? value.value.join(" ") : text);
      case "bytes":
        if (value.type === "cells" && value.value.every((n) => n <= 0xff)) return { type: "bytes", value: value.value };
        return parseSummary("bytes", text);
      case "reference":
        // A path written as a string (`"/soc/serial@0"`) names the same node.
        if (value.type === "strings" && value.value.length === 1 && value.value[0].startsWith("/")) return referenceTo(value.value[0]);
        return blank("reference");
      case "mixed":
        if (value.type === "empty") return { type: "mixed", value: [] };
        if (value.type === "cells") return { type: "mixed", value: [{ type: "cells", bits: 32, cells: value.value }] };
        if (value.type === "bytes") return { type: "mixed", value: [{ type: "bytes", value: value.value }] };
        if (value.type === "strings") return { type: "mixed", value: value.value.map((s) => ({ type: "string", value: s })) };
        return value;
    }
  } catch {
    return blank(to);
  }
}

/** An empty value of a type, for a new property. */
export function blank(kind: ValueKind): PropertyValue {
  switch (kind) {
    case "flag":
      return { type: "empty" };
    case "string":
      return { type: "strings", value: [""] };
    case "strings":
      return { type: "strings", value: [] };
    case "cells":
      return { type: "cells", value: [] };
    case "bytes":
      return { type: "bytes", value: [] };
    case "reference":
      return referenceTo("");
    case "mixed":
      return { type: "mixed", value: [] };
  }
}

/** The size of a value in the blob, in bytes (US-17.8): a reference or a
 * constant in a cell list takes its cell. */
export function sizeOf(value: PropertyValue): number {
  switch (value.type) {
    case "empty":
      return 0;
    case "strings":
      return value.value.reduce((n, s) => n + new TextEncoder().encode(s).length + 1, 0);
    case "cells":
      return value.value.length * 4;
    case "bytes":
      return value.value.length;
    case "mixed":
      return value.value.reduce((n, c) => {
        if (c.type === "cells") return n + c.cells.length * (c.bits / 8);
        if (c.type === "bytes") return n + c.value.length;
        // A string, or a path written outside `<>`, ends in its NUL.
        return n + new TextEncoder().encode(c.type === "string" ? c.value : c.target).length + 1;
      }, 0);
  }
}

/** A size as a row shows it. */
export function sizeText(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Bytes per line of the hex grid. */
export const HEX_LINE = 16;

/** The lines of a byte array as a hex dump: offset, bytes, printable text. */
export function hexLines(bytes: number[]): { offset: string; hex: string; ascii: string }[] {
  const lines = [];
  for (let at = 0; at < bytes.length; at += HEX_LINE) {
    const line = bytes.slice(at, at + HEX_LINE);
    lines.push({
      offset: at.toString(16).padStart(4, "0"),
      hex: line.map(formatByte).join(" "),
      ascii: line.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join(""),
    });
  }
  return lines;
}

/** The bytes with line `line` of the grid replaced by `text`: bytes as hex
 * pairs, spaced or not. A line may grow or shrink, or be emptied to remove
 * it. Throws on anything that is not hex. */
export function withHexLine(bytes: number[], line: number, text: string): number[] {
  const digits = text.replace(/\s+/g, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(digits)) throw new Error("Bytes are pairs of hex digits, such as 0a 1f");
  const parsed = digits.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
  const at = line * HEX_LINE;
  return [...bytes.slice(0, at), ...parsed, ...bytes.slice(at + HEX_LINE)];
}

/** Items per page of a long list (US-17.8). */
export const PAGE = 64;

// ---------------------------------------------------------------------------
// Compact rows (US-17.7)

/** `text` cut to `max` characters by taking out its middle, so the start
 * (`qcom,`) and the end (`-supply`) that tell keys apart both stay. */
export function elideMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max < 3) return text.slice(0, Math.max(0, max));
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** The short name of a table type, for the type chip. */
export const KIND_CHIPS: Record<ValueKind, string> = {
  flag: "bool",
  string: "str",
  strings: "str[]",
  cells: "cells",
  bytes: "bytes",
  reference: "ref",
  mixed: "mixed",
};

/** The short name of a schema type (`uint32-array` → `u32[]`). */
export function typeChip(type: string): string {
  const t = type.replace(/^non-unique-/, "");
  const int = /^(u?)int(8|16|32|64)(-array|-matrix)?$/.exec(t);
  if (int) return `${int[1] ? "u" : "i"}${int[2]}${int[3] === "-array" ? "[]" : int[3] ? "[][]" : ""}`;
  const known: Record<string, string> = { flag: "bool", string: "str", "string-array": "str[]", "phandle-array": "phandle[]", address: "addr" };
  return known[t] ?? t;
}
