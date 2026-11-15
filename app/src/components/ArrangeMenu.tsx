// The Arrange button of the toolbar (US-9.8): the Arrange menu's commands
// in a drop-down with their icons, so a layout is one click away from the
// canvas. Keys as in the menu bar: arrows walk, Enter runs, Escape closes.
import { ChevronDown, LayoutTemplate } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { menusOf, tooltipOf, type Command } from "../commands";

interface Props {
  commands: Command[];
}

export function ArrangeMenu({ commands }: Props) {
  const groups = menusOf(commands).find((m) => m.name === "Arrange")?.groups ?? [];
  const items = groups.flat();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) root.current?.querySelector<HTMLElement>(`[data-item="${active}"]`)?.focus();
  }, [open, active]);

  const close = () => {
    setOpen(false);
    root.current?.querySelector<HTMLElement>(".arrange-button")?.focus();
  };
  const run = (c: Command) => {
    if (c.disabled) return;
    close();
    c.run();
  };
  const step = (from: number, dir: 1 | -1) => {
    for (let n = 1; n <= items.length; n++) {
      const i = (from + dir * n + items.length) % items.length;
      if (!items[i].disabled) return i;
    }
    return from;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key !== "ArrowDown") return;
      setOpen(true);
      setActive(step(-1, 1));
    } else if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") setActive((a) => step(a, 1));
    else if (e.key === "ArrowUp") setActive((a) => step(a < 0 ? 0 : a, -1));
    else if ((e.key === "Enter" || e.key === " ") && items[active]) run(items[active]);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let index = 0;
  return (
    <div className="arrange-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        className="tool arrange-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Arrange"
        title="Arrange the selection, or the whole scope"
        onClick={() => {
          setOpen((o) => !o);
          setActive(-1);
        }}
      >
        <LayoutTemplate size={18} strokeWidth={1.75} aria-hidden />
        <ChevronDown size={12} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div className="menu-popup" role="menu" aria-label="Arrange">
          {groups.map((group, g) => (
            <div role="group" key={g}>
              {g > 0 && <div role="separator" className="menu-sep" />}
              {group.map((c) => {
                const at = index++;
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    role="menuitem"
                    aria-disabled={c.disabled || undefined}
                    data-item={at}
                    tabIndex={-1}
                    className={`menu-item${c.disabled ? " disabled" : ""}`}
                    title={tooltipOf(c)}
                    onMouseEnter={() => setActive(at)}
                    onClick={() => run(c)}
                  >
                    <span className="menu-check">{Icon && <Icon size={14} strokeWidth={1.75} aria-hidden />}</span>
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
  );
}
