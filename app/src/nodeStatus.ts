// Whether a node is enabled (US-16.7). The devicetree spec makes a node
// without `status`, or with "okay" (or the older "ok"), operational; any
// other value ("disabled", "reserved", "fail", ...) keeps the kernel from
// probing it.
import type { Property } from "./model.gen";

/** The node's `status` string, when it has one. */
export function statusOf(properties: Property[]): string | undefined {
  const p = properties.find((q) => q.name === "status");
  if (!p) return undefined;
  if (p.value.type === "strings") return p.value.value[0];
  if (p.value.type === "mixed") {
    const s = p.value.value.find((c) => c.type === "string");
    return s && s.type === "string" ? s.value : undefined;
  }
  return undefined;
}

export function isDisabled(properties: Property[]): boolean {
  const status = statusOf(properties);
  return status !== undefined && status !== "okay" && status !== "ok";
}
