// The handle between the graph and the DTS source in Split mode (US-15.8).
// It stores a ratio rather than a width, so the split keeps its proportions
// when the window or the side panes change size. Dragging follows the
// pointer, the arrow keys move it in 16 px steps, a double click evens it.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_LAYOUT, SPLIT_MIN, clampSplit } from "../layout";

interface Props {
  /** The graph's share of the container's width. */
  ratio: number;
  onRatio: (ratio: number) => void;
}

const STEP = 16;

export function SplitHandle({ ratio, onRatio }: Props) {
  const box = useRef<DOMRect | null>(null);

  /** The ratio for a graph `width` px wide, kept clear of both minimums. */
  const ratioFor = (width: number, total: number) => {
    const room = Math.max(total - 2 * SPLIT_MIN, 0);
    const graph = Math.min(Math.max(width, SPLIT_MIN), SPLIT_MIN + room);
    return clampSplit(total > 0 ? graph / total : DEFAULT_LAYOUT.split);
  };
  const container = (el: HTMLElement) => el.parentElement!.getBoundingClientRect();

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    box.current = container(e.currentTarget);
    document.body.classList.add("resizing-x");
  };
  const onPointerMove = (e: PointerEvent) => {
    const rect = box.current;
    if (rect) onRatio(ratioFor(e.clientX - rect.left, rect.width));
  };
  const end = () => {
    box.current = null;
    document.body.classList.remove("resizing-x");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? STEP : e.key === "ArrowLeft" ? -STEP : 0;
    if (!step) return;
    e.preventDefault();
    const { width } = container(e.currentTarget);
    onRatio(ratioFor(ratio * width + step, width));
  };

  return (
    <div
      className="splitter splitter-split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Graph and source split"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={10}
      aria-valuemax={90}
      aria-valuetext={`Graph ${Math.round(ratio * 100)}%`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onRatio(DEFAULT_LAYOUT.split)}
      onKeyDown={onKeyDown}
      title="Drag to resize, double-click for an even split"
    />
  );
}
