// One look per severity (US-5.6), the same in the status bar, the problem
// lists, the node badges and the Outline: a round mark for an error, a
// triangle for a warning, so that the two differ without colour too.
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { Severity } from "../model";

export const SEVERITY_TITLES: Record<Severity, string> = { error: "Error", warning: "Warning" };

export function SeverityIcon({ severity, size = 12 }: { severity: Severity; size?: number }) {
  const Icon = severity === "error" ? CircleAlert : TriangleAlert;
  return <Icon className={`severity-icon ${severity}`} size={size} strokeWidth={2.25} aria-hidden />;
}
