import { describe, expect, it } from "vitest";
import type { Problem } from "./model";
import { filterProblems, groupProblems, isUndocumented, readable, ruleOf, SOURCES, type Tagged } from "./problemView";

const p = (message: string, extra: Partial<Problem> = {}): Problem => ({ severity: "error", message, ...extra });
const vendor = p('"[00 00 00 11]" is not of types "null", "boolean", "integer", "array", "object"', {
  node: "a",
  property: "qcom,x",
  rule: "dt-core.yaml",
});
const list: Tagged[] = [
  { problem: p('"ranges" is a required property', { node: "a", rule: "simple-bus.yaml" }), source: "schema" },
  { problem: p('"reg" is a required property', { node: "b", rule: "simple-bus.yaml" }), source: "schema" },
  { problem: vendor, source: "schema" },
  { problem: p("node has a unit name, but no reg", { node: "b", severity: "warning", rule: "unit_address_vs_reg" }), source: "dtc" },
  { problem: p("Missing parent", { node: "c" }), source: "structure" },
];
const paths: Record<string, string> = { a: "/soc", b: "/soc/uart@1000", c: "/x" };
const pathOf = (id: string) => paths[id];
const all = { severity: "all" as const, sources: new Set(SOURCES), text: "" };

describe("the problem list", () => {
  it("shows bytes that read as text as text", () => {
    expect(readable('"[6f 6b 00]" is wrong')).toBe('"ok" is wrong');
    expect(readable('"[00 00 00 11]" is wrong')).toBe('"[00 00 00 11]" is wrong');
    expect(readable("[6f 6b]")).toBe("[6f 6b]");
  });

  it("groups by rule, leaving out what varies", () => {
    expect(ruleOf(list[0].problem)).toBe(ruleOf(list[1].problem));
    const groups = groupProblems(list, "rule", pathOf);
    expect(groups[0].problems).toHaveLength(2);
    expect(groups.at(-1)).toMatchObject({ undocumented: true, problems: [{ problem: vendor }] });
    expect(isUndocumented(list[0].problem)).toBe(false);
  });

  it("groups by node path and by property", () => {
    expect(groupProblems(list, "node", pathOf).map((g) => [g.title, g.problems.length])).toEqual([
      ["/soc/uart@1000", 2],
      ["/soc", 1],
      ["/x", 1],
      ["Undocumented vendor properties", 1],
    ]);
    expect(groupProblems(list, "property", pathOf)[0].title).toBe("(the node itself)");
  });

  it("filters by severity, source and text, the path included", () => {
    expect(filterProblems(list, { ...all, severity: "warning" }, pathOf)).toHaveLength(1);
    expect(filterProblems(list, { ...all, sources: new Set(["dtc", "structure"] as const) }, pathOf)).toHaveLength(2);
    expect(filterProblems(list, { ...all, text: "uart required" }, pathOf).map((t) => t.problem.node)).toEqual(["b"]);
    expect(filterProblems(list, { ...all, text: "qcom,x" }, pathOf)).toEqual([list[2]]);
  });
});
