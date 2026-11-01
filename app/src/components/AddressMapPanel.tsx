import type { AddressMap, Region } from "../model";

interface Props {
  map: AddressMap;
  /** Display name of a node id. */
  nodeName: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
}

/** Each bus with its regions in address order; overlapping and unreachable ones highlighted. */
export function AddressMapPanel({ map, nodeName, onFocusNode }: Props) {
  const name = (id: string) => nodeName(id) ?? id;
  const link = (id: string) => (
    <button className="link" onClick={() => onFocusNode(id)} title="Show the node on the canvas">
      {name(id)}
    </button>
  );
  const status = (r: Region) => {
    if (r.out_of_range) return { className: "out-of-range", title: "Outside the ranges of its bus: the CPU cannot reach it" };
    if (r.overlaps?.length) return { className: "overlap", title: `Overlaps ${r.overlaps.map(name).join(", ")}` };
    return { className: undefined, title: undefined };
  };

  return (
    <section className="address-map">
      <h2>Address map</h2>
      {map.buses.length === 0 && <p className="hint">No node has children with reg.</p>}
      {map.problems.length > 0 && (
        <ul className="problems">
          {map.problems.map((p, i) => (
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
      {map.buses.map((bus) => (
        <details key={bus.node} open={bus.regions.some((r) => r.out_of_range || (r.overlaps?.length ?? 0) > 0)}>
          <summary>
            {link(bus.node)}
            <span className="hint">
              {" "}
              {bus.regions.length} region{bus.regions.length === 1 ? "" : "s"}
              {!bus.memory_mapped && " · local addresses"}
            </span>
          </summary>
          <table>
            <thead>
              <tr>
                <th>{bus.memory_mapped ? "CPU address" : "Address"}</th>
                <th>Size</th>
                <th>Node</th>
              </tr>
            </thead>
            <tbody>
              {bus.regions.map((r) => {
                const { className, title } = status(r);
                return (
                  <tr key={`${r.node}#${r.index}`} className={className} title={title}>
                    <td title={r.cpu_end ? `${r.cpu_start}–${r.cpu_end} (bus address ${r.address})` : undefined}>
                      <code>{r.cpu_start ?? r.address}</code>
                      {bus.memory_mapped && !r.cpu_start && <span className="hint"> (bus)</span>}
                    </td>
                    <td>
                      <code>{bus.size_cells > 0 ? r.size : ""}</code>
                    </td>
                    <td>
                      {link(r.node)}
                      {r.index > 0 && <span className="hint"> [{r.index}]</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ))}
    </section>
  );
}
