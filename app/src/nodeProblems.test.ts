import { describe, expect, it } from "vitest";
import { problemMarks, type NodeProblem } from "./nodeProblems";

const warning: NodeProblem = { severity: "warning", text: "suspect" };
const error: NodeProblem = { severity: "error", text: "wrong" };
// root > soc > uart, root > soc > i2c
const parents = new Map([
  ["soc", "root"],
  ["uart", "soc"],
  ["i2c", "soc"],
]);

describe("the Outline marks", () => {
  it("give each node its worst problem and its ancestors the worst below", () => {
    const marks = problemMarks(
      new Map([
        ["uart", [warning, error]],
        ["i2c", [warning]],
        ["soc", [warning]],
      ]),
      parents,
    );
    expect(marks.get("uart")).toEqual({ own: "error" });
    expect(marks.get("i2c")).toEqual({ own: "warning" });
    expect(marks.get("soc")).toEqual({ own: "warning", below: "error" });
    expect(marks.get("root")).toEqual({ below: "error" });
  });

  it("raise a warning below to an error when one is found later", () => {
    const marks = problemMarks(
      new Map([
        ["i2c", [warning]],
        ["uart", [error]],
      ]),
      parents,
    );
    expect(marks.get("root")).toEqual({ below: "error" });
  });
});
