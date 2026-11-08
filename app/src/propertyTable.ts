// The property table (US-17.1): every property as a row with a key, a type
// and a value, the way an Apple plist editor shows them. A value that holds
// several things (strings, cells, bytes, the chunks of a mixed value) expands
// into one child row per item, each edited the same way. This module is the
// table's model: what a value looks like as rows and how an edit of one row
// changes the value. The component only draws it.
import { formatCell, type Cell, type PropertyValue, type ValueChunk } from "./model";

/** The types the table offers for a property. */
export type ValueKind = "flag" | "string" | "strings" | "cells" | "bytes" | "mixed";

export const KIND_TITLES: Record<ValueKind, string> = {
  flag: "Boolean",
  string: "String",
  strings: "String list",
  cells: "Cells",
  bytes: "Bytes",
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
      return "mixed";
  }
}

// ---------------------------------------------------------------------------
// Text of single items

export const formatNumber = formatCell;
const formatByte = (b: number) => b.toString(16).padStart(2, "0");
const formatRef = (target: string) => (target.startsWith("/") ? `&{${target}}` : `&${target}`);

export function cellText(c: Cell): string {
  return typeof c === "number" ? formatNumber(c) : typeof c === "string" ? c : formatRef(c.phandle);
}

/**
 * A cell from its text: a number (decimal or 0x), a `dt-bindings` macro name
 * (`GIC_SPI`), or a reference (`&gic`, `&{/soc/gic}`). Throws otherwise.
 */
export function parseCellText(text: string): Cell {
  const t = text.trim();
  const ref = /^&\{(\/[^}]*)\}$/.exec(t) ?? /^&([A-Za-z_][\w-]*)$/.exec(t);
  if (ref) return { phandle: ref[1] };
  if (/^[A-Z_][A-Z0-9_]*$/.test(t)) return t;
  const n = /^(0x[0-9a-f]+|\d+)$/i.test(t) ? Number(t) : NaN;
  if (n <= 0xffffffff) return n;
  throw new Error(`"${t}" is not a number, macro or &reference`);
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

function chunkText(chunk: ValueChunk): string {
  switch (chunk.type) {
    case "cells":
      return `${chunk.bits === 32 ? "" : `/bits/ ${chunk.bits} `}<${chunk.cells.map(cellText).join(" ")}>`;
    case "string":
      return JSON.stringify(chunk.value);
    case "bytes":
      return `[${chunk.value.map(formatByte).join(" ")}]`;
    case "path":
      return formatRef(chunk.target);
  }
}

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

/** The child rows of a value, as the text each one edits; null when the
 * value has no parts (a flag, or a plain string). */
export function itemsOf(value: PropertyValue, kind = kindOf(value)): string[] | null {
  switch (value.type) {
    case "empty":
      return null;
    case "strings":
      return kind === "string" ? null : value.value;
    case "cells":
      return value.value.map(formatNumber);
    case "bytes":
      return value.value.map(formatByte);
    case "mixed":
      // One chunk of cells is shown as its cells, like a plain cell list.
      return cellChunk(value)?.cells.map(cellText) ?? value.value.map(chunkText);
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

/** The one-line text of a value, as the row shows and edits it. */
export function summaryOf(value: PropertyValue, kind = kindOf(value)): string {
  switch (value.type) {
    case "empty":
      return "";
    case "strings":
      return kind === "string" ? value.value[0] : value.value.map((s) => JSON.stringify(s)).join(", ");
    case "cells":
      return value.value.map(formatNumber).join(" ");
    case "bytes":
      return value.value.map(formatByte).join(" ");
    case "mixed":
      return cellChunk(value)?.cells.map(cellText).join(" ") ?? value.value.map(chunkText).join(", ");
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
      return cellsValue(words.map(parseCellText));
    case "bytes":
      return { type: "bytes", value: words.map(parseByte) };
    case "mixed": {
      // A bare list of cells (`GIC_SPI 37 IRQ_TYPE_LEVEL_HIGH`) is how a
      // one-chunk cell value reads in the row; anything else is chunks.
      const parts = splitList(text);
      const chunk = current && cellChunk(current);
      if (parts.length === 1 && !/^[<"[]|^\/bits\//.test(parts[0]) && (chunk || /\s/.test(parts[0].trim()))) {
        return cellsValue(words.map(parseCellText), chunk?.bits);
      }
      return { type: "mixed", value: parts.map(parseChunkText) };
    }
  }
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
    case "mixed":
      return { type: "mixed", value: [] };
  }
}
