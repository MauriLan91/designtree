// The command palette (US-9.3): every toolbar action, adding a library
// element, and connecting or moving the selected node, from the keyboard.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { backend } from "../backend";
import type { Binding } from "../model";

export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  disabled?: boolean;
  /** Runs the command, or returns the node it still needs. */
  run: () => void | NodePick;
}

/** A second step that picks a node, as for "Connect to…". */
export interface NodePick {
  title: string;
  nodes: { id: string; title: string }[];
  onPick: (id: string) => void;
}

interface Item {
  key: string;
  title: string;
  hint?: string;
  run: () => void | NodePick;
}

interface Props {
  commands: Command[];
  /** Search the element library; false while no kernel is loaded. */
  library: boolean;
  onAdd: (binding: Binding) => void;
  onClose: () => void;
}

const MAX = 50;

export function CommandPalette({ commands, library, onAdd, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<NodePick | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => input.current?.focus(), [pick]);

  useEffect(() => {
    const q = query.trim();
    if (!library || pick || q.length < 2) {
      setBindings([]);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      backend.searchBindings(q, null, 8).then(
        (found) => !stale && setBindings(found),
        () => !stale && setBindings([]),
      );
    }, 150);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, library, pick]);

  const items: Item[] = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    if (pick) {
      return pick.nodes
        .filter((n) => matches(n.title))
        .slice(0, MAX)
        .map((n) => ({ key: n.id, title: n.title, run: () => pick.onPick(n.id) }));
    }
    const found = commands
      .filter((c) => !c.disabled && matches(c.title))
      .map((c) => ({ key: c.id, title: c.title, hint: c.shortcut, run: c.run }));
    const adds = bindings.map((b) => ({
      key: `add:${b.path}`,
      title: `Add ${b.title}`,
      hint: b.compatibles?.[0],
      run: () => onAdd(b),
    }));
    return [...found, ...adds].slice(0, MAX);
  }, [query, pick, commands, bindings, onAdd]);

  useEffect(() => setActive(0), [query, pick]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    const next = item.run();
    // A command that asks for a node keeps the palette open on that step.
    if (next) {
      setPick(next);
      setQuery("");
      return;
    }
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, items.length - 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
    else if (e.key === "Enter") choose(items[active]);
    else if (e.key === "Escape") {
      if (pick) {
        setPick(null);
        setQuery("");
      } else onClose();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="modal-backdrop command-backdrop" onClick={onClose}>
      <div className="modal command-palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={pick ? pick.title : library ? "Command, or an element to add" : "Command"}
          aria-label="Command"
        />
        <ul ref={list} role="listbox">
          {items.map((item, i) => (
            <li
              key={item.key}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
            >
              <span>{item.title}</span>
              {item.hint && <span className="command-hint">{item.hint}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="hint">Nothing matches</li>}
        </ul>
      </div>
    </div>
  );
}

/** The keyboard shortcuts, for the help sheet. */
export function ShortcutSheet({ shortcuts, onClose }: { shortcuts: [string, string][]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="shortcuts">
          <tbody>
            {shortcuts.map(([keys, what]) => (
              <tr key={keys}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
