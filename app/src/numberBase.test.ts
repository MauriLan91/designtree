import { describe, expect, it } from "vitest";
import { baseOf, basesOf, formatCell, formatProperties, literalBase, nextBase, withCellBase, withoutCellBases, withTypedBases, type Property, type PropertyValue } from "./model";
import { summaryOf, parseSummary } from "./propertyTable";

describe("number base", () => {
  it("defaults addresses to hex and everything else to decimal", () => {
    expect(baseOf({ name: "reg" })).toBe("hex");
    expect(baseOf({ name: "ranges" })).toBe("hex");
    expect(baseOf({ name: "clock-frequency" })).toBe("dec");
    expect(baseOf({ name: "reg", base: "oct" })).toBe("oct");
  });

  it("formats in each base", () => {
    expect(formatCell(24000000, "dec")).toBe("24000000");
    expect(formatCell(0x1c28000, "hex")).toBe("0x1c28000");
    expect(formatCell(4, "hex")).toBe("4");
    expect(formatCell(0o644, "oct")).toBe("0644");
    expect(formatCell(0, "oct")).toBe("0");
  });

  it("writes the Text mode in the property's base", () => {
    const text = formatProperties([
      { name: "reg", value: { type: "cells", value: [0x1c28000, 0x400] } },
      { name: "clock-frequency", value: { type: "cells", value: [24000000] } },
      { name: "mode", value: { type: "cells", value: [0o644] }, base: "oct" },
    ]);
    expect(text).toBe("reg = <0x1c28000 0x400>\nclock-frequency = <24000000>\nmode = <0644>");
  });

  it("reads any base back to the same number", () => {
    const value: PropertyValue = { type: "cells", value: [420] };
    for (const base of ["dec", "hex", "oct"] as const) {
      expect(parseSummary("cells", summaryOf(value, "cells", base))).toEqual(value);
    }
  });
});

describe("base per cell (US-17.6)", () => {
  const rates: Property = { name: "rates", value: { type: "cells", value: [16, 24000000, 32, 48000000] } };

  it("cycles decimal, hex, octal", () => {
    expect(["dec", "hex", "oct"].map((b) => nextBase(b as "dec"))).toEqual(["hex", "oct", "dec"]);
  });

  it("keeps a base for one cell and writes it", () => {
    const p = withCellBase(withCellBase(rates, "hex", 0), "hex", 2);
    expect(p.bases).toEqual(["hex", null, "hex"]);
    expect(formatProperties([p])).toBe("rates = <0x10 24000000 0x20 48000000>");
    expect(summaryOf(p.value, "cells", basesOf(p))).toBe("0x10 24000000 0x20 48000000");
  });

  it("stores nothing per cell when a cell goes back to the property's base", () => {
    const p = withCellBase(withCellBase(rates, "hex", 1), "dec", 1);
    expect(p.bases).toBeUndefined();
  });

  it("sets every cell from the whole field", () => {
    const p = withCellBase(withCellBase(rates, "hex", 1), "oct");
    expect(p).toEqual({ ...rates, base: "oct" });
  });

  it("moves the bases of later cells down when one goes", () => {
    const p = withCellBase(rates, "hex", 2);
    expect(withoutCellBases(p, 0).bases).toEqual([null, "hex"]);
    expect(withoutCellBases(p, 2).bases).toBeUndefined();
  });

  it("takes the bases a value was typed in", () => {
    expect(literalBase("0x10")).toBe("hex");
    expect(literalBase("010")).toBe("oct");
    expect(literalBase("24")).toBe("dec");
    expect(literalBase("4")).toBeNull();
    const p = withTypedBases(rates, ["0x10", "24000000", "0x20", "48000000", "1"]);
    expect(p.base).toBe("hex");
    expect(p.bases).toEqual([null, "dec", null, "dec"]);
  });

  it("opens a design that kept one base per property", () => {
    const p: Property = { name: "mode", value: { type: "cells", value: [0o644, 0o755] }, base: "oct" };
    expect(baseOf(p)).toBe("oct");
    expect(formatProperties([p])).toBe("mode = <0644 0755>");
  });

  it("counts cells across the groups of a mixed value", () => {
    const p: Property = {
      name: "m",
      value: { type: "mixed", value: [{ type: "cells", bits: 32, cells: [16] }, { type: "string", value: "x" }, { type: "cells", bits: 32, cells: [16] }] },
      bases: [null, "hex"],
    };
    expect(formatProperties([p])).toBe('m = <16>, "x", <0x10>');
  });
});
