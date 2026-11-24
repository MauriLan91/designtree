// Long lists draw only the rows in view (US-11.3): the Outline, the problem
// list. Rows have one fixed height, so the rows in view follow from the
// scroll position alone, and the space of the others is padding.
import { useEffect, useState, type RefObject } from "react";

export interface RowRange {
  start: number;
  end: number;
}

/** Rows drawn beyond each edge of the view, so a quick scroll shows no gap. */
const OVERSCAN = 12;

/**
 * The rows of a list of `count` rows of `rowHeight` pixels to draw, when the
 * list starts `offset` pixels into a scroller scrolled to `scrollTop` and
 * `viewHeight` high.
 */
export function visibleRange(scrollTop: number, viewHeight: number, offset: number, count: number, rowHeight: number): RowRange {
  const top = scrollTop - offset;
  const start = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
  const end = Math.min(count, Math.max(0, Math.ceil((top + viewHeight) / rowHeight) + OVERSCAN));
  return { start: Math.min(start, end), end };
}

/** The list's scrolling ancestor, matched by `selector`. */
const scrollerOf = (list: HTMLElement | null, selector: string) => list?.closest<HTMLElement>(selector) ?? null;

/** Where the list starts inside its scroller's content. */
const offsetIn = (list: HTMLElement, scroller: HTMLElement) =>
  list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

/** The rows of the list in `ref` that are in view of its scroller. */
export function useVisibleRows(ref: RefObject<HTMLElement | null>, scrollerSelector: string, count: number, rowHeight: number): RowRange {
  const [range, setRange] = useState<RowRange>(() => ({ start: 0, end: Math.min(count, 60) }));
  useEffect(() => {
    const list = ref.current;
    const scroller = scrollerOf(list, scrollerSelector);
    if (!list || !scroller) {
      setRange({ start: 0, end: count });
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = visibleRange(scroller.scrollTop, scroller.clientHeight, offsetIn(list, scroller), count, rowHeight);
        setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
      });
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, [ref, scrollerSelector, count, rowHeight]);
  return { start: Math.min(range.start, count), end: Math.min(range.end, count) };
}

/** Scrolls row `index` of the list into view, as little as needed. */
export function scrollRowIntoView(list: HTMLElement | null, scrollerSelector: string, index: number, rowHeight: number) {
  const scroller = scrollerOf(list, scrollerSelector);
  if (!list || !scroller) return;
  const top = offsetIn(list, scroller) + index * rowHeight;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + rowHeight - scroller.clientHeight;
}
