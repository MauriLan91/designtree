import type { InterruptTree } from "../model";

interface Props {
  tree: InterruptTree;
  /** Display name of a node id. */
  nodeName: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
}

/** Controllers as a tree, each with the devices wired to it; problems below. */
export function InterruptPanel({ tree, nodeName, onFocusNode }: Props) {
  const name = (id: string) => nodeName(id) ?? id;
  const link = (id: string) => (
    <button className="link" onClick={() => onFocusNode(id)} title="Show the node on the canvas">
      {name(id)}
    </button>
  );
  const isController = (id: string) => tree.controllers.some((c) => c.node === id);

  const branch = (parent: string | undefined, depth = 0): React.ReactNode =>
    tree.controllers
      .filter((c) => c.parent === parent)
      .map((c) => (
        <li key={c.node}>
          <b>{link(c.node)}</b>
          <ul>
            {c.devices
              .filter((d) => !isController(d))
              .map((d) => (
                <li key={d}>{link(d)}</li>
              ))}
            {depth < 8 && branch(c.node, depth + 1)}
          </ul>
        </li>
      ));

  return (
    <section className="interrupts">
      <h2>Interrupts</h2>
      {tree.controllers.length === 0 && tree.problems.length === 0 && (
        <p className="hint">No interrupt controllers or devices with interrupts.</p>
      )}
      <ul className="irq-tree">{branch(undefined)}</ul>
      {tree.problems.length > 0 && (
        <ul className="problems">
          {tree.problems.map((p, i) => (
            <li key={i} className="warning">
              <button onClick={() => onFocusNode(p.node)} title="Show the node on the canvas">
                <b>problem</b>
                <code>{name(p.node)}</code>
                <span>{p.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
