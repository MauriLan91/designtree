import { describe, expect, it } from "vitest";
import type { PropertyValue } from "./model";
import {
  blank,
  convert,
  entriesOf,
  withEntry,
  withoutEntry,
  itemsOf,
  itemRows,
  kindOf,
  parseCellText,
  parseChunkText,
  parseSummary,
  referenceOf,
  referenceTo,
  summaryOf,
  withItem,
  withoutItem,
} from "./propertyTable";

// One value of every kind the model has, including the mixed chunks an
// imported .dts brings: macros, references, paths, /bits/.
const values: Record<string, PropertyValue> = {
  flag: { type: "empty" },
  string: { type: "strings", value: ["okay"] },
  strings: { type: "strings", value: ["dat", "dirout"] },
  cells: { type: "cells", value: [0x1c28000, 0x400] },
  bytes: { type: "bytes", value: [0x01, 0xab] },
  macroCells: { type: "mixed", value: [{ type: "cells", bits: 32, cells: ["GIC_SPI", 37, "IRQ_TYPE_LEVEL_HIGH"] }] },
  refCells: { type: "mixed", value: [{ type: "cells", bits: 32, cells: [{ phandle: "gpio" }, 0, 1] }] },
  mixed: {
    type: "mixed",
    value: [
      { type: "string", value: "a" },
      { type: "cells", bits: 16, cells: [1, 2] },
      { type: "bytes", value: [0xff] },
      { type: "path", target: "/soc/uart@0" },
    ],
  },
};

describe("round trip", () => {
  for (const [name, value] of Object.entries(values)) {
    it(`keeps ${name} through its row text`, () => {
      // Typing the row's own text back gives the same value…
      expect(parseSummary(kindOf(value), summaryOf(value))).toEqual(value);
      // …and so does setting every item to its own text.
      const items = itemsOf(value) ?? [];
      expect(items.reduce((v, text, i) => withItem(v, i, text), value)).toEqual(value);
    });
  }
});

describe("items", () => {
  it("edits, appends and removes cells, turning macros into a mixed value", () => {
    const cells: PropertyValue = { type: "cells", value: [1, 2] };
    expect(withItem(cells, 2, "0x10")).toEqual({ type: "cells", value: [1, 2, 16] });
    expect(withItem(cells, 0, "GPIO_ACTIVE_LOW")).toEqual({
      type: "mixed",
      value: [{ type: "cells", bits: 32, cells: ["GPIO_ACTIVE_LOW", 2] }],
    });
    expect(withoutItem(values.macroCells, 0)).toEqual({
      type: "mixed",
      value: [{ type: "cells", bits: 32, cells: [37, "IRQ_TYPE_LEVEL_HIGH"] }],
    });
    expect(withoutItem(withoutItem(values.macroCells, 0), 1)).toEqual({ type: "cells", value: [37] });
  });

  it("keeps a single macro or reference a cell, not a path", () => {
    const key: PropertyValue = { type: "mixed", value: [{ type: "cells", bits: 32, cells: ["KEY_POWER"] }] };
    expect(parseSummary("mixed", "KEY_VOLUMEUP", key)).toEqual({ type: "mixed", value: [{ type: "cells", bits: 32, cells: ["KEY_VOLUMEUP"] }] });
    const phy: PropertyValue = { type: "mixed", value: [{ type: "cells", bits: 32, cells: [{ phandle: "phy0" }] }] };
    expect(parseSummary("mixed", "&phy1", phy)).toEqual({ type: "mixed", value: [{ type: "cells", bits: 32, cells: [{ phandle: "phy1" }] }] });
  });

  it("keeps the width of /bits/ cells across edits", () => {
    const opp: PropertyValue = { type: "mixed", value: [{ type: "cells", bits: 64, cells: [0x4786, 0x8c00] }] };
    const wide = (cells: number[]) => ({ type: "mixed", value: [{ type: "cells", bits: 64, cells }] });
    expect(withItem(opp, 0, "0")).toEqual(wide([0, 0x8c00]));
    expect(withoutItem(opp, 0)).toEqual(wide([0x8c00]));
    expect(parseSummary("mixed", "5", opp)).toEqual(wide([5]));
  });

  it("shows a one-string list as a list when asked", () => {
    const one: PropertyValue = { type: "strings", value: ["apb"] };
    expect(kindOf(one)).toBe("string");
    expect(kindOf(one, true)).toBe("strings");
    expect(itemsOf(one, "strings")).toEqual(["apb"]);
    expect(summaryOf(one, "strings")).toBe('"apb"');
    expect(withItem(one, 1, "ahb")).toEqual({ type: "strings", value: ["apb", "ahb"] });
  });

  it("reads a leading 0 as octal, as dtc does", () => {
    expect(parseCellText("010")).toBe(8);
    expect(parseCellText("0")).toBe(0);
    expect(parseCellText("10")).toBe(10);
    expect(() => parseCellText("08")).toThrow();
  });

  it("refuses text that is not a cell, byte or chunk", () => {
    expect(() => parseCellText("1e3")).toThrow();
    expect(() => parseCellText("0b11")).toThrow();
    expect(() => withItem(values.cells, 0, "twelve")).toThrow();
    expect(() => withItem(values.bytes, 0, "100")).toThrow();
    expect(() => parseChunkText("oops")).toThrow();
    expect(parseCellText("&{/soc/gic}")).toEqual({ phandle: "/soc/gic" });
  });
});

