import { describe, expect, it } from "vitest";
import { entryKey, entryOfKey, highlight, withCompatible } from "./library";
import type { Binding } from "./model";

const cpus: Binding = {
  path: "arm/cpus.yaml",
  category: "arm",
  title: "ARM CPUs",
  compatibles: ["apm,potenza", "arm,cortex-a7", "arm,cortex-a710"],
};

describe("library entries", () => {
  it("remember the schema and the compatible", () => {
    const entry = { path: cpus.path, category: "arm", title: "ARM CPUs", compatible: "arm,cortex-a7" };
    expect(entryKey(entry)).toBe("arm/cpus.yaml#arm,cortex-a7");
    expect(entryOfKey("arm/cpus.yaml#arm,cortex-a7", [cpus])).toEqual(entry);
    // A key saved before one entry per compatible names the first one.
    expect(entryOfKey("arm/cpus.yaml", [cpus])?.compatible).toBe("apm,potenza");
    expect(entryOfKey("arm/cpus.yaml#arm,gone", [cpus])).toBeNull();
    expect(entryOfKey("gone.yaml", [cpus])).toBeNull();
  });

  it("add the entry's compatible", () => {
    expect(withCompatible(cpus, "arm,cortex-a7").compatibles).toEqual(["arm,cortex-a7", "apm,potenza", "arm,cortex-a710"]);
    expect(withCompatible(cpus, null)).toBe(cpus);
  });
});

describe("highlight", () => {
  it("marks every word of the query where it occurs", () => {
    expect(highlight("arm,cortex-a7", "cortex-a7")).toEqual([
      { text: "arm,", match: false },
      { text: "cortex-a7", match: true },
    ]);
    expect(highlight("ST,STM32-uart", "stm32 uart")).toEqual([
      { text: "ST,", match: false },
      { text: "STM32", match: true },
      { text: "-", match: false },
      { text: "uart", match: true },
    ]);
    expect(highlight("fsl,imx6q-fec", "imx6fec")).toEqual([{ text: "fsl,imx6q-fec", match: false }]);
  });
});
