import { ChevronDown, ChevronRight, LayoutGrid, List, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { backend, dialogs, inTauri, type CatalogSummary } from "../backend";
import { loadList, loadPrefs, saveList, savePrefs, toggled, withRecent } from "../libraryHistory";
import { BASIC_CATEGORY, EMPTY_ENTRY, basicEntry, bindingOf, entryKey, entryOfKey, highlight } from "../library";
import type { Binding, LibraryEntry } from "../model";
import { KINDS, kindOf } from "../categories";
import { classTitle } from "../fits";
import { activeCount, applyFilters, busTitle, facet, loadFilters, NO_FILTERS, saveFilters, type Filters } from "../libraryFilters";
import {
  CLASSES,
  TILE_WIDTH,
  classSections,
  historySections,
  layoutRows,
  openByDefault,
  vendorOf,
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
  /** The bus class and name of the scope on show in the active tab, whose
   * fitting elements come first (US-18.4). */
  fit?: { cls: string; name: string } | null;
  /** Kernel tree to index now: from the startup arguments, or picked in the kernel settings. */
  requestedKernel?: string | null;
  /** Called with the summary of each kernel tree that was indexed. */
  onKernelLoaded?: (summary: CatalogSummary) => void;
}

/** Element library built from the kernel binding schemas: one entry per
 * compatible (US-18.1), grouped in collapsible sections by category and
 * drawn as a list or a grid (US-18.2). Only the rows in view are drawn. */
export function Palette({ onAdd, fit, requestedKernel, onKernelLoaded }: Props) {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const updateFilters = (next: Filters) => {
    setFilters(next);
    saveFilters(next);
  };
  const [vendorNames, setVendorNames] = useState<Record<string, string>>({});
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
      backend.libraryEntries(query, null).then(
        (entries) => {
          setResults({ query, entries });
          setError(null);
        },
        (e) => setError(String(e)),
      );
    }, 150);
    return () => clearTimeout(t);
  }, [summary, query]);

  // Vendor names from the kernel's vendor-prefixes.yaml, for the filter.
  useEffect(() => {
    if (summary) backend.libraryVendors().then((v) => setVendorNames(v ?? {}), () => setVendorNames({}));
  }, [summary]);

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
  // Board and SoC schemas are not devices to add: their compatibles go on
  // the root node, which offers them in the inspector (US-18.6).
  const devices = useMemo(() => results.entries.filter((e) => !e.root), [results]);
  const vendorName = useCallback((v: string) => (v ? (vendorNames[v] ?? v) : "Generic"), [vendorNames]);
  // The filters (US-18.7) narrow the devices; "Fits here" also ranks them.
  const fitCls = fit?.cls ?? null;
  const filtered = useMemo(() => applyFilters(devices, filters, fitCls), [devices, filters, fitCls]);
  const filtering = activeCount(filters) > 0 && !(filters.fits && !fitCls && activeCount(filters) === 1);
  // Each filter offers the values the other filters leave, with counts.
  const facets = useMemo(() => {
    const without = (patch: Partial<Filters>) => applyFilters(devices, { ...filters, ...patch }, fitCls);
    return {
      cls: facet(without({ cls: undefined }), (e) => [e.class || "other"]),
      vendor: facet(without({ vendor: undefined }), (e) => [vendorOf(e)]),
      bus: facet(without({ bus: undefined }), (e) => e.buses ?? []),
    };
  }, [devices, filters, fitCls]);
  // Grouped once per result set; a star or an add only changes the history sections.
  const classes = useMemo(() => (searching ? [] : classSections(filtered, vendorName)), [searching, filtered, vendorName]);
  const basicSection: Section = useMemo(
    () => ({ id: "basic", title: "Basic", category: BASIC_CATEGORY, entries: [...basics.map(basicEntry), EMPTY_ENTRY] }),
    [basics],
  );
  const fitsTitle = fit ? `Fits here · ${fit.name}` : "";
  const sections: Section[] = useMemo(() => {
    // What fits the scope is one ranked list: the ranking is the point.
    if (filters.fits && fitCls) return [{ id: "fits", title: fitsTitle, entries: filtered, headless: true }];
    if (searching) {
      const words = results.query.toLowerCase().split(/\s+/).filter(Boolean);
      const basicMatches = filtering
        ? []
        : basicSection.entries.filter((e) => words.every((w) => `${e.title} ${nodeNames.get(e.path) ?? ""}`.toLowerCase().includes(w)));
      return [{ id: "matches", title: "Matches", entries: [...basicMatches, ...filtered], headless: true }];
    }
    // Filtered, the library shows only what the filters keep.
    if (filtering) return classes;
    return [basicSection, ...historySections(favoriteEntries, recentEntries), ...classes];
  }, [searching, results, filtered, filtering, filters.fits, fitCls, classes, basicSection, nodeNames, favoriteEntries, recentEntries, fitsTitle]);

  // Search matches include the basic nodes that match.
  const shown = searching ? sections.reduce((n, s) => n + s.entries.length, 0) : filtered.length;

  const renderRow = (row: Row, columns: number) => {
    const { section } = row;
    if (row.type === "header") {
      const count = section.entries.length.toLocaleString();
      return (
        <button
          className={`lib-header${section.depth ? " sub" : ""}`}
          aria-expanded={row.open}
          onClick={() => toggleSection(section.id)}
          title={section.children ? `${section.title}: ${section.children.length} vendors` : section.title}
        >
          {row.open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {section.category && !section.depth && <EntryChip category={section.category} small />}
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

  const viewToggle = (
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
  );

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
          <SearchField value={query} onChange={setQuery} />
        </>
      )}
      {!summary && <div className="lib-filters">{viewToggle}</div>}
      {summary && (
        <div className="filter-chips" role="group" aria-label="Filters">
          <FilterChip
            label="Class"
            value={filters.cls}
            options={facets.cls.map(([c, n]) => [c, CLASSES.find(([id]) => id === c)?.[1] ?? c, n])}
            onChange={(cls) => updateFilters({ ...filters, cls })}
          />
          <FilterChip
            label="Vendor"
            value={filters.vendor}
            options={facets.vendor.map(([v, n]) => [v, vendorName(v), n] as [string, string, number]).sort((a, b) => a[1].localeCompare(b[1]))}
            onChange={(vendor) => updateFilters({ ...filters, vendor })}
          />
          <FilterChip label="Bus" value={filters.bus} options={facets.bus.map(([b, n]) => [b, busTitle(b), n])} onChange={(bus) => updateFilters({ ...filters, bus })} />
          <button
            className={`filter-chip toggle${filters.fits && fitCls ? " active" : ""}`}
            aria-pressed={filters.fits}
            disabled={!fit}
            title={fit ? `Only what goes under ${classTitle(fit.cls)} (${fit.name}), made-for-it first` : "Open a bus node's scope to see what fits there"}
            onClick={() => updateFilters({ ...filters, fits: !filters.fits })}
          >
            Fits here
          </button>
          {viewToggle}
        </div>
      )}
      {summary && (
        <p className="lib-total" aria-live="polite">
          {shown.toLocaleString()} {searching ? (shown === 1 ? "match" : "matches") : shown === 1 ? "device" : "devices"}
          {filters.fits && fit && ` under ${fit.name}`}
          {activeCount(filters) > 0 && (
            <>
              {" · "}
              <button className="link" onClick={() => updateFilters(NO_FILTERS)}>
                Clear filters
              </button>
            </>
          )}
        </p>
      )}
      <SectionList
        sections={sections}
        isOpen={searching || (filtering && filtered.length <= 500) ? alwaysOpen : isOpen}
        display={prefs.display}
        render={renderRow}
        resetKey={results}
      />
    </aside>
  );
}

