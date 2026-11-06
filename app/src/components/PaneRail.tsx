// The collapse control of a side pane (US-15.3): a button in the pane's
// corner while it is open, and a narrow rail with an expand button while it
// is collapsed, so a hidden pane always shows how to get it back.
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { Layout } from "../layout";

interface Props {
  pane: "library" | "inspector";
  layout: Layout;
  onLayout: (change: (l: Layout) => Layout) => void;
}

export const PANE_TITLES = { library: "Library", inspector: "Inspector" } as const;
export const PANE_SHORTCUTS = { library: "Ctrl+Shift+L", inspector: "Ctrl+Shift+I" } as const;

export function PaneRail({ pane, layout, onLayout }: Props) {
  const open = layout[pane].open;
  const toggle = () => onLayout((l) => ({ ...l, [pane]: { ...l[pane], open: !open } }));
  const left = pane === "library";
  const Icon = open ? (left ? PanelLeftClose : PanelRightClose) : left ? PanelLeftOpen : PanelRightOpen;
  const label = `${open ? "Hide" : "Show"} the ${PANE_TITLES[pane].toLowerCase()} (${PANE_SHORTCUTS[pane]})`;
  const button = (
    <button className="pane-toggle" onClick={toggle} aria-label={label} title={label} aria-expanded={open}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
  return open ? (
    <div className={`pane-corner pane-corner-${pane}`}>{button}</div>
  ) : (
    <div className="pane-rail">
      {button}
      <span className="pane-rail-title">{PANE_TITLES[pane]}</span>
    </div>
  );
}
