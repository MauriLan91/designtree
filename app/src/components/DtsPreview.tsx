interface Props {
  dts: string | null;
  /** For an overlay: its base with the overlay applied. */
  appliedDts?: string | null;
  overlayBase?: string;
  showApplied: boolean;
  onShowApplied: (applied: boolean) => void;
  errors: string[];
}

export function DtsPreview({ dts, appliedDts, overlayBase, showApplied: wanted, onShowApplied, errors }: Props) {
  const showApplied = wanted && !!appliedDts;
  return (
    <section className="preview">
      <h2>DTS preview</h2>
      {overlayBase !== undefined && (
        <div className="preview-mode" role="group" aria-label="Preview">
          <span className="hint">Overlay on {overlayBase}</span>
          <button aria-pressed={!showApplied} onClick={() => onShowApplied(false)}>
            Overlay
          </button>
          <button aria-pressed={showApplied} onClick={() => onShowApplied(true)} disabled={!appliedDts}>
            Applied
          </button>
        </div>
      )}
      {errors.length > 0 ? (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : (
        <pre>{showApplied ? appliedDts : dts}</pre>
      )}
    </section>
  );
}
