import type { Problem } from "../model";

/** The schema check of the design, kept up to date while editing; its
 * problems are listed in the Problems tab (US-5.3). */
export interface SchemaState {
  /** A check is running; the problems are from the previous one. */
  checking: boolean;
  /** Null when the design cannot be compiled, so it was not checked. */
  problems: Problem[] | null;
}