describe("convert", () => {
  it("keeps what it can across types", () => {
    expect(convert(values.cells, "strings")).toEqual({ type: "strings", value: ["0x1c28000 0x400"] });
    expect(convert({ type: "strings", value: ["1 2"] }, "cells")).toEqual({ type: "cells", value: [1, 2] });
    expect(convert({ type: "cells", value: [1, 255] }, "bytes")).toEqual({ type: "bytes", value: [1, 255] });
    expect(convert(values.strings, "mixed")).toEqual({
      type: "mixed",
      value: [
        { type: "string", value: "dat" },
        { type: "string", value: "dirout" },
      ],
    });
  });

  it("starts empty instead of failing", () => {
    expect(convert({ type: "strings", value: ["hello"] }, "cells")).toEqual({ type: "cells", value: [] });
    expect(convert(values.cells, "flag")).toEqual({ type: "empty" });
  });
});

describe("reference values (US-17.5)", () => {
  it("reads one path chunk as a reference to a node", () => {
    const alias = referenceTo("uart0");
    expect(kindOf(alias)).toBe("reference");
    expect(referenceOf(alias)).toBe("uart0");
    expect(itemsOf(alias)).toBeNull();
    expect(summaryOf(alias)).toBe("&uart0");
    expect(kindOf({ type: "mixed", value: [{ type: "path", target: "a" }, { type: "string", value: "b" }] })).toBe("mixed");
  });

  it("parses &label and &{/path}, and turns a path string into a reference", () => {
    expect(parseSummary("reference", "&uart_a")).toEqual(referenceTo("uart_a"));
    expect(parseSummary("reference", "uart_a")).toEqual(referenceTo("uart_a"));
    expect(parseSummary("reference", "&{/soc/serial@0}")).toEqual(referenceTo("/soc/serial@0"));
    expect(() => parseSummary("reference", "12")).toThrow();
    expect(convert({ type: "strings", value: ["/soc/serial@0"] }, "reference")).toEqual(referenceTo("/soc/serial@0"));
    expect(blank("reference")).toEqual(referenceTo(""));
  });
});

describe("cell entries (US-17.4)", () => {
  const reg: PropertyValue = { type: "cells", value: [0x1c81000, 0x1000, 0x1c82000, 0x2000] };

  it("reads a cell list as groups of its entry width", () => {
    expect(summaryOf(reg, "cells", "hex", 2)).toBe("<0x1c81000 0x1000>, <0x1c82000 0x2000>");
    expect(summaryOf(reg, "cells", "hex")).toBe("0x1c81000 0x1000 0x1c82000 0x2000");
    expect(entriesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("parses typed groups back into the same cells", () => {
    expect(parseSummary("cells", "<0x1c81000 0x1000>, <0x1c82000 0x2000>")).toEqual(reg);
    // A one-chunk mixed value (macros) takes groups too, kept as one list.
    const irq = { type: "mixed", value: [{ type: "cells", bits: 32, cells: ["GIC_SPI", 37, 4] }] } as PropertyValue;
    expect(parseSummary("mixed", "<GIC_SPI 37 4>, <GIC_SPI 38 4>", irq)).toEqual({
      type: "mixed",
      value: [{ type: "cells", bits: 32, cells: ["GIC_SPI", 37, 4, "GIC_SPI", 38, 4] }],
    });
    // Groups with references stay apart: each starts a phandle entry.
    expect(parseSummary("mixed", "<&a 1>, <&b 2>").type === "mixed" && (parseSummary("mixed", "<&a 1>, <&b 2>") as { value: unknown[] }).value).toHaveLength(2);
  });

  it("adds and removes whole entries", () => {
    expect(withEntry(reg, 2)).toEqual({ type: "cells", value: [...reg.value as number[], 0, 0] });
    // A short last entry is filled before the new one.
    expect(withEntry({ type: "cells", value: [1, 2, 3] }, 2)).toEqual({ type: "cells", value: [1, 2, 3, 0, 0, 0] });
    expect(withoutEntry(reg, 0, 2)).toEqual({ type: "cells", value: [0x1c82000, 0x2000] });
  });
});

describe("itemRows", () => {
  const one: PropertyValue = { type: "cells", value: [1] };
  it("gives one number no item rows, with or without a schema type (#186)", () => {
    expect(itemRows(one, "cells", "hex")).toBeNull();
    expect(itemRows(one, "cells", "hex", "uint32")).toBeNull();
    expect(itemRows({ type: "mixed", value: [{ type: "cells", bits: 32, cells: ["GIC_SPI"] }] }, "mixed", "hex")).toEqual(["GIC_SPI"]);
  });
  it("keeps the row of a single item where the schema declares a list", () => {
    expect(itemRows(one, "cells", "hex", "uint32-array")).toEqual(["1"]);
    expect(itemRows(one, "cells", "dec", "uint32-matrix")).toEqual(["1"]);
  });
  it("lists two numbers or more", () => {
    expect(itemRows({ type: "cells", value: [1, 2] }, "cells", "dec", "uint32")).toEqual(["1", "2"]);
  });
});
