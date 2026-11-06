// The bottom panel (US-15.3): problems, build output, interrupt tree and
// address map in tabs under the canvas, where long lists have the room the
// side panel lacked.
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { PanelTab } from "../layout";
import { Splitter } from "./Splitter";

export interface PanelTabInfo {
  id: PanelTab;
  title: string;
  /** Shown as a badge when set and not zero. */
  count?: number;
}

interface Props {
  tabs: PanelTabInfo[];
  tab: PanelTab;
  size: number;
  onTab: (tab: PanelTab) => void;
  onResize: (size: number) => void;
  onClose: () => void;
  children: ReactNode;
}

export function BottomPanel({ tabs, tab, size, onTab, onResize, onClose, children }: Props) {
  return (
    <section className="pane bottom-pane" aria-label="Bottom panel">
      <Splitter pane="panel" size={size} label="Bottom panel height" onResize={onResize} />
      <div className="panel-tabs" role="tablist" aria-label="Panel views">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? "panel-tab active" : "panel-tab"}
            onClick={() => onTab(t.id)}
          >
            {t.title}
            {!!t.count && <span className="badge">{t.count}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button className="pane-toggle" onClick={onClose} aria-label="Hide the panel (Ctrl+J)" title="Hide the panel (Ctrl+J)">
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <div className="panel panel-body" role="tabpanel">
        {children}
      </div>
    </section>
  );
}
