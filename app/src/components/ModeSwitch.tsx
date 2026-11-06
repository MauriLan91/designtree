// Graph / Split / DTS for the tab (US-15.4), as in Qt Design Studio's
// Design / Code / Split: one segmented control, always in the same corner,
// with the shortcut in each tooltip.
import { Code, Columns2, Workflow } from "lucide-react";
import type { EditorMode } from "../layout";

const MODES: { mode: EditorMode; title: string; shortcut: string; Icon: typeof Code }[] = [
  { mode: "graph", title: "Graph", shortcut: "Ctrl+1", Icon: Workflow },
  { mode: "split", title: "Split", shortcut: "Ctrl+2", Icon: Columns2 },
  { mode: "dts", title: "DTS", shortcut: "Ctrl+3", Icon: Code },
];

export function ModeSwitch({ mode, onMode }: { mode: EditorMode; onMode: (mode: EditorMode) => void }) {
  return (
    <div className="mode-switch" role="group" aria-label="Editor mode">
      {MODES.map(({ mode: m, title, shortcut, Icon }) => (
        <button key={m} aria-pressed={mode === m} title={`${title} (${shortcut})`} onClick={() => onMode(m)}>
          <Icon size={14} strokeWidth={1.75} aria-hidden />
          {title}
        </button>
      ))}
    </div>
  );
}
