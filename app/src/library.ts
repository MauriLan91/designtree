// The element library as the side bar lists it (US-18.1): one entry per
// compatible, not one per schema, so that `arm,cortex-a7` is found and added
// as itself. Entries are light; a schema's properties are fetched when an
// entry is added.
import { backend } from "./backend";
import type { Binding, LibraryEntry } from "./model";

/** The basic nodes' category (US-18.3), shown first. */
export const BASIC_CATEGORY = "basic";

/** The last basic entry: a node with nothing preset, for anything else. */
export const EMPTY_ENTRY: LibraryEntry = { path: "", category: BASIC_CATEGORY, title: "Empty node" };

/** A basic node as a library entry. */
export const basicEntry = (b: Binding): LibraryEntry => ({ path: b.path, category: b.category, title: b.title });

/** How favorites and recents remember an entry: its schema and compatible. */
export function entryKey(e: LibraryEntry): string {
  return e.compatible ? `${e.path}#${e.compatible}` : e.path;
}

/** The entry a remembered key names, given the schemas the kernel has. A
 * key from before US-18.1 is a bare path and names the first compatible. */
export function entryOfKey(key: string, bindings: Binding[]): LibraryEntry | null {
  const [path, compatible] = key.split("#");
  const b = bindings.find((x) => x.path === path);
  if (!b || (compatible && !b.compatibles?.includes(compatible))) return null;
  return { path, category: b.category, title: b.title, compatible: compatible ?? b.compatibles?.[0] };
}

/** The schema of an entry, with the entry's compatible first, which is the
 * one a new node takes. */
export function withCompatible(binding: Binding, compatible: string | null | undefined): Binding {
  if (!compatible || !binding.compatibles?.includes(compatible)) return binding;
  return { ...binding, compatibles: [compatible, ...binding.compatibles.filter((c) => c !== compatible)] };
}

/** The binding an entry adds; null for the empty node and for a schema
 * the loaded kernel no longer has. */
export async function bindingOf(entry: LibraryEntry): Promise<Binding | null> {
  if (!entry.path) return null;
  const [binding] = await backend.getBindings([entry.path]);
  return binding ? withCompatible(binding, entry.compatible) : null;
}

/**
 * The text split into plain and matched parts, for highlighting the words
 * of a query: each word marks where it occurs. A word the search matched
 * only by scattered letters marks nothing.
 */
export function highlight(text: string, query: string): { text: string; match: boolean }[] {
  const lower = text.toLowerCase();
  // Lowercasing can change the length (`İ`); then positions would not match.
  if (lower.length !== text.length) return [{ text, match: false }];
  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + 1)) {
      marked.fill(true, i, i + word.length);
    }
  }
  const parts: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], match: marked[i] });
  }
  return parts;
}
