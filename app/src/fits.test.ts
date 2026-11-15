import { describe, expect, it } from "vitest";
import { busClass, fitting, placementProblem, scopeClass } from "./fits";
import type { Binding, DtFlowNode, LibraryEntry } from "./model";

const node = (id: string, name: string, compatible: string[] = [], binding?: Partial<Binding>): DtFlowNode =>
  ({
    id,
    type: "dt",
    position: { x: 0, y: 0 },
    data: {
      name,
      compatible,
      properties: [],
      binding: binding ? ({ path: "x.yaml", category: "misc", ...binding } as Binding) : undefined,
    },
  }) as DtFlowNode;

describe("bus classes", () => {
  it("match the bindings crate", () => {
    expect(busClass("i2c@1c2ac00")).toBe("i2c");
    expect(busClass("i2c0")).toBe("i2c");
    expect(busClass("spi_1")).toBe("spi");
    expect(busClass("/")).toBe("mmio");
    expect(busClass("soc@0")).toBe("mmio");
    expect(busClass("pcie@0")).toBe("pci");
  });

  it("read a scope from its controller or its name", () => {
    expect(scopeClass(node("a", "i2c", [], { category: "i2c" }))).toBe("i2c");
    expect(scopeClass(node("b", "bus", ["simple-bus"]))).toBe("mmio");
    expect(scopeClass(node("c", "cpus"))).toBe("cpus");
  });
});

describe("Fits here", () => {
  it("keeps the entries whose examples sit under the class", () => {
    const entries: LibraryEntry[] = [
      { path: "a.yaml", category: "iio", compatible: "ti,tmp102", buses: ["i2c"] },
      { path: "b.yaml", category: "serial", compatible: "ns16550a", buses: ["mmio"] },
      { path: "c.yaml", category: "misc" },
    ];
    expect(fitting(entries, "i2c").map((e) => e.compatible)).toEqual(["ti,tmp102"]);
  });
});

describe("placement", () => {
  const name = (id: string) => id;

  it("warns, naming the parent and the reason", () => {
    const sensor = node("sensor@48", "sensor", ["ti,tmp102"], { path: "iio/tmp102.yaml", buses: ["i2c"] });
    const p = placementProblem(sensor, sensor.data.binding, node("spi@0", "spi", [], { category: "spi" }), name);
    expect(p?.severity).toBe("warning");
    expect(p?.node).toBe("sensor@48");
    expect(p?.message).toBe("Under spi@0, an SPI bus, but its binding (iio/tmp102.yaml) places it under an I²C bus");
  });

  it("stays quiet when it fits or nothing is known", () => {
    const sensor = node("s", "sensor", [], { buses: ["i2c"] });
    expect(placementProblem(sensor, sensor.data.binding, node("i", "i2c", [], { category: "i2c" }), name)).toBeNull();
    // A parent of a kind the check does not know.
    expect(placementProblem(sensor, sensor.data.binding, node("m", "mux"), name)).toBeNull();
    // A binding whose examples say nothing.
    expect(placementProblem(node("t", "thing", [], {}), undefined, node("p", "spi", [], { category: "spi" }), name)).toBeNull();
  });
});
