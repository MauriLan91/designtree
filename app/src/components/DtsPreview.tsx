interface Props {
  dts: string | null;
  errors: string[];
}

export function DtsPreview({ dts, errors }: Props) {
  return (
    <section className="preview">
      <h2>DTS preview</h2>
      {errors.length > 0 ? (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : (
        <pre>{dts}</pre>
      )}
    </section>
  );
}
