// The navigator (US-16.4): the whole devicetree as a tree in the side bar,
// like Qt Design Studio's Navigator. Clicking a node selects it, on the
// canvas (in its scope) and in the text; double-click or Enter opens it.
// The filter (US-16.6) keeps the matching rows with their ancestors.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { KINDS, kindOf } from "../categories";
import { isDtNode, type FlowNode } from "../model";
import type { TreeRow } from "../scopes";
import { SearchField } from "./Palette";

interface Props {
  rows: TreeRow[];
  nodes: Map<string, FlowNode>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  filter: string;
  onFilter: (text: string) => void;
  /** With a filter: the rows that match it, not only lead to one, best first. */
  matched?: ReadonlySet<string>;
}

export function Navigator({ rows, nodes, selected, onToggle, onSelect, onOpen, filter, onFilter, matched }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const current = rows.findIndex((r) => selected.has(r.id));

  // Keep the selection in view when it changes elsewhere (canvas, text).
  useEffect(() => {
    if (current >= 0) list.current?.querySelector(`[data-row="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onKeyDown = (e: KeyboardEvent) => {
    const row = rows[current];
    const move = (i: number) => rows[i] && onSelect(rows[i].id);
    if (e.key === "ArrowDown") move(Math.min(current + 1, rows.length - 1));
    else if (e.key === "ArrowUp") move(Math.max(current - 1, 0));
    else if (e.key === "ArrowRight" && row?.branch && !row.expanded) onToggle(row.id);
    else if (e.key === "ArrowLeft" && row?.expanded) onToggle(row.id);
    else if (e.key === "Enter" && row) onOpen(row.id);
    else return;
    e.preventDefault();
  };

  // Enter in the filter shows the best match; Down goes on to the tree.
  const firstMatch = () => {
    const best = matched?.values().next().value;
    return best !== undefined ? rows.find((r) => r.id === best) : rows[0];
  };
  const onFilterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const first = firstMatch();
    if (e.key === "Enter" && first) onSelect(first.id);
    else if (e.key === "ArrowDown" && rows.length) {
      if (current < 0 && first) onSelect(first.id);
      list.current?.focus();
    } else return;
    e.preventDefault();
  };

  return (
    <section className="navigator">
      <h2>Outline</h2>
      <SearchField
        value={filter}
        onChange={onFilter}
        label="Filter the outline"
        placeholder="Name, label, compatible, path, phandle"
        onKeyDown={onFilterKey}
      />
      <ul ref={list} role="tree" aria-label="Devicetree" tabIndex={0} onKeyDown={onKeyDown}>
        {rows.map((r, i) => {
          const n = nodes.get(r.id);
          if (!n || !isDtNode(n)) return null;
          const name = n.data.unitAddress ? `${n.data.name}@${n.data.unitAddress}` : n.data.name;
          const kind = kindOf(n.data.binding?.category, n.data.name);
          const { Icon } = KINDS[kind];
          return (
            <li
              key={r.id}
              data-row={i}
              role="treeitem"
              aria-level={r.depth + 1}
              aria-expanded={r.branch ? r.expanded : undefined}
              aria-selected={selected.has(r.id)}
              className={[selected.has(r.id) && "selected", matched && !matched.has(r.id) && "ancestor"].filter(Boolean).join(" ") || undefined}
              style={{ paddingLeft: 4 + r.depth * 14 }}
              onClick={() => onSelect(r.id)}
              onDoubleClick={() => onOpen(r.id)}
            >
              <button
                className="twisty"
                tabIndex={-1}
                aria-label={r.expanded ? "Collapse" : "Expand"}
                style={{ visibility: r.branch ? "visible" : "hidden" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(r.id);
                }}
              >
                {r.expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              </button>
              <span className={`kind-chip kind-${kind}`} aria-hidden>
                <Icon size={11} strokeWidth={2} />
              </span>
              <span className="nav-name">
                {n.data.label && <span className="dt-node-label">{n.data.label}:</span>}
                {name}
              </span>
            </li>
          );
        })}
        {filter && rows.length === 0 && <li className="hint">No node matches</li>}
      </ul>
    </section>
  );
}
