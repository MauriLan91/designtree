import { ChevronDown, ChevronRight, LayoutGrid, List } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { backend, dialogs, inTauri, type CatalogSummary } from "../backend";
import { loadList, loadPrefs, saveList, savePrefs, toggled, withRecent } from "../libraryHistory";
import { BASIC_CATEGORY, EMPTY_ENTRY, basicEntry, bindingOf, entryKey, entryOfKey, highlight } from "../library";
import type { Binding, LibraryEntry } from "../model";
import { KINDS, kindOf } from "../categories";
import {
  TILE_WIDTH,
  categorySections,
  historySections,
  layoutRows,
  openByDefault,
  rowHeight,
  rowOffsets,
  visibleRange,
  type Display,
  type Row,
  type Section,
} from "../libraryView";

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
 * compatible (US-18.1), grouped in collapsible sections by category and
 * drawn as a list or a grid (US-18.2). Only the rows in view are drawn. */
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
  const [basics, setBasics] = useState<Binding[]>([]);
  const [prefs, setPrefs] = useState(loadPrefs);
  const updatePrefs = (next: typeof prefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  // Stable while nothing changes, so scrolling does not lay the rows out again.
  const isOpen = useCallback((id: string) => prefs.open[id] ?? openByDefault(id), [prefs.open]);
  const toggleSection = (id: string) => updatePrefs({ ...prefs, open: { ...prefs.open, [id]: !isOpen(id) } });

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

  // The basic nodes come with the app, so they are there before a kernel.
  useEffect(() => {
    if (inTauri) backend.basicBindings().then(setBasics, () => setBasics([]));
  }, []);
  const nodeNames = useMemo(() => new Map(basics.map((b) => [b.path, b.node_name ?? ""])), [basics]);
  /** What the second line of an entry names: its compatible, or the node a basic entry adds. */
  const subtitle = (e: LibraryEntry) => e.compatible ?? (e.path ? (nodeNames.get(e.path) ?? e.path) : "any node, nothing preset");

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
  // loaded kernel resolves them, and the app itself the basic nodes.
  useEffect(() => {
    if (!inTauri) return;
    const paths = [...new Set([...favorites, ...recents].map((k) => k.split("#")[0]))];
    backend.getBindings(paths).then(
      (bindings) => {
        const resolve = (keys: string[]) => keys.map((k) => entryOfKey(k, bindings)).filter((e): e is LibraryEntry => e !== null);
        // Keys saved as a bare path before US-18.1 are rewritten with the
        // compatible they resolved to, so the star and the toggle match them.
        const migrate = (key: "favorites" | "recents", keys: string[], entries: LibraryEntry[], set: (k: string[]) => void) => {
          const next = [...new Set(entries.map(entryKey))];
          // Only with a kernel loaded, which every saved device key needs; a
          // basic node's key is a bare path of its own.
          const legacy = keys.some((k) => !k.includes("#") && !k.startsWith(`dtschema/`));
          if (summary && legacy && next.join() !== keys.join()) {
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
    if (!e.path) return; // the empty node is not worth remembering
    const next = withRecent(recents, entryKey(e));
    setRecents(next);
    saveList("recents", next);
  };
  const add = async (e: LibraryEntry) => {
    if (e === EMPTY_ENTRY || !e.path) return onAdd(null);
    const binding = await bindingOf(e).catch(() => null);
    if (!binding) return setError(e.category === BASIC_CATEGORY ? `Could not load the ${e.title} node` : `${e.path} is not in the loaded kernel`);
    setError(null);
    used(e);
    onAdd(binding);
  };

  const entryProps = (e: LibraryEntry) => ({
    draggable: true,
    tabIndex: 0,
    onDragStart: (ev: React.DragEvent) => {
      ev.dataTransfer.setData(DRAG_MIME, JSON.stringify(e));
      ev.dataTransfer.effectAllowed = "move" as const;
    },
    onDragEnd: (ev: React.DragEvent) => ev.dataTransfer.dropEffect !== "none" && used(e),
    onDoubleClick: () => add(e),
    // Only the entry itself: Enter on its star toggles the favorite alone.
    onKeyDown: (ev: React.KeyboardEvent) => ev.key === "Enter" && ev.target === ev.currentTarget && add(e),
    title: `${e.title ?? e.path}\n${e.compatible ?? ""}\nDrag onto the canvas or double-click to add`,
  });

  const star = (e: LibraryEntry) => {
    if (!e.path) return null;
    const favorite = favorites.includes(entryKey(e));
    return (
      <button
        className="star"
        aria-pressed={favorite}
        aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => toggleFavorite(e)}
        onDoubleClick={(ev) => ev.stopPropagation()}
      >
        {favorite ? "★" : "☆"}
      </button>
    );
  };

  const searching = results.query.trim() !== "";
  // Grouped once per result set; a star or an add only changes the history sections.
  const categories = useMemo(() => (searching ? [] : categorySections(results.entries)), [searching, results]);
  const basicSection: Section = useMemo(
    () => ({ id: "basic", title: "Basic", category: BASIC_CATEGORY, entries: [...basics.map(basicEntry), EMPTY_ENTRY] }),
    [basics],
  );
  const sections: Section[] = useMemo(() => {
    if (searching && category) return [{ id: "matches", title: "Matches", entries: results.entries, headless: true }];
    if (searching) {
      const words = results.query.toLowerCase().split(/\s+/).filter(Boolean);
      const basicMatches = basicSection.entries.filter((e) =>
        words.every((w) => `${e.title} ${nodeNames.get(e.path) ?? ""}`.toLowerCase().includes(w)),
      );
      return [{ id: "matches", title: "Matches", entries: [...basicMatches, ...results.entries], headless: true }];
    }
    // A picked category shows its elements, without the history of other ones.
    if (category) return categories;
    return [basicSection, ...historySections(favoriteEntries, recentEntries), ...categories];
  }, [searching, results, category, categories, basicSection, nodeNames, favoriteEntries, recentEntries]);

  // Search matches include the basic nodes that match.
  const shown = searching ? sections[0].entries.length : results.entries.length;

  const renderRow = (row: Row, columns: number) => {
    const { section } = row;
    if (row.type === "header") {
      const count = section.entries.length.toLocaleString();
      return (
        <button className="lib-header" aria-expanded={row.open} onClick={() => toggleSection(section.id)} title={section.category}>
          {row.open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {section.category && <EntryChip category={section.category} small />}
          <span className="lib-header-title">{section.title}</span>
          <span className="lib-count">{count}</span>
        </button>
      );
    }
    const q = searching ? results.query : "";
    if (prefs.display === "grid") {
      return (
        <div className="lib-tiles" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {row.entries.map((e) => (
            <div key={entryKey(e)} className="lib-tile" {...entryProps(e)}>
              <EntryChip category={e.category} name={subtitle(e)} />
              <span className="lib-tile-name">
                <Marked text={subtitle(e)} query={q} />
              </span>
              {star(e)}
            </div>
          ))}
        </div>
      );
    }
    const e = row.entries[0];
    return (
      <div className="lib-item binding-row" {...entryProps(e)}>
        <EntryChip category={e.category} name={subtitle(e)} />
        <div className="binding-text">
          <div className="binding-title">
            <Marked text={e.title ?? e.path} query={q} />
          </div>
          <div className="binding-compat">
            <Marked text={subtitle(e)} query={q} />
          </div>
        </div>
        {star(e)}
      </div>
    );
  };

  return (
    <aside className="panel palette">
      <h2>Library</h2>
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
        </>
      )}
      <div className="lib-filters">
        {summary && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {summary.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <div className="segmented" role="group" aria-label="Library view">
          {(["list", "grid"] as Display[]).map((d) => (
            <button
              key={d}
              aria-pressed={prefs.display === d}
              aria-label={d === "list" ? "List" : "Grid"}
              title={d === "list" ? "List" : "Grid"}
              onClick={() => updatePrefs({ ...prefs, display: d })}
            >
              {d === "list" ? <List size={14} aria-hidden /> : <LayoutGrid size={14} aria-hidden />}
            </button>
          ))}
        </div>
      </div>
      {summary && (
        <p className="lib-total" aria-live="polite">
          {shown.toLocaleString()} {searching ? (shown === 1 ? "match" : "matches") : category ? `in ${category}` : "devices"}
        </p>
      )}
      <SectionList
        sections={sections}
        isOpen={searching || category ? alwaysOpen : isOpen}
        display={prefs.display}
        render={renderRow}
        resetKey={results}
      />
    </aside>
  );
}

function EntryChip({ category, name = "", small }: { category: string; name?: string; small?: boolean }) {
  const kind = kindOf(category, name.split("@")[0]);
  const { Icon, title } = KINDS[kind];
  return (
    <span className={`kind-chip ${small ? "" : "large "}kind-${kind}`} title={title}>
      <Icon size={small ? 12 : 16} strokeWidth={1.75} aria-hidden />
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

const alwaysOpen = () => true;

/** Pixels drawn above and below the view, so fast scrolling shows no gaps. */
const OVERSCAN = 400;

/**
 * The sections as one scrolling column that draws only the rows in view;
 * the rest is empty space of the right height, so the scroll bar stays true
 * over tens of thousands of entries.
 */
function SectionList({
  sections,
  isOpen,
  display,
  render,
  resetKey,
}: {
  sections: Section[];
  isOpen: (id: string) => boolean;
  display: Display;
  render: (row: Row, columns: number) => ReactNode;
  /** A new value scrolls back to the top: new results. */
  resetKey: unknown;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [size, setSize] = useState({ width: 240, height: 800 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // The content box: the scroller's padding holds no tiles.
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    setTop(0);
  }, [resetKey]);
  const columns = Math.max(1, Math.floor(size.width / TILE_WIDTH));
  const rows = useMemo(() => layoutRows(sections, isOpen, display, columns), [sections, isOpen, display, columns]);
  const tops = useMemo(() => rowOffsets(rows, display), [rows, display]);
  const [first, end] = visibleRange(tops, Math.max(0, top - OVERSCAN), size.height + 2 * OVERSCAN);
  return (
    <div className="lib-scroll" ref={scroller} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div className="lib-canvas" style={{ height: tops[rows.length] }}>
        {rows.slice(first, end).map((row, i) => (
          <div
            key={row.type === "header" ? `h:${row.section.id}` : `${row.section.id}:${entryKey(row.entries[0])}`}
            className="lib-row"
            style={{ top: tops[first + i], height: rowHeight(row, display) }}
          >
            {render(row, columns)}
          </div>
        ))}
      </div>
    </div>
  );
}
