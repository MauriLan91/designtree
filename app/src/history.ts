// Undo and redo (US-9.1). The history keeps whole snapshots of the editor
// state: edits replace objects instead of changing them, so a snapshot
// shares everything an edit did not touch and costs little to keep.
//
// A snapshot is taken once the state has settled for a moment, so a drag
// or a burst of typing is one step, and only when the content changed:
// selecting or measuring a node is not an edit.
import { useCallback, useEffect, useRef, useState } from "react";

const SETTLE_MS = 300;

export interface History {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Starts a new history at the next state, as when a design is opened. */
  reset: () => void;
}

interface Snapshot<S> {
  state: S;
  key: string;
}

interface Options<S> {
  /** What an edit changes; equal keys are one step. */
  key: (state: S) => string;
  /** Optional cheap check that two states have the same key. */
  same?: (a: S, b: S) => boolean;
  restore: (state: S) => void;
  /** False while the state is mid-gesture (a drag), so no step is taken. */
  settled: (state: S) => boolean;
  limit: number;
}

export function useHistory<S>(state: S, { key, same, restore, settled, limit }: Options<S>): History {
  const past = useRef<Snapshot<S>[]>([]);
  const future = useRef<Snapshot<S>[]>([]);
  const current = useRef<Snapshot<S> | null>(null);
  const latest = useRef(state);
  latest.current = state;
  // The next state is a restore or a new design, not an edit.
  const skip = useRef<"restore" | "reset" | null>("reset");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  const options = useRef({ key, same, restore, settled, limit });
  options.current = { key, same, restore, settled, limit };

  /** Records the latest state as a step if it settled and differs. */
  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { key, same, settled, limit } = options.current;
    const state = latest.current;
    if (!settled(state)) return;
    if (current.current && same?.(current.current.state, state)) {
      // Keep the snapshot taken; only the selection or the like changed.
      return;
    }
    const k = key(state);
    if (current.current && k !== current.current.key) {
      past.current.push(current.current);
      if (past.current.length > limit) past.current.splice(0, past.current.length - limit);
      future.current = [];
      changed();
    }
    current.current = { state, key: k };
  }, []);

  useEffect(() => {
    if (skip.current) {
      const reason = skip.current;
      skip.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (reason === "reset") {
        past.current = [];
        future.current = [];
        changed();
      }
      // A restore differs from its snapshot only in what the key leaves out.
      const restored = reason === "restore" ? current.current : null;
      current.current = { state, key: restored ? restored.key : options.current.key(state) };
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, SETTLE_MS);
  }, [state, commit]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const step = useCallback(
    (from: React.MutableRefObject<Snapshot<S>[]>, to: React.MutableRefObject<Snapshot<S>[]>) => {
      // Not in the middle of a drag: the canvas still moves what it holds.
      if (!options.current.settled(latest.current)) return;
      // An edit still settling is a step of its own, undone first.
      if (timer.current) commit();
      const target = from.current.pop();
      if (target === undefined || !current.current) return;
      to.current.push(current.current);
      skip.current = "restore";
      current.current = target;
      options.current.restore(target.state);
      changed();
    },
    [commit],
  );

  return {
    undo: useCallback(() => step(past, future), [step]),
    redo: useCallback(() => step(future, past), [step]),
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    reset: useCallback(() => {
      skip.current = "reset";
    }, []),
  };
}
