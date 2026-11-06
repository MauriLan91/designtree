// The menu bar (US-15.2), drawn in HTML from the command registry (D9).
// It follows the desktop conventions people already know: click or Alt+letter
// opens a menu, hovering moves between open menus, arrows walk the items,
// Enter runs one and Escape closes.
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { menusOf, type Command } from "../commands";

interface Props {
  commands: Command[];
  /** Whether this editor is the visible tab; only that one takes Alt keys. */
  active: boolean;
  /** Called with what a command returns, for those that pick a node next. */
  onRun: (result: unknown) => void;
}

export function MenuBar({ commands, active: shown, onRun }: Props) {
  const menus = menusOf(commands);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(-1);
  const bar = useRef<HTMLDivElement>(null);
  const items = open === null ? [] : menus[open].groups.flat();

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Alt+letter opens the menu with that initial, as in GTK and Qt apps.
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.key.length !== 1) return;
      if (document.querySelector('[role="dialog"]')) return;
      const i = menus.findIndex((m) => m.name[0].toLowerCase() === e.key.toLowerCase());
      if (i < 0) return;
      e.preventDefault();
      openMenu(i, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (open === null) return;
    bar.current?.querySelector<HTMLElement>(`[data-item="${active}"]`)?.focus();
    if (active < 0) bar.current?.querySelector<HTMLElement>(`[data-menu="${open}"]`)?.focus();
  }, [open, active]);

  /** Opens menu `i`; from the keyboard, with its first enabled item focused. */
  function openMenu(i: number, keyboard = false) {
    setOpen(i);
    setActive(keyboard ? menus[i].groups.flat().findIndex((c) => !c.disabled) : -1);
  }

  const run = (c: Command) => {
    if (c.disabled) return;
    setOpen(null);
    onRun(c.run());
  };

  // Disabled items are skipped by the arrows but stay visible, so people can
  // see that a command exists and why it is greyed out.
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= items.length; n++) {
      const i = (from + dir * n + items.length) % items.length;
      if (!items[i].disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (open === null) return;
    if (e.key === "Escape") setOpen(null);
    else if (e.key === "ArrowDown") setActive((a) => step(a, 1));
    else if (e.key === "ArrowUp") setActive((a) => step(a < 0 ? 0 : a, -1));
    else if (e.key === "ArrowRight") openMenu((open + 1) % menus.length, true);
    else if (e.key === "ArrowLeft") openMenu((open - 1 + menus.length) % menus.length, true);
    else if ((e.key === "Enter" || e.key === " ") && items[active]) run(items[active]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let index = 0;
  return (
    <div className="menubar" role="menubar" aria-label="Menu bar" ref={bar} onKeyDown={onKeyDown}>
      {menus.map((menu, i) => (
        <div className="menu" key={menu.name}>
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            data-menu={i}
            className={open === i ? "open" : undefined}
            onClick={() => (open === i ? setOpen(null) : openMenu(i))}
            onMouseEnter={() => open !== null && open !== i && openMenu(i)}
          >
            <span className="mnemonic">{menu.name[0]}</span>
            {menu.name.slice(1)}
          </button>
          {open === i && (
            <div className="menu-popup" role="menu" aria-label={menu.name}>
              {menu.groups.map((group, g) => (
                <div role="group" key={g}>
                  {g > 0 && <div role="separator" className="menu-sep" />}
                  {group.map((c) => {
                    const at = index++;
                    return (
                      <button
                        key={c.id}
                        role={c.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                        aria-checked={c.checked}
                        aria-disabled={c.disabled || undefined}
                        data-item={at}
                        tabIndex={-1}
                        className={`menu-item${c.disabled ? " disabled" : ""}`}
                        title={c.hint}
                        onMouseEnter={() => setActive(at)}
                        onClick={() => run(c)}
                      >
                        <span className="menu-check">{c.checked && <Check size={14} aria-hidden />}</span>
                        <span className="menu-title">{c.title}</span>
                        {c.shortcut && <kbd className="menu-shortcut">{c.shortcut}</kbd>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
