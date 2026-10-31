import { DtsEditor, type SourceError, type Span } from "./DtsEditor";

interface Props {
  /** Source the editor shows: generated from the canvas, or as typed. */
  text: string;
  /** Changes whenever `text` is set from outside the editor. */
  textVersion: number;
  spans: Span[];
  selected: string[];
  /** For an overlay: its base with the overlay applied. */
  appliedDts?: string | null;
  overlayBase?: string;
  showApplied: boolean;
  onShowApplied: (applied: boolean) => void;
  /** Why the design cannot be written as DTS. */
  errors: string[];
  sourceError: SourceError | null;
  onEdit: (text: string) => void;
  onCursorNode: (node: string | null) => void;
}

export function DtsPreview(props: Props) {
  const { appliedDts, overlayBase, errors, sourceError } = props;
  const showApplied = props.showApplied && !!appliedDts;
  const overlay = overlayBase !== undefined;
  return (
    <section className="preview">
      <h2>DTS source</h2>
      {overlay && (
        <div className="preview-mode" role="group" aria-label="Preview">
          <span className="hint">Overlay on {overlayBase}</span>
          <button aria-pressed={!showApplied} onClick={() => props.onShowApplied(false)}>
            Overlay
          </button>
          <button aria-pressed={showApplied} onClick={() => props.onShowApplied(true)} disabled={!appliedDts}>
            Applied
          </button>
        </div>
      )}
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <DtsEditor
        value={showApplied ? appliedDts! : props.text}
        // The applied tree and the source are different texts.
        version={showApplied ? -props.textVersion - 1 : props.textVersion}
        spans={showApplied ? [] : props.spans}
        selected={props.selected}
        // Overlays are edited on the canvas, and the applied tree is a view.
        // While the design cannot be written, the text is out of date.
        readOnly={overlay || errors.length > 0}
        error={showApplied ? null : sourceError}
        onEdit={props.onEdit}
        onCursorNode={props.onCursorNode}
      />
      {sourceError && !showApplied && (
        <p className="source-error">
          {sourceError.file ? `${sourceError.file}, line ${sourceError.line}` : `Line ${sourceError.line}`}:{" "}
          {sourceError.message}
        </p>
      )}
    </section>
  );
}
