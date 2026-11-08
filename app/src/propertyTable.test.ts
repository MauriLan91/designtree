import { describe, expect, it } from "vitest";
import type { PropertyValue } from "./model";
import {
  convert,
  itemsOf,
  kindOf,
  parseCellText,
  parseChunkText,
  parseSummary,
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

  it("refuses text that is not a cell, byte or chunk", () => {
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
