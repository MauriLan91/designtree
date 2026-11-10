import { describe, expect, it } from "vitest";
import { formatCompatible, parseCompatible } from "./compatible";

describe("parseCompatible", () => {
  it("keeps the vendor comma inside a compatible", () => {
    expect(parseCompatible("acme,first-board")).toEqual(["acme,first-board"]);
  });

  it("splits at whitespace, after a comma or not", () => {
    expect(parseCompatible("ti,am335x-bone-black, ti,am33xx")).toEqual(["ti,am335x-bone-black", "ti,am33xx"]);
    expect(parseCompatible(" ns16550a  snps,dw-apb-uart ")).toEqual(["ns16550a", "snps,dw-apb-uart"]);
  });

  it("reads the strings as DTS writes them", () => {
    expect(parseCompatible('"acme,board", "acme,soc"')).toEqual(["acme,board", "acme,soc"]);
  });

  it("reads back what the field shows", () => {
    const list = ["acme,board", "acme,soc"];
    expect(parseCompatible(formatCompatible(list))).toEqual(list);
    expect(parseCompatible("")).toEqual([]);
  });
});
