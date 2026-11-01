import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  /** The text, once typing pauses, on Enter and on blur. */
  onCommit: (value: string) => void;
}

/**
 * Text field that keeps keystrokes to itself and commits once typing
 * pauses: every commit updates the whole design, which on a board with a
 * thousand nodes takes longer than a keystroke (US-11.2).
 */
export function TextInput({ value, onCommit, onBlur, onKeyDown, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ onCommit, value });
  latest.current = { onCommit, value };
  /** Typed and not committed yet. */
  const pending = useRef<string | null>(null);

  // Back to showing `value`, so the field follows changes made elsewhere.
  const commit = (text: string) => {
    clearTimeout(timer.current);
    pending.current = null;
    if (text !== latest.current.value) latest.current.onCommit(text);
    setDraft(null);
  };
  // A field that goes away (another node selected) keeps what was typed.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null && pending.current !== latest.current.value) {
        latest.current.onCommit(pending.current);
      }
    },
    [],
  );

  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        pending.current = text;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(text), 300);
      }}
      onBlur={(e) => {
        if (draft !== null) commit(draft);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && draft !== null) commit(draft);
        onKeyDown?.(e);
      }}
    />
  );
}
