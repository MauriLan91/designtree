import type { Problem } from "../model";

interface Props {
  problems: Problem[];
  /** Display name of a node id. */
  nodeName: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
}

/** Problems with the node they are about; clicking one shows the node. */
export function ProblemList({ problems, nodeName, onFocusNode }: Props) {
  return (
    <ul className="problems">
      {problems.map((p, i) => {
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
  );
}
