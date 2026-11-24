// The Problems tab (US-5.3): every problem of the design, from the structure
// check, the binding schemas and the last build, grouped and filtered so a
// vendor tree's thousands stay workable.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { SOURCES, filterProblems, groupProblems, readable, type GroupBy, type ProblemFilter, type ProblemGroup, type ProblemSource, type Tagged } from "../problemView";
import { useVisibleRows } from "../visibleRows";
import { SearchField } from "./Palette";

interface Props {
  problems: Tagged[];
  /** A node's path, for the rows and the text filter. */
  pathOf: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
  /** Notes on what was not checked, above the list. */
  notes?: ReactNode;
}

/** Height of a row, in pixels; the stylesheet gives rows the same. */
const ROW = 22;

type Item = { head: ProblemGroup; expanded: boolean; row?: undefined } | { row: Tagged; head?: undefined };

const SOURCE_TITLES: Record<ProblemSource, string> = { structure: "Structure", schema: "Schema", dtc: "dtc" };
const GROUP_TITLES: [GroupBy, string][] = [
  ["rule", "By rule"],
  ["node", "By node"],
  ["property", "By property"],
  ["none", "Not grouped"],
];

export function ProblemsView({ problems, pathOf, onFocusNode, notes }: Props) {
  const [by, setBy] = useState<GroupBy>("rule");
  const [filter, setFilter] = useState<ProblemFilter>({ severity: "all", sources: new Set(SOURCES), text: "" });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const kept = useMemo(() => filterProblems(problems, filter, pathOf), [problems, filter, pathOf]);
  const groups = useMemo(() => groupProblems(kept, by, pathOf), [kept, by, pathOf]);
  const counts = useMemo(() => {
    const c: Record<ProblemSource, number> = { structure: 0, schema: 0, dtc: 0 };
    for (const t of problems) c[t.source]++;
    return c;
  }, [problems]);
  // One group of all, or a lone group, needs no click to open.
  const isOpen = (key: string, undocumented?: boolean) =>
    open.has(key) !== (!undocumented && (by === "none" || groups.length === 1));
  // Group heads and the rows of the open groups, as one list of rows of one
  // height, of which only those in view are drawn (US-11.3).
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const g of groups) {
      const expanded = isOpen(g.key, g.undocumented);
      if (by !== "none" || g.undocumented) out.push({ head: g, expanded });
      if (expanded) for (const t of g.problems) out.push({ row: t });
    }
    return out;
  }, [groups, open, by]);
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const toggleSource = (s: ProblemSource) =>
    setFilter((f) => {
      const sources = new Set(f.sources);
      if (!sources.delete(s)) sources.add(s);
      return { ...f, sources };
    });

  return (
    <section className="problems-view">
      <div className="problems-toolbar" role="toolbar" aria-label="Problem filters">
        <select aria-label="Group the problems" value={by} onChange={(e) => setBy(e.target.value as GroupBy)}>
          {GROUP_TITLES.map(([g, title]) => (
            <option key={g} value={g}>
              {title}
            </option>
          ))}
        </select>
        <select
          aria-label="Severity"
          value={filter.severity}
          onChange={(e) => setFilter((f) => ({ ...f, severity: e.target.value as ProblemFilter["severity"] }))}
        >
          <option value="all">Errors and warnings</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
        </select>
        {SOURCES.map((s) => (
          <button key={s} className="chip" aria-pressed={filter.sources.has(s)} onClick={() => toggleSource(s)} title={`Show the ${SOURCE_TITLES[s]} problems`}>
            {SOURCE_TITLES[s]} <span className="chip-count">{counts[s]}</span>
          </button>
        ))}
        <SearchField
          value={filter.text}
          onChange={(text) => setFilter((f) => ({ ...f, text }))}
          label="Filter the problems"
          placeholder="Filter by text, node path or property"
        />
        <span className="problems-total">
          {kept.length === problems.length ? `${problems.length}` : `${kept.length} of ${problems.length}`}
        </span>
      </div>
      {notes}
      {problems.length === 0 ? (
        <p className="hint">No problems found.</p>
      ) : kept.length === 0 ? (
        <p className="hint">No problem matches the filters.</p>
      ) : (
        <ProblemItems items={items} by={by} pathOf={pathOf} onFocusNode={onFocusNode} onToggle={toggle} />
      )}
    </section>
  );
}

/** The rows in view of the group heads and problems. */
function ProblemItems({
  items,
  by,
  pathOf,
  onFocusNode,
  onToggle,
}: {
  items: Item[];
  by: GroupBy;
  pathOf: (id: string) => string | undefined;
  onFocusNode: (id: string) => void;
  onToggle: (key: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const { start, end } = useVisibleRows(list, ".panel-body", items.length, ROW);
  return (
    <ul ref={list} className="problem-items" style={{ paddingTop: start * ROW, paddingBottom: (items.length - end) * ROW }}>
      {items.slice(start, end).map((item, k) => {
        if (item.head) {
          const g = item.head;
          return (
            <li key={`head:${g.key}`} className={g.undocumented ? "group undocumented" : "group"}>
              <button className="group-head" aria-expanded={item.expanded} onClick={() => onToggle(g.key)}>
                {item.expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                <span className="problem-group-title" title={g.title}>
                  {g.title}
                </span>
                <span className="badge">{g.problems.length}</span>
                {g.undocumented && <span className="hint">properties no binding documents, usually vendor ones</span>}
              </button>
            </li>
          );
        }
        const { problem: p, source } = item.row;
        const path = p.node ? pathOf(p.node) : undefined;
        const message = readable(p.message);
        return (
          <li key={start + k} className={`problem ${p.severity}${by === "none" ? "" : " in-group"}`}>
            <button
              disabled={!p.node}
              onClick={() => p.node && onFocusNode(p.node)}
              title={[path, p.property, message].filter(Boolean).join(" · ")}
            >
              <b>{p.severity}</b>
              {path && by !== "node" && <code>{path}</code>}
              {p.property && by !== "property" && <code className="problem-property">{p.property}</code>}
              <span className="problem-message">{message}</span>
              {(p.rule || source !== "schema") && <span className="problem-rule">{p.rule ?? SOURCE_TITLES[source]}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
