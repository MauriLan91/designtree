import { useEffect, useRef, useState, type ReactNode } from "react";
import { backend, dialogs, inTauri, type CatalogSummary } from "../backend";
import { loadList, saveList, toggled, withRecent } from "../libraryHistory";
import { bindingOf, entryKey, entryOfKey, highlight } from "../library";
import type { Binding, LibraryEntry } from "../model";
import { KINDS, kindOf } from "../categories";

/** Drag data of a library entry: a [`LibraryEntry`] as JSON. */
export const DRAG_MIME = "application/x-designtree-entry";

interface Props {
  onAdd: (binding: Binding | null) => void;
  /** Kernel tree to index now: from the startup arguments, or picked in the kernel settings. */
  requestedKernel?: string | null;
  /** Called with the summary of each kernel tree that was indexed. */
  onKernelLoaded?: (summary: CatalogSummary) => void;
}

/** Element library built from the kernel binding schemas: one entry per
 * compatible (US-18.1), in a virtualized list. */
export function Palette({ onAdd, requestedKernel, onKernelLoaded }: Props) {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("");
  // The entries with the query they answer, which the count and the
  // highlights follow rather than the text still being typed.
  const [results, setResults] = useState<{ query: string; entries: LibraryEntry[] }>({ query: "", entries: [] });
  const [favorites, setFavorites] = useState(() => loadList("favorites"));
  const [recents, setRecents] = useState(() => loadList("recents"));
  const [favoriteEntries, setFavoriteEntries] = useState<LibraryEntry[]>([]);
  const [recentEntries, setRecentEntries] = useState<LibraryEntry[]>([]);

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
      backend.libraryEntries(query, category || null).then(
        (entries) => {
          setResults({ query, entries });
          setError(null);
        },
        (e) => setError(String(e)),
      );
    }, 150);
    return () => clearTimeout(t);
  }, [summary, query, category]);

  // Favorites and recents are kept by schema path and compatible; the
  // loaded kernel resolves them.
  useEffect(() => {
    if (!summary) return;
    const paths = [...new Set([...favorites, ...recents].map((k) => k.split("#")[0]))];
    backend.getBindings(paths).then(
      (bindings) => {
        const resolve = (keys: string[]) => keys.map((k) => entryOfKey(k, bindings)).filter((e): e is LibraryEntry => e !== null);
        // Keys saved as a bare path before US-18.1 are rewritten with the
        // compatible they resolved to, so the star and the toggle match them.
        const migrate = (key: "favorites" | "recents", keys: string[], entries: LibraryEntry[], set: (k: string[]) => void) => {
          const next = [...new Set(entries.map(entryKey))];
          if (keys.some((k) => !k.includes("#")) && next.join() !== keys.join()) {
            saveList(key, next);
            set(next);
          }
        };
        const fav = resolve(favorites);
        const rec = resolve(recents);
        setFavoriteEntries(fav);
        setRecentEntries(rec);
        migrate("favorites", favorites, fav, setFavorites);
        migrate("recents", recents, rec, setRecents);
      },
      () => {
        setFavoriteEntries([]);
        setRecentEntries([]);
      },
    );
  }, [summary, favorites, recents]);

  const toggleFavorite = (e: LibraryEntry) => {
    const next = toggled(favorites, entryKey(e));
    setFavorites(next);
    saveList("favorites", next);
  };
  const used = (e: LibraryEntry) => {
    const next = withRecent(recents, entryKey(e));
    setRecents(next);
    saveList("recents", next);
  };
  const add = async (e: LibraryEntry) => {
    const binding = await bindingOf(e).catch(() => null);
    if (!binding) return setError(`${e.path} is not in the loaded kernel`);
    setError(null);
    used(e);
    onAdd(binding);
  };

  const row = (e: LibraryEntry, key: string, q = "") => {
    const favorite = favorites.includes(entryKey(e));
    return (
      <li
        key={key}
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData(DRAG_MIME, JSON.stringify(e));
          ev.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={(ev) => ev.dataTransfer.dropEffect !== "none" && used(e)}
        onDoubleClick={() => add(e)}
        title={`${e.path}\nDrag onto the canvas or double-click to add`}
      >
        <div className="binding-row">
          <EntryChip category={e.category} />
          <div className="binding-text">
            <div className="binding-title">
              <Marked text={e.title ?? e.path} query={q} />
            </div>
            <div className="binding-compat">
              <Marked text={e.compatible ?? e.path} query={q} />
            </div>
          </div>
          <button
            className="star"
            aria-pressed={favorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => toggleFavorite(e)}
            onDoubleClick={(ev) => ev.stopPropagation()}
          >
            {favorite ? "★" : "☆"}
          </button>
        </div>
      </li>
    );
  };

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
          {!query.trim() && favoriteEntries.length > 0 && (
            <>
              <h3>Favorites</h3>
              <ul className="binding-list short">{favoriteEntries.map((e) => row(e, `f:${entryKey(e)}`))}</ul>
            </>
          )}
          {!query.trim() && recentEntries.length > 0 && (
            <>
              <h3>Recent</h3>
              <ul className="binding-list short">{recentEntries.map((e) => row(e, `r:${entryKey(e)}`))}</ul>
            </>
          )}
          <h3 aria-live="polite">
            {results.entries.length.toLocaleString()}{" "}
            {results.query.trim() ? (results.entries.length === 1 ? "match" : "matches") : "devices"}
          </h3>
          <VirtualList items={results.entries} render={(e) => row(e, entryKey(e), results.query)} />
        </>
      )}
    </aside>
  );
}

function EntryChip({ category }: { category: string }) {
  const kind = kindOf(category, "");
  const { Icon, title } = KINDS[kind];
  return (
    <span className={`kind-chip large kind-${kind}`} title={title}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  return (
    <>
      {highlight(text, query).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : p.text))}
    </>
  );
}

/** Height of a library row, its gap included; the list draws only the rows in view. */
const ROW_HEIGHT = 54;
const OVERSCAN = 6;

/**
 * A list of thousands of entries that renders only the visible rows, with
 * spacers standing in for the rest so the scroll bar keeps its size.
 */
function VirtualList<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(800);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // New results start from the top.
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
    setTop(0);
  }, [items]);
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((top + height) / ROW_HEIGHT) + OVERSCAN);
  return (
    <ul className="binding-list virtual" ref={list} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <li className="spacer" aria-hidden style={{ height: first * ROW_HEIGHT }} />
      {items.slice(first, last).map(render)}
      <li className="spacer" aria-hidden style={{ height: (items.length - last) * ROW_HEIGHT }} />
    </ul>
  );
}
