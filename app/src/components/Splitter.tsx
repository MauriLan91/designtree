// The handle on a pane's inner edge that resizes it (US-15.3). Dragging
// follows the pointer; the arrow keys move it in 16 px steps when focused;
// a double click puts the pane back to its default size.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_LAYOUT, LIMITS, clampSize, type PaneName } from "../layout";

interface Props {
  pane: PaneName;
  size: number;
  /** Called with the new, already clamped size. */
  onResize: (size: number) => void;
  label: string;
}

const STEP = 16;

/** Which way the pointer grows the pane: the library grows to the right,
 * the inspector to the left, the bottom panel upwards. */
const GROWS: Record<PaneName, { axis: "x" | "y"; sign: 1 | -1 }> = {
  library: { axis: "x", sign: 1 },
  inspector: { axis: "x", sign: -1 },
  panel: { axis: "y", sign: -1 },
};

export function Splitter({ pane, size, onResize, label }: Props) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const { axis, sign } = GROWS[pane];
  const at = (e: PointerEvent) => (axis === "x" ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: at(e), size };
    document.body.classList.add(axis === "x" ? "resizing-x" : "resizing-y");
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    onResize(clampSize(pane, drag.current.size + sign * (at(e) - drag.current.start)));
  };
  const end = () => {
    drag.current = null;
    document.body.classList.remove("resizing-x", "resizing-y");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The arrow that points away from the pane grows it.
    const grow = axis === "x" ? (sign > 0 ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
    const shrink = axis === "x" ? (sign > 0 ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
    if (e.key === grow) onResize(clampSize(pane, size + STEP));
    else if (e.key === shrink) onResize(clampSize(pane, size - STEP));
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={`splitter splitter-${pane}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={LIMITS[pane].min}
      aria-valuemax={LIMITS[pane].max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(DEFAULT_LAYOUT[pane].size)}
      onKeyDown={onKeyDown}
      title="Drag to resize, double-click for the default size"
    />
  );
}
