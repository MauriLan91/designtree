import type { Problem } from "../model";
import { ProblemList } from "./ProblemList";

export interface SchemaState {
  /** A check is running; the problems are from the previous one. */
  checking: boolean;
  /** Null when the design cannot be compiled, so it was not checked. */
  problems: Problem[] | null;
}

interface Props {
  schema: SchemaState;
  nodeName: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
}

/** Problems the binding schemas find in the design, kept up to date while editing. */
export function SchemaPanel({ schema, nodeName, onFocusNode }: Props) {
  const problems = schema.problems ?? [];
  const count = problems.length;
  return (
    <section className="build schema">
      <h2>Schema check</h2>
      <p className="hint">
        {schema.problems === null
          ? "Not checked: the design has structural errors (see the DTS preview)"
          : count === 0
            ? "No problems found"
            : `${count} problem${count === 1 ? "" : "s"}`}
        {schema.checking && " · checking…"}
      </p>
      {count > 0 && <ProblemList problems={problems} nodeName={nodeName} onFocusNode={onFocusNode} />}
    </section>
  );
}
