import type { Problem } from "../model";

export interface BuildState {
  running: boolean;
  /** The .dtb, when the build succeeded. */
  output?: string;
  /** Failure that is not about a node (dtc missing, invalid design), or dtc's raw output. */
  message?: string;
  problems: Problem[];
}

interface Props {
  build: BuildState;
  /** Display name of a node id. */
  nodeName: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
}

export function BuildPanel({ build, nodeName, onFocusNode }: Props) {
  const errors = build.problems.filter((p) => p.severity === "error").length;
  const warnings = build.problems.length - errors;
  const failed = !build.running && !build.output;
  return (
    <section className={`build${failed ? " failed" : ""}`}>
      <h2>Build</h2>
      {build.running && <p className="hint">Building…</p>}
      {build.output && <p className="hint">Built {build.output}</p>}
      {failed && build.problems.length === 0 && build.message && <pre>{build.message}</pre>}
      {build.problems.length > 0 && (
        <>
          <p className="hint">
            {errors} error{errors === 1 ? "" : "s"}, {warnings} warning{warnings === 1 ? "" : "s"}
          </p>
          <ul className="problems">
            {build.problems.map((p, i) => {
              const name = p.node ? nodeName(p.node) : undefined;
              return (
                <li key={i} className={p.severity}>
                  <button
                    disabled={!p.node}
                    onClick={() => p.node && onFocusNode(p.node)}
                    title={p.node ? "Show the node on the canvas" : p.line ? `Line ${p.line} of the generated source` : undefined}
                  >
                    <b>{p.severity}</b>
                    {name && <code>{name}</code>}
                    <span>{p.message}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
