import { useEffect, useState } from "react";
import { backend, dialogs, inTauri, type CatalogSummary } from "../backend";
import { loadList, saveList, toggled, withRecent } from "../libraryHistory";
import type { Binding } from "../model";

export const DRAG_MIME = "application/x-designtree-binding";

interface Props {
  onAdd: (binding: Binding | null) => void;
  /** Kernel tree to index now: from the startup arguments, or picked in the kernel settings. */
  requestedKernel?: string | null;
  /** Called with the summary of each kernel tree that was indexed. */
  onKernelLoaded?: (summary: CatalogSummary) => void;
}

/** Element library built from the kernel binding schemas. */
export function Palette({ onAdd, requestedKernel, onKernelLoaded }: Props) {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  const [results, setResults] = useState<Binding[]>([]);
  const [favorites, setFavorites] = useState(() => loadList("favorites"));
  const [recents, setRecents] = useState(() => loadList("recents"));
  const [favoriteBindings, setFavoriteBindings] = useState<Binding[]>([]);
  const [recentBindings, setRecentBindings] = useState<Binding[]>([]);

  const loadKernel = async (dir: string | null) => {
    if (!dir) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await backend.loadKernelBindings(dir);
      setSummary(loaded);
      onKernelLoaded?.(loaded);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKernel(requestedKernel ?? null);
  }, [requestedKernel]);

  useEffect(() => {
    if (!summary) return;
    const t = setTimeout(() => {
      backend.searchBindings(query, category || null).then(setResults, (e) => setError(String(e)));
    }, 150);
    return () => clearTimeout(t);
  }, [summary, query, category]);

  // Favorites and recents are kept by path; the loaded kernel resolves them.
  useEffect(() => {
    if (!summary) return;
    backend.getBindings(favorites).then(setFavoriteBindings, () => setFavoriteBindings([]));
    backend.getBindings(recents).then(setRecentBindings, () => setRecentBindings([]));
  }, [summary, favorites, recents]);

  const toggleFavorite = (b: Binding) => {
    const next = toggled(favorites, b.path);
    setFavorites(next);
    saveList("favorites", next);
  };
  const used = (b: Binding) => {
    const next = withRecent(recents, b.path);
    setRecents(next);
    saveList("recents", next);
  };
  const add = (b: Binding) => {
    used(b);
    onAdd(b);
  };

  const row = (b: Binding, key: string) => (
    <li
      key={key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(b));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={(e) => e.dataTransfer.dropEffect !== "none" && used(b)}
      onDoubleClick={() => add(b)}
      title={`${b.path}\nDrag onto the canvas or double-click to add`}
    >
      <div className="binding-row">
        <div className="binding-text">
          <div className="binding-title">{b.title ?? b.path}</div>
          <div className="binding-compat">{b.compatibles?.[0] ?? b.path}</div>
        </div>
        <button
          className="star"
          aria-pressed={favorites.includes(b.path)}
          aria-label={favorites.includes(b.path) ? "Remove from favorites" : "Add to favorites"}
          onClick={() => toggleFavorite(b)}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {favorites.includes(b.path) ? "★" : "☆"}
        </button>
      </div>
    </li>
  );

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
            {summary.version && ` · kernel ${summary.version}`}
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
          {!query.trim() && favoriteBindings.length > 0 && (
            <>
              <h3>Favorites</h3>
              <ul className="binding-list short">{favoriteBindings.map((b) => row(b, `f:${b.path}`))}</ul>
            </>
          )}
          {!query.trim() && recentBindings.length > 0 && (
            <>
              <h3>Recent</h3>
              <ul className="binding-list short">{recentBindings.map((b) => row(b, `r:${b.path}`))}</ul>
            </>
          )}
          <ul className="binding-list">{results.map((b) => row(b, b.path))}</ul>
        </>
      )}
    </aside>
  );
}
