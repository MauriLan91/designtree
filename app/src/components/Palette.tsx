import { useEffect, useState } from "react";
import { backend, dialogs, inTauri, type CatalogSummary } from "../backend";
import type { Binding } from "../model";

export const DRAG_MIME = "application/x-designtree-binding";

interface Props {
  onAdd: (binding: Binding | null) => void;
  /** Kernel tree to index immediately, e.g. from the startup arguments. */
  initialKernel?: string | null;
}

/** Element library built from the kernel binding schemas. */
export function Palette({ onAdd, initialKernel }: Props) {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [results, setResults] = useState<Binding[]>([]);

  const loadKernel = async (dir: string | null) => {
    if (!dir) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await backend.loadKernelBindings(dir));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKernel(initialKernel ?? null);
  }, [initialKernel]);

  useEffect(() => {
    if (!summary) return;
    const t = setTimeout(() => {
      backend.searchBindings(query, category || null).then(setResults, (e) => setError(String(e)));
    }, 150);
    return () => clearTimeout(t);
  }, [summary, query, category]);

  return (
    <aside className="panel palette">
      <h2>Library</h2>
      <button onClick={() => onAdd(null)} className="wide">+ Empty node</button>
      {!summary && (
        <>
          <p className="hint">
            Load the binding schemas of a Linux source tree to browse thousands of devices.
          </p>
          <button onClick={async () => loadKernel(await dialogs.pickKernelTree())} disabled={!inTauri || loading} className="wide primary">
            {loading ? "Indexing…" : "Load kernel bindings…"}
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {summary && (
        <>
          <p className="hint">
            {summary.bindings.toLocaleString()} bindings, {summary.compatibles.toLocaleString()} compatibles
          </p>
          <input
            placeholder="Search compatible or title"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {summary.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <ul className="binding-list">
            {results.map((b) => (
              <li
                key={b.path}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(b));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDoubleClick={() => onAdd(b)}
                title={`${b.path}\nDrag onto the canvas or double-click to add`}
              >
                <div className="binding-title">{b.title ?? b.path}</div>
                <div className="binding-compat">{b.compatibles?.[0] ?? b.path}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
