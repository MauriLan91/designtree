// The problem list of a large design (US-5.3): problems from the structure
// check, the binding schemas and dtc, filtered, grouped by rule, node or
// property, with the undocumented vendor properties set apart.
import type { Problem } from "./model";

export type ProblemSource = "structure" | "schema" | "dtc";
export const SOURCES: ProblemSource[] = ["structure", "schema", "dtc"];
export type GroupBy = "none" | "rule" | "node" | "property";

export interface Tagged {
  problem: Problem;
  source: ProblemSource;
}

export interface ProblemFilter {
  severity: "all" | "error" | "warning";
  sources: ReadonlySet<ProblemSource>;
  text: string;
}

export interface ProblemGroup {
  key: string;
  title: string;
  problems: Tagged[];
  /** The class of undocumented vendor properties, closed by default. */
  undocumented?: boolean;
}

/**
 * Whether the problem is a property no binding documents. dt-schema's core
 * schema checks every property against the types a known one may have, and
 * a vendor property no binding names fails that one check: on a vendor
 * tree, thousands of them.
 */
export function isUndocumented(p: Problem): boolean {
  return p.rule === "dt-core.yaml" && /is not of types "null", "boolean", "integer", "array", "object"/.test(p.message);
}

/**
 * The message with byte values that read as text shown as text:
 * `"[6f 6b 00]"` becomes `"ok"`, as long as every byte is printable but
 * the closing NUL.
 */
export function readable(message: string): string {
  return message.replace(/\[((?:[0-9a-f]{2} )*[0-9a-f]{2})\]/g, (whole, hex: string) => {
    const bytes = hex.split(" ").map((h) => parseInt(h, 16));
    const body = bytes.at(-1) === 0 ? bytes.slice(0, -1) : null;
    if (!body?.length || !body.every((b) => b >= 0x20 && b < 0x7f)) return whole;
    return String.fromCharCode(...body);
  });
}

/** The message with what varies (quoted values, numbers, lists) left out,
 * so problems of one kind share it. */
export function ruleOf(p: Problem): string {
  return p.message
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\[[^\]]*\]/g, "[…]")
    .replace(/\b(?:0x[0-9a-f]+|\d+)\b/gi, "N")
    .replace(/(?:'…', )+'…'/g, "'…'");
}

/** The problems the filter keeps. `pathOf` names a node by its path. */
export function filterProblems(list: Tagged[], filter: ProblemFilter, pathOf: (id: string) => string | undefined): Tagged[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(({ problem: p, source }) => {
    if (filter.severity !== "all" && p.severity !== filter.severity) return false;
    if (!filter.sources.has(source)) return false;
    if (!words.length) return true;
    const text = [readable(p.message), p.property, p.rule, p.node && pathOf(p.node)].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * The problems in groups, largest first, with the undocumented vendor
 * properties in a class of their own at the end. With no grouping there is
 * one group of the rest. Errors come before warnings, in each group and
 * among groups (US-5.6): they are what to fix first.
 */
export function groupProblems(list: Tagged[], by: GroupBy, pathOf: (id: string) => string | undefined): ProblemGroup[] {
  const groups = new Map<string, ProblemGroup>();
  const undocumented: Tagged[] = [];
  for (const t of list) {
    if (isUndocumented(t.problem)) {
      undocumented.push(t);
      continue;
    }
    const p = t.problem;
    const [key, title] =
      by === "rule"
        ? [ruleOf(p), ruleOf(p)]
        : by === "node"
          ? [p.node ?? "", (p.node && pathOf(p.node)) || "(no node)"]
          : by === "property"
            ? [p.property ?? "", p.property ?? "(the node itself)"]
            : ["", "All"];
    const group = groups.get(key) ?? { key, title, problems: [] };
    group.problems.push(t);
    groups.set(key, group);
  }
  const errorsFirst = (list: Tagged[]) => {
    const errors = list.filter((t) => t.problem.severity === "error");
    return errors.length === list.length ? list : [...errors, ...list.filter((t) => t.problem.severity !== "error")];
  };
  const hasErrors = (g: ProblemGroup) => (g.problems[0]?.problem.severity === "error" ? 1 : 0);
  const sorted = [...groups.values()]
    .map((g) => ({ ...g, problems: errorsFirst(g.problems) }))
    .sort((a, b) => hasErrors(b) - hasErrors(a) || b.problems.length - a.problems.length);
  if (undocumented.length) {
    sorted.push({ key: "\0undocumented", title: "Undocumented vendor properties", problems: errorsFirst(undocumented), undocumented: true });
  }
  return sorted;
}
