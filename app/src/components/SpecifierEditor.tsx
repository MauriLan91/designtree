import { useEffect, useRef, useState } from "react";
import { backend, inTauri } from "../backend";
import type { DtMacro } from "../model";

interface Props {
  args: number[];
  /** Cells the provider expects, when its `#...-cells` property says. */
  expected?: number;
  onChange: (args: number[]) => void;
}

/** Number tokens as written in DTS: decimal or 0x hex. */
function parseNumber(token: string): number | undefined {
  const n = /^(0x[0-9a-f]+|\d+)$/i.test(token) ? Number(token) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : undefined;
}

export function formatCell(n: number): string {
  return n < 10 ? String(n) : `0x${n.toString(16)}`;
}

/**
 * Turns the text into cells: numbers, or `dt-bindings` constants by name
 * (`GPIO_ACTIVE_LOW`), optionally joined with `|` (`GPIO_ACTIVE_LOW | GPIO_OPEN_DRAIN`).
 */
async function parseSpecifier(text: string): Promise<number[]> {
  const tokens = text.replace(/\|/g, " | ").split(/[\s,]+/).filter(Boolean);
  const names = [...new Set(tokens.filter((t) => t !== "|" && parseNumber(t) === undefined))];
  const resolved = new Map<string, number>();
  if (names.length > 0) {
    if (!inTauri) throw new Error(`unknown name ${names[0]}`);
    const values = await backend.resolveDtMacros(names);
    names.forEach((name, i) => {
      const value = values[i];
      if (value === null || value === undefined) {
        throw new Error(`unknown name ${name}; load the kernel bindings to use dt-bindings names`);
      }
      resolved.set(name, value);
    });
  }
  const value = (t: string) => parseNumber(t) ?? (resolved.get(t) as number);
  const cells: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "|") {
      if (cells.length === 0 || i + 1 >= tokens.length || tokens[i + 1] === "|") throw new Error("misplaced |");
      cells[cells.length - 1] = (cells[cells.length - 1] | value(tokens[i + 1])) >>> 0;
      i++;
    } else {
      cells.push(value(tokens[i]));
    }
  }
  return cells;
}

export function SpecifierEditor({ args, expected, onChange }: Props) {
  const shown = args.map(formatCell).join(" ");
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DtMacro[]>([]);
  useEffect(() => setText(shown), [shown]);
  // Searches finish out of order; only the latest one may set the suggestions.
  const latest = useRef(0);

  const commit = async (value: string) => {
    latest.current++;
    setSuggestions([]);
    try {
      onChange(await parseSpecifier(value));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const edit = (value: string) => {
    setText(value);
    const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(value)?.[0];
    const request = ++latest.current;
    if (!inTauri || !word || word.length < 2) {
      setSuggestions([]);
      return;
    }
    backend.searchDtMacros(word).then(
      (found) => request === latest.current && setSuggestions(found),
      () => request === latest.current && setSuggestions([]),
    );
  };

  const pick = (macro: DtMacro) => {
    setText(text.replace(/[A-Za-z_][A-Za-z0-9_]*$/, macro.name) + " ");
    setSuggestions([]);
  };

  const count = args.length;
  const mismatch = expected !== undefined && count !== expected;
  return (
    <>
      <label>
        Specifier cells{expected !== undefined ? ` (provider expects ${expected})` : ""}
        <input
          value={text}
          placeholder="e.g. 17 GPIO_ACTIVE_LOW"
          onChange={(e) => edit(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => e.key === "Enter" && commit(text)}
        />
      </label>
      {suggestions.length > 0 && (
        <ul className="macro-suggestions">
          {suggestions.map((m) => (
            <li key={`${m.header}:${m.name}`}>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} title={m.header}>
                <code>{m.name}</code> <span>{formatCell(m.value)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {!error && mismatch && (
        <p className="error">
          {count} cell{count === 1 ? "" : "s"} given, the provider expects {expected}
        </p>
      )}
    </>
  );
}
