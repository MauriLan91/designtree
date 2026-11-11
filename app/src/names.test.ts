import { describe, expect, it } from "vitest";
import { nameProblem } from "./names";

describe("nameProblem", () => {
  it("accepts what dtc reads as one name", () => {
    expect(nameProblem("label", "uart_a")).toBeNull();
    expect(nameProblem("label", "")).toBeNull();
    expect(nameProblem("node", "cpu-map")).toBeNull();
    expect(nameProblem("unit", "1c28000")).toBeNull();
  });

  it("refuses what dtc would not parse", () => {
    expect(nameProblem("label", "led-0")).toMatch(/label/);
    expect(nameProblem("label", "osc 24")).toMatch(/label/);
    expect(nameProblem("node", "my leds}")).toMatch(/node name/);
    expect(nameProblem("node", "serial@0")).toMatch(/unit address/);
    expect(nameProblem("node", "")).toMatch(/node name/);
  });
});
