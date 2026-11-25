import { createContext } from "react";
import type { Severity } from "./model";

export interface NodeProblem {
  severity: Severity;
  text: string;
}

/** The problems of each node, by node id, for its badge. */
export const NodeProblems = createContext<ReadonlyMap<string, NodeProblem[]>>(new Map());

/** The worse of two severities; undefined when neither is given. */
export function worse(a: Severity | undefined, b: Severity | undefined): Severity | undefined {
  return a === "error" || b === "error" ? "error" : (a ?? b);
}

/**
 * What the Outline marks on each node (US-5.6): the worst severity of its
 * own problems, and of those below it for a collapsed branch.
 */
export interface ProblemMark {
  own?: Severity;
  below?: Severity;
}

/** The marks of every node with problems on it or below it. */
export function problemMarks(problems: ReadonlyMap<string, NodeProblem[]>, parents: ReadonlyMap<string, string>): Map<string, ProblemMark> {
  const marks = new Map<string, ProblemMark>();
  for (const [id, list] of problems) {
    const severity = list.reduce<Severity | undefined>((s, p) => worse(s, p.severity), undefined);
    if (!severity) continue;
    marks.set(id, { ...marks.get(id), own: worse(marks.get(id)?.own, severity) });
    const seen = new Set([id]);
    for (let up = parents.get(id); up && !seen.has(up); up = parents.get(up)) {
      seen.add(up);
      const mark = marks.get(up) ?? {};
      if (mark.below === "error" || mark.below === severity) break;
      marks.set(up, { ...mark, below: worse(mark.below, severity) });
    }
  }
  return marks;
}
