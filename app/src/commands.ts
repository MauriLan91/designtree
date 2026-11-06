// The command registry (D9): one list of commands feeds the menu bar, the
// toolbar, the command palette and the keyboard shortcuts, so a command's
// title, shortcut and enabled state are written once.
import type { LucideIcon } from "lucide-react";

/** A second step that picks a node, as for "Connect to…". */
export interface NodePick {
  title: string;
  nodes: { id: string; title: string }[];
  onPick: (id: string) => void;
}

export const MENUS = ["File", "Edit", "View", "Insert", "Tools", "Help"] as const;
export type MenuName = (typeof MENUS)[number];

export interface Command {
  id: string;
  title: string;
  /** As shown and matched, e.g. `Ctrl+Shift+Z` or `F1`. */
  shortcut?: string;
  disabled?: boolean;
  /** For a toggle: whether it is on. Menus show a check mark. */
  checked?: boolean;
  /** Where the menu bar lists it; commands without one are palette-only. */
  menu?: MenuName;
  /** Commands of a menu are listed by group, with a separator between groups. */
  group?: number;
  /** The icon the toolbar draws for it, if it is on the toolbar. */
  icon?: LucideIcon;
  /** A longer explanation, for the tooltip. */
  hint?: string;
  /** Runs the command. A command that still needs a node returns a
   * `NodePick`; anything else it returns (a promise, say) is ignored. */
  run: () => unknown;
}

/** The node pick a command's result asks for, if it is one. Async commands
 * return promises, which are truthy, so callers must not test `if (result)`. */
export function pickOf(result: unknown): NodePick | null {
  return typeof result === "object" && result !== null && "nodes" in result && "onPick" in result
    ? (result as NodePick)
    : null;
}

export interface Menu {
  name: MenuName;
  /** The groups of the menu, in order; each is never empty. */
  groups: Command[][];
}

/** The menu bar: every menu in `MENUS` order, commands grouped by `group`
 * and otherwise kept in registry order. Menus with no command are left out. */
export function menusOf(commands: Command[]): Menu[] {
  return MENUS.map((name) => {
    const byGroup = new Map<number, Command[]>();
    for (const c of commands) {
      if (c.menu !== name) continue;
      const g = c.group ?? 0;
      byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
    }
    const groups = [...byGroup.entries()].sort(([a], [b]) => a - b).map(([, cs]) => cs);
    return { name, groups };
  }).filter((m) => m.groups.length > 0);
}

/** The shortcut a key event stands for, in the form commands declare it,
 * or null for a key no command can bind (plain letters, Alt combinations). */
export function comboOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): string | null {
  if (e.altKey) return null;
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (!(e.ctrlKey || e.metaKey) || e.key.length !== 1) return null;
  return `Ctrl+${e.shiftKey ? "Shift+" : ""}${e.key.toUpperCase()}`;
}

/** The tooltip of a toolbar button: its title, hint and shortcut. */
export function tooltipOf(c: Command): string {
  const title = c.title.replace(/…$/, "");
  const head = c.shortcut ? `${title} (${c.shortcut})` : title;
  return c.hint ? `${head}\n${c.hint}` : head;
}

/** The commands with the user's shortcut overrides applied; an empty
 * override removes the shortcut. Commands in `fixed` keep theirs. */
export function withShortcuts(commands: Command[], overrides: Record<string, string>, fixed: ReadonlySet<string>): Command[] {
  return commands.map((c) => {
    if (fixed.has(c.id) || !(c.id in overrides)) return c;
    return { ...c, shortcut: overrides[c.id] || undefined };
  });
}

/** Shortcuts given to more than one command, with those commands' ids. */
export function shortcutClashes(commands: Command[]): Map<string, string[]> {
  const by = new Map<string, string[]>();
  for (const c of commands) if (c.shortcut) by.set(c.shortcut, [...(by.get(c.shortcut) ?? []), c.id]);
  return new Map([...by].filter(([, ids]) => ids.length > 1));
}
