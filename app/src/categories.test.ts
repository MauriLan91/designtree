import { describe, expect, it } from "vitest";
import { kindOf } from "./categories";

describe("kindOf", () => {
  it("takes the binding category first", () => {
    expect(kindOf("interrupt-controller", "gic")).toBe("irq");
    expect(kindOf("serial", "uart")).toBe("bus");
    expect(kindOf("leds", "anything")).toBe("gpio");
  });

  it("falls back to the generic node name", () => {
    expect(kindOf(undefined, "cpu")).toBe("cpu");
    expect(kindOf("sound", "memory")).toBe("mem");
    expect(kindOf(undefined, "oscillator")).toBe("clock");
    expect(kindOf(undefined, "/")).toBe("other");
  });
});
