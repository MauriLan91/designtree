import { describe, expect, it } from "vitest";
import type { Binding } from "./model";
import { initialProperties, specDefault } from "./schemaProps";

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
