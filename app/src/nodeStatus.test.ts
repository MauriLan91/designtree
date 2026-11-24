import { describe, expect, it } from "vitest";
import { isDisabled, statusOf } from "./nodeStatus";
import type { Property } from "./model.gen";

const status = (s: string): Property[] => [{ name: "status", value: { type: "strings", value: [s] } }];

describe("isDisabled", () => {
  it("treats a node without status as enabled", () => {
    expect(isDisabled([])).toBe(false);
  });
  it("accepts okay and ok", () => {
    expect(isDisabled(status("okay"))).toBe(false);
    expect(isDisabled(status("ok"))).toBe(false);
  });
  it("flags every other status", () => {
    for (const s of ["disabled", "reserved", "fail", "fail-sss"]) expect(isDisabled(status(s))).toBe(true);
  });
  it("reads a string out of a mixed value", () => {
    const props: Property[] = [{ name: "status", value: { type: "mixed", value: [{ type: "string", value: "disabled" }] } }];
    expect(statusOf(props)).toBe("disabled");
    expect(isDisabled(props)).toBe(true);
  });
});
