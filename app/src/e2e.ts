// The end-to-end suite's way in (US-4.5). Only a build made with
// VITE_E2E=1 has it: the suite reads the command registry and the design
// through it, and answers the file dialogs, which WebDriver cannot reach.
// Everything else the suite does through the window, as a user would.
import type { Command } from "./commands";
import type { Design } from "./model";

export const E2E = import.meta.env.VITE_E2E === "1";

/** Answers for the next file dialogs, in order; null is a cancel. */
const answers: (string | null)[] = [];

/** The next scripted answer, or `real()` when none is queued. */
export function scripted<T>(real: () => Promise<T>): Promise<T> {
  return E2E && answers.length ? Promise.resolve(answers.shift() as T) : real();
}

export interface E2eEditor {
  commands: () => Command[];
  /** Shortcuts outside the registry, as the shortcut sheet lists them. */
  otherShortcuts: () => [string, string][];
  design: () => Design;
  scope: () => string | null;
}

let editor: E2eEditor | null = null;

/** The active editor registers itself; the hook reads the latest one. */
export function registerEditor(e: E2eEditor | null) {
  editor = e;
}

if (E2E) {
  (window as unknown as { __designtree: unknown }).__designtree = {
    answer: (...paths: (string | null)[]) => answers.push(...paths),
    pending: () => answers.length,
    commands: () =>
      (editor?.commands() ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        menu: c.menu ?? null,
        shortcut: c.shortcut ?? null,
        toolbar: !!c.icon,
        disabled: !!c.disabled,
        checked: c.checked ?? null,
      })),
    otherShortcuts: () => editor?.otherShortcuts() ?? [],
    design: () => editor?.design() ?? null,
    scope: () => editor?.scope() ?? null,
  };
}
