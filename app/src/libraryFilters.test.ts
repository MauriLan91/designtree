import { describe, expect, it } from "vitest";
import { applyFilters, facet, parseFilters, NO_FILTERS } from "./libraryFilters";
import type { LibraryEntry } from "./model";

const e = (compatible: string, cls: string, buses: string[] = []): LibraryEntry => ({ path: `${cls}/x.yaml`, category: cls, class: cls, compatible, buses });
const all = [
  e("ti,tmp102", "sensor", ["i2c"]),
  e("adi,adxl345", "sensor", ["mmio", "i2c", "spi"]),
  e("bosch,bme280", "sensor", ["i2c", "spi"]),
  e("ns16550a", "serial", ["mmio"]),
];

describe("library filters (US-18.7)", () => {
  it("keeps everything without filters", () => {
    expect(applyFilters(all, NO_FILTERS)).toEqual(all);
  });

  it("combines class, vendor and bus", () => {
    const ids = (f: Parameters<typeof applyFilters>[1]) => applyFilters(all, f).map((x) => x.compatible);
    expect(ids({ fits: false, cls: "sensor", bus: "spi" })).toEqual(["adi,adxl345", "bosch,bme280"]);
    expect(ids({ fits: false, vendor: "" })).toEqual(["ns16550a"]);
    expect(ids({ fits: false, vendor: "ti" })).toEqual(["ti,tmp102"]);
  });

  it("ranks what fits the scope's bus, made-for-it first", () => {
    const fits = applyFilters(all, { fits: true }, "i2c").map((x) => x.compatible);
    expect(fits).toEqual(["ti,tmp102", "bosch,bme280", "adi,adxl345"]);
    // Without a scope bus the filter has nothing to say.
    expect(applyFilters(all, { fits: true }, null)).toHaveLength(4);
  });

  it("counts the values of a facet", () => {
    expect(facet(all, (x) => x.buses ?? [])).toEqual([
      ["i2c", 3],
      ["mmio", 2],
      ["spi", 2],
    ]);
  });

  it("reads stored filters defensively", () => {
    expect(parseFilters({ cls: "sensor", vendor: "", bus: 3, fits: "yes" })).toEqual({ cls: "sensor", vendor: "", bus: undefined, fits: false });
    expect(parseFilters(null)).toEqual({ cls: undefined, vendor: undefined, bus: undefined, fits: false });
  });
});
