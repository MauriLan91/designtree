import { describe, expect, it } from "vitest";
import { baseOf, formatCell, formatProperties, type PropertyValue } from "./model";
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
