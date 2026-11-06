// The scope tabs and breadcrumb of the canvas (US-16.1, D7). The main
// canvas is always the first tab; each opened node gets one, and the
// breadcrumb shows where the active scope sits in the tree. Its last item is
// the scope's own node, which the canvas does not draw: clicking it edits it.
import { ChevronRight, X } from "lucide-react";

export interface ScopeTab {
  /** null for the main canvas. */
  id: string | null;
  title: string;
  /** Shown to follow the DTS cursor or a problem; the next such scope replaces it. */
  passing?: boolean;
}

interface Props {
  tabs: ScopeTab[];
  active: string | null;
  /** From the main scope down to the active one. */
  path: ScopeTab[];
  onOpen: (id: string | null) => void;
  /** Selects the active scope's own node, to edit it in the inspector. */
  onSelectScope: () => void;
  onClose: (id: string) => void;
}

export function ScopeBar({ tabs, active, path, onOpen, onSelectScope, onClose }: Props) {
  return (
    <nav className="scope-bar" aria-label="Scopes">
      <div className="scope-tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.id ?? ""}
            role="tab"
            aria-selected={t.id === active}
            className={`scope-tab${t.id === active ? " active" : ""}${t.passing ? " passing" : ""}`}
          >
            <button onClick={() => onOpen(t.id)} title={t.id === null ? "The main canvas" : `Children of ${t.title}`}>
              {t.title}
            </button>
            {t.id !== null && !t.passing && (
              <button className="scope-close" aria-label={`Close ${t.title}`} onClick={() => onClose(t.id!)}>
                <X size={12} strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      {path.length > 0 && (
        <ol className="breadcrumb">
          {path.map((p, i) => (
            <li key={p.id ?? ""}>
              {i > 0 && <ChevronRight size={12} aria-hidden />}
              {i < path.length - 1 ? (
                <button className="link" onClick={() => onOpen(p.id)}>
                  {p.title}
                </button>
              ) : (
                <button className="link current" aria-current="location" onClick={onSelectScope} title="Edit this node in the inspector">
                  {p.title}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}
