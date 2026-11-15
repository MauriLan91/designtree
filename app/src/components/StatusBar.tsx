// The status bar (US-15.3): what the build depends on (kernel, dtc) and how
// many problems the design has, each a button to where it is fixed.
import { CircleAlert, PanelBottom, TriangleAlert } from "lucide-react";
import type { Kernel } from "../App";
import { tooltipOf, type Command } from "../commands";

interface Props {
  kernel: Kernel | null;
  /** undefined while unknown (or outside the app), null when dtc cannot be run. */
  dtcVersion: string | null | undefined;
  errors: number;
  warnings: number;
  nodes: number;
  selected: number;
  onKernels: () => void;
  onDtc: () => void;
  onProblems: () => void;
  /** The command that opens and closes the bottom panel (US-15.7). */
  panel: Command;
}

export function StatusBar({ kernel, dtcVersion, errors, warnings, nodes, selected, onKernels, onDtc, onProblems, panel }: Props) {
  return (
    <footer className="statusbar">
      <button
        className={panel.checked ? "panel-toggle on" : "panel-toggle"}
        onClick={() => panel.run()}
        aria-label={panel.title}
        aria-pressed={!!panel.checked}
        title={tooltipOf(panel)}
      >
        <PanelBottom size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <button onClick={onKernels} title="Kernel checkouts">
        <span className={kernel ? "dot ok" : "dot"} aria-hidden />
        {kernel ? `Linux ${kernel.version ?? "(unknown version)"}` : "No kernel loaded"}
      </button>
      {dtcVersion !== undefined && (
        <button onClick={onDtc} className={dtcVersion ? undefined : "bad"} title="Set the dtc path">
          {dtcVersion ? `dtc ${dtcVersion}` : "dtc not found"}
        </button>
      )}
      <button onClick={onProblems} title="Show the problems (Ctrl+Shift+M)" aria-label={`${errors} errors, ${warnings} warnings`}>
        <span className={errors ? "count bad" : "count"}>
          <CircleAlert size={12} strokeWidth={2.25} aria-hidden />
          {errors}
        </span>
        <span className={warnings ? "count warn" : "count"}>
          <TriangleAlert size={12} strokeWidth={2.25} aria-hidden />
          {warnings}
        </span>
      </button>
      <span className="spacer" />
      <span>
        {nodes} node{nodes === 1 ? "" : "s"}
        {selected > 0 && ` · ${selected} selected`}
      </span>
    </footer>
  );
}
