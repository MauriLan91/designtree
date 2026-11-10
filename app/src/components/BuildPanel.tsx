import type { Problem } from "../model";
import { ProblemList } from "./ProblemList";

export interface BuildState {
  running: boolean;
  /** The .dtb, when the build succeeded. */
  output?: string;
  /** Failure that is not about a node (dtc missing, invalid design), or dtc's raw output. */
  message?: string;
  problems: Problem[];
  /** The devicetree it was built from (`treeOf(...).key`). */
  key?: string;
}

interface Props {
  build: BuildState;
  /** The design changed since: the result may no longer hold. */
  stale: boolean;
  /** Display name of a node id. */
  nodeName: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
}

export function BuildPanel({ build, stale, nodeName, onFocusNode }: Props) {
  const errors = build.problems.filter((p) => p.severity === "error").length;
  const warnings = build.problems.length - errors;
  const failed = !build.running && !build.output;
  return (
    <section className={`build${failed ? " failed" : ""}${stale && !build.running ? " stale" : ""}`}>
      <h2>Build</h2>
      {stale && !build.running && <p className="hint stale-note">Built before the last change: build again (Ctrl+B) to check it.</p>}
      {build.running && <p className="hint">Building…</p>}
      {build.output && <p className="hint">Built {build.output}</p>}
      {failed && build.problems.length === 0 && build.message && <pre>{build.message}</pre>}
      {build.problems.length > 0 && (
        <>
          <p className="hint">
            {errors} error{errors === 1 ? "" : "s"}, {warnings} warning{warnings === 1 ? "" : "s"}
          </p>
          <ProblemList problems={build.problems} nodeName={nodeName} onFocusNode={onFocusNode} />
        </>
      )}
    </section>
  );
}
