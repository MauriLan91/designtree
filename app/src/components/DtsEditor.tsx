import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { dts, dtsHighlight } from "./dtsLanguage";

export interface Span {
  node: string;
  first_line: number;
  last_line: number;
}

export interface SourceError {
  /** The included file the error is in; null for the edited text. */
  file?: string | null;
  line: number;
  column: number;
  message: string;
}

interface Props {
  /** Text to show; replaces the editor's whenever `version` changes. */
  value: string;
  version: number;
  spans: Span[];
  /** Nodes selected on the canvas, whose blocks are highlighted. */
  selected: string[];
  readOnly: boolean;
  error: SourceError | null;
  onEdit: (text: string) => void;
  /** The node whose block holds the cursor, after the user moved it. */
  onCursorNode: (node: string | null) => void;
}

const setMarks = StateEffect.define<{ selected: [number, number][]; error: number | null }>();
const selectedLine = Decoration.line({ class: "cm-node-selected" });
const errorLine = Decoration.line({ class: "cm-error-line" });

const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue;
      const doc = tr.state.doc;
      const lines = new Map<number, Decoration>();
      for (const [first, last] of effect.value.selected) {
        for (let l = Math.max(1, first); l <= Math.min(last, doc.lines); l++) lines.set(l, selectedLine);
      }
      const e = effect.value.error;
      if (e !== null && e >= 1 && e <= doc.lines) lines.set(e, errorLine);
      const builder = new RangeSetBuilder<Decoration>();
      [...lines.keys()].sort((a, b) => a - b).forEach((l) => {
        const at = doc.line(l).from;
        builder.add(at, at, lines.get(l)!);
      });
      return builder.finish();
    }
    return tr.docChanged ? set.map(tr.changes) : set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The innermost block that contains `line`. */
function nodeAt(spans: Span[], line: number): string | null {
  let best: Span | null = null;
  for (const s of spans) {
    if (s.first_line <= line && line <= s.last_line && (!best || s.last_line - s.first_line < best.last_line - best.first_line)) {
      best = s;
    }
  }
  return best?.node ?? null;
}

/** DTS source editor kept in step with the canvas (US-10.1). */
export function DtsEditor({ value, version, spans, selected, readOnly, error, onEdit, onCursorNode }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const readOnlyConf = useRef(new Compartment());
  // The listener is created once; it reads the latest props through refs.
  const latest = useRef({ spans, readOnly, onEdit, onCursorNode });
  latest.current = { spans, readOnly, onEdit, onCursorNode };
  /** Typed since the spans were last updated, so they may be off. */
  const dirty = useRef(false);

  const makeState = (doc: string) => {
    const cursorLine = { line: 0 };
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        indentUnit.of("\t"),
        EditorState.tabSize.of(4),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        highlightSelectionMatches(),
        dts,
        dtsHighlight,
        marks,
        readOnlyConf.current.of(EditorState.readOnly.of(latest.current.readOnly)),
        EditorView.updateListener.of((update) => {
          // Callbacks run after the update: React may render, and dispatch
          // to this view, at once, which CodeMirror refuses mid-update.
          if (update.docChanged) {
            dirty.current = true;
            const text = update.state.doc.toString();
            setTimeout(() => latest.current.onEdit(text));
          }
          const moved = update.transactions.some((tr) => tr.isUserEvent("select"));
          if (update.selectionSet && moved && !dirty.current) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
            if (line !== cursorLine.line) {
              cursorLine.line = line;
              const node = nodeAt(latest.current.spans, line);
              setTimeout(() => latest.current.onCursorNode(node));
            }
          }
        }),
      ],
    });
  };

  // Highlight the selected nodes' blocks and the error line; bring the
  // first block into view unless the user is working in the editor.
  const showMarks = () => {
    const v = view.current;
    if (!v) return;
    const wanted = new Set(selected);
    const ranges = spans.filter((s) => wanted.has(s.node)).map((s) => [s.first_line, s.last_line] as [number, number]);
    const errorLine = error && !error.file ? error.line : null;
    const effects: StateEffect<unknown>[] = [setMarks.of({ selected: ranges, error: errorLine })];
    if (ranges.length && !v.hasFocus && ranges[0][0] <= v.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(v.state.doc.line(ranges[0][0]).from, { y: "start", yMargin: 24 }));
    }
    v.dispatch({ effects });
  };

  useEffect(() => {
    const v = new EditorView({ parent: host.current!, state: makeState(value) });
    view.current = v;
    return () => v.destroy();
    // Created once; later values arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text set from outside starts over: a fresh state, so undo cannot replay
  // edits of the previous text into this one. Typed text never comes back
  // through `value`: it would arrive late and undo the keystrokes since.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    const scroll = v.scrollDOM.scrollTop;
    v.setState(makeState(value));
    v.scrollDOM.scrollTop = scroll;
    dirty.current = false;
    showMarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyConf.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  useEffect(() => {
    dirty.current = false;
  }, [spans]);

  // Keyed on the selection, not on the array identity.
  const selectedKey = selected.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(showMarks, [selectedKey, spans, error]);

  return <div className="dts-editor" ref={host} />;
}
