// What dtc's lexer accepts as a name, as `NameKind::accepts` in
// designtree-core checks it before export: the inspector says it while the
// user types, instead of a bare "syntax error" at build.

export type NameKind = "node" | "unit" | "label";

const PATTERNS: Record<NameKind, RegExp> = {
  node: /^[A-Za-z0-9,._+-]+$/,
  unit: /^[A-Za-z0-9,._+-]+$/,
  label: /^[A-Za-z_][A-Za-z0-9_]*$/,
};

const HINTS: Record<NameKind, string> = {
  node: "letters, digits and , . _ + - only; the unit address has its own field",
  unit: "letters, digits and , . _ + - only",
  label: "a letter or _, then letters, digits and _ only",
};

/** Why `text` is not a valid name of its kind, or null. An empty field is
 * no label and no unit address. */
export function nameProblem(kind: NameKind, text: string): string | null {
  if (!text && kind !== "node") return null;
  return PATTERNS[kind].test(text) ? null : `Not a valid ${kind === "unit" ? "unit address" : kind === "node" ? "node name" : "label"}: ${HINTS[kind]}`;
}
