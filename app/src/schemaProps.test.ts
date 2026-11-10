import { describe, expect, it } from "vitest";
import type { Binding, PropertySpec } from "./model";
import { checkValue, initialProperties, regEntryCells, specDefault } from "./schemaProps";

const binding: Binding = {
  path: "serial/8250.yaml",
  category: "serial",
  properties: [
    { name: "reg", required: true, type: "uint32-matrix" },
    { name: "reg-shift", required: true, type: "uint32", enum: [0, 1, 2], default: 0 },
    { name: "clock-frequency", required: true, type: "uint32" },
    { name: "no-loopback-test", required: false, type: "flag", default: true },
  ],
};

describe("specDefault", () => {
  it("gives the binding's default in the value the table edits", () => {
    const [, regShift, clock, flag] = binding.properties!;
    expect(specDefault(regShift)).toEqual({ type: "cells", value: [0] });
    expect(specDefault(flag)).toEqual({ type: "empty" });
    expect(specDefault(clock)).toBeNull();
  });
});

describe("initialProperties", () => {
  it("presets required defaults and leaves the rest as to-do", () => {
    const { properties, todo } = initialProperties(binding);
    expect(properties.map((p) => p.name)).toEqual(["status", "reg", "reg-shift"]);
    expect(todo).toEqual(["reg"]);
  });
});

describe("basic nodes", () => {
  it("start with their one-choice properties and no status", () => {
    const memory: Binding = {
      path: "dtschema/memory.yaml",
      category: "basic",
      node_name: "memory@0",
      properties: [
        { name: "device_type", required: true, type: "string", enum: ["memory"] },
        { name: "reg", required: true, type: "address", min_items: 1 },
      ],
    };
    const { properties, todo } = initialProperties(memory, 2);
    expect(properties).toEqual([
      { name: "reg", value: { type: "cells", value: [0, 0] } },
      { name: "device_type", value: { type: "strings", value: ["memory"] } },
    ]);
    expect(todo).toEqual(["reg"]);
  });
});

describe("reg placeholders and counts (#136, #140)", () => {
  const cells = (value: number[]) => ({ type: "cells" as const, value });
  const parent = (a: number, s: number) => [
    { name: "#address-cells", value: cells([a]) },
    { name: "#size-cells", value: cells([s]) },
  ];

  it("gives reg the parent's address and size cells", () => {
    expect(regEntryCells(parent(1, 0))).toBe(1);
    expect(regEntryCells(parent(1, 1))).toBe(2);
    expect(regEntryCells([])).toBe(3);
    const reg = (n: number) => initialProperties(binding, n).properties.find((p) => p.name === "reg")?.value;
    expect(reg(1)).toEqual(cells([0]));
    expect(reg(2)).toEqual(cells([0, 0]));
  });

  it("counts matrix items as entries, and not at all without their width", () => {
    const reg = { name: "reg", required: true, type: "uint32-matrix", max_items: 1 } as PropertySpec;
    expect(checkValue(reg, cells([0x1c28000, 0x400]), 2)).toBeNull();
    expect(checkValue(reg, cells([0x1c28000, 0x400]))).toBeNull();
    expect(checkValue(reg, cells([1, 2, 3, 4]), 2)).toBe("at most 1 item");
    const interrupts = { name: "interrupts", required: true, type: "uint32-matrix", max_items: 1 } as PropertySpec;
    expect(checkValue(interrupts, cells([0, 0, 4]))).toBeNull();
    const list = { name: "x", required: false, type: "uint32-array", max_items: 2 } as PropertySpec;
    expect(checkValue(list, cells([1, 2, 3]))).toBe("at most 2 items");
  });
});