/**
 * A filter as a chip (US-18.7): its name while unset, its value once
 * picked. A native select over the chip opens the values, each with how
 * many devices it keeps; the × beside a set chip clears it.
 */
function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: [string, string, number][];
  onChange: (value: string | undefined) => void;
}) {
  const current = value === undefined ? undefined : (options.find(([v]) => v === value)?.[1] ?? value);
  return (
    <span className={`filter-chip${value !== undefined ? " active" : ""}`}>
      <span className="filter-chip-text" title={current ? `${label}: ${current}` : `Filter by ${label.toLowerCase()}`}>
        {current ?? label}
        <ChevronDown size={12} aria-hidden />
        <select aria-label={`Filter by ${label.toLowerCase()}`} value={value ?? "\u0000"} onChange={(e) => onChange(e.target.value === "\u0000" ? undefined : e.target.value)}>
          <option value={"\u0000"}>Any {label.toLowerCase()}</option>
          {value !== undefined && !options.some(([v]) => v === value) && <option value={value}>{current} (0)</option>}
          {options.map(([v, title, n]) => (
            <option key={v} value={v}>
              {title} ({n.toLocaleString()})
            </option>
          ))}
        </select>
      </span>
      {value !== undefined && (
        <button className="filter-chip-clear" aria-label={`Clear the ${label.toLowerCase()} filter`} onClick={() => onChange(undefined)}>
          <X size={12} aria-hidden />
        </button>
      )}
    </span>
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

/** A search with a button and Escape to clear it (US-18.5): the library's,
 * and the Outline's filter. */
export function SearchField({
  value,
  onChange,
  label = "Search the library",
  placeholder = "Search compatible or title",
  onKeyDown,
}: {
  value: string;
  onChange: (text: string) => void;
  label?: string;
  placeholder?: string;
  /** Other keys, such as Enter; Escape is the field's. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="search-field">
      <input
        ref={input}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Only a search with text uses Escape; otherwise it is the window's.
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          } else onKeyDown?.(e);
        }}
      />
      {value && (
        <button
          className="search-clear"
          aria-label="Clear the search"
          title="Clear (Esc)"
          // Keeps the focus in the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
