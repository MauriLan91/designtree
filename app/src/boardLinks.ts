// Links of the board view (US-14.2), drawn between the devices placed on
// the board. The backend finds what drives what over the whole tree; a
// node that is not on the board is drawn as the placed device that holds
// it, so a GPIO bank under an unplaced pin controller shows as the SoC.
import type { Edge } from "@xyflow/react";
import { REF_HANDLE, type BoardLink, type LinkKind } from "./model";

export const LINK_KINDS: { kind: LinkKind; title: string }[] = [
  { kind: "i2c", title: "I²C" },
  { kind: "spi", title: "SPI" },
  { kind: "gpio", title: "GPIO" },
  { kind: "interrupt", title: "Interrupts" },
  { kind: "bus", title: "Other buses" },
  { kind: "reference", title: "Other references" },
];

/** On at first: the connections the story is about. The rest join almost every device. */
export const DEFAULT_KINDS: LinkKind[] = ["i2c", "spi", "gpio", "interrupt"];

export interface DrawnLink {
  from: string;
  to: string;
  kind: LinkKind;
  via: string[];
  /** Position among the links between the same two devices, to fan them out. */
  lane: number;
  lanes: number;
}

/**
 * The links between placed devices, one per pair and kind. `edges` are
 * the canvas edges, for the hierarchy; `placed` the devices on the board.
 */
export function drawnLinks(links: BoardLink[], edges: Edge[], placed: Set<string>, kinds: Set<LinkKind>): DrawnLink[] {
  const parent = new Map<string, string>();
  for (const e of edges) if (e.sourceHandle !== REF_HANDLE) parent.set(e.target, e.source);
  const holder = new Map<string, string | null>();
  const resolve = (id: string): string | null => {
    const known = holder.get(id);
    if (known !== undefined) return known;
    let found: string | null = null;
    for (let at: string | undefined = id, depth = 0; at !== undefined && depth < 256; at = parent.get(at), depth++) {
      if (placed.has(at)) {
        found = at;
        break;
      }
    }
    holder.set(id, found);
    return found;
  };

  const drawn = new Map<string, DrawnLink>();
  for (const link of links) {
    if (!kinds.has(link.kind)) continue;
    const from = resolve(link.from);
    const to = resolve(link.to);
    if (!from || !to || from === to) continue;
    const key = `${from}\n${to}\n${link.kind}`;
    const found = drawn.get(key);
    if (found) {
      for (const v of link.via) if (!found.via.includes(v)) found.via.push(v);
    } else {
      drawn.set(key, { from, to, kind: link.kind, via: [...link.via], lane: 0, lanes: 1 });
    }
  }

  // Links between the same two devices, either way round, side by side.
  const pairs = new Map<string, DrawnLink[]>();
  for (const l of drawn.values()) {
    const key = l.from < l.to ? `${l.from}\n${l.to}` : `${l.to}\n${l.from}`;
    pairs.set(key, [...(pairs.get(key) ?? []), l]);
  }
  for (const group of pairs.values()) {
    group.forEach((l, i) => {
      l.lane = i;
      l.lanes = group.length;
    });
  }
  return [...drawn.values()];
}
