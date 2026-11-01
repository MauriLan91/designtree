// Typed wiring (US-6.1): a node's phandle properties become named consumer
// ports, its `#*-cells` properties named provider ports, and a reference may
// only join a consumer to a provider of the same kind.
import type { Binding, DtNodeData } from "./model";

/** Handle id of the consumer port that writes `property`. */
export const consumerHandle = (property: string) => `use:${property}`;
/** Handle id of the provider port with this `#*-cells` property. */
export const providerHandle = (cells: string) => `provide:${cells}`;

export function handleProperty(handle: string | null | undefined): string | undefined {
  return handle?.startsWith("use:") ? handle.slice(4) : undefined;
}

export function handleCells(handle: string | null | undefined): string | undefined {
  return handle?.startsWith("provide:") ? handle.slice(8) : undefined;
}

/** Phandle lists whose provider property does not follow `foos` / `#foo-cells` (from dt-schema). */
const SPECIAL: Record<string, string | null> = {
  "assigned-clocks": "#clock-cells",
  "assigned-clock-parents": "#clock-cells",
  "cooling-device": "#cooling-cells",
  "interrupts-extended": "#interrupt-cells",
  "interrupt-parent": "#interrupt-cells",
  "msi-ranges": "#interrupt-cells",
  "msi-parent": "#msi-cells",
  interconnects: "#interconnect-cells",
  mboxes: "#mbox-cells",
  "sound-dai": "#sound-dai-cells",
  "dma-masters": "#dma-cells",
  // Fixed arguments or none: any node may be referenced.
  "gpio-ranges": null,
  "memory-region": null,
};

/** Property a reference to each kind of provider writes, when it is not `foos` for `#foo-cells`. */
const FOR_PROVIDER: Record<string, string> = {
  "#gpio-cells": "gpios",
  "#interrupt-cells": "interrupts-extended",
  "#cooling-cells": "cooling-device",
  "#msi-cells": "msi-parent",
  "#sound-dai-cells": "sound-dai",
};

/**
 * The provider property that says how many cells follow each phandle of a
 * consumer property (`clocks` → `#clock-cells`, `reset-gpios` → `#gpio-cells`),
 * or null when any node may be referenced (`pinctrl-0`, `memory-region`).
 *
 * `foos` → `#foo-cells` is dt-schema's guess, which only holds when some
 * provider has that property: `known` lists the ones that exist.
 */
export function providerCells(property: string, known?: Set<string>): string | null {
  if (property in SPECIAL) return SPECIAL[property];
  if (/(^|-)gpios?$/.test(property)) return "#gpio-cells";
  if (/^pinctrl-\d+$/.test(property) || property.endsWith("-handle")) return null;
  if (property.endsWith("s")) {
    const cells = `#${property.slice(0, -1)}-cells`;
    return !known || known.has(cells) ? cells : null;
  }
  return null;
}

/** The property a reference to a provider of this kind writes (`#clock-cells` → `clocks`). */
export function propertyForProvider(cells: string): string {
  return FOR_PROVIDER[cells] ?? `${cells.slice(1, -"-cells".length)}s`;
}

export interface ConsumerPort {
  property: string;
  /** Provider property the target must have; null for any node. */
  cells: string | null;
  required: boolean;
  /** The node already references something through this property. */
  wired: boolean;
}

export interface ProviderPort {
  cells: string;
  /** Short name shown on the port (`clock` for `#clock-cells`). */
  label: string;
}

export interface NodePortSet {
  consumers: ConsumerPort[];
  providers: ProviderPort[];
}

const NOT_PROVIDERS = new Set(["#address-cells", "#size-cells"]);
const isProviderCells = (name: string) => /^#.+-cells$/.test(name) && !NOT_PROVIDERS.has(name);

/** The `#*-cells` a node has or its binding describes. */
export function providedCells(data: DtNodeData, binding: Binding | undefined): string[] {
  const names = [...data.properties.map((p) => p.name), ...(binding?.properties ?? []).map((s) => s.name)];
  return [...new Set(names.filter(isProviderCells))];
}

/**
 * Ports of a node: the phandle properties its binding describes and those it
 * already references, and the `#*-cells` it has or its binding describes.
 * `known` is every `#*-cells` some provider in the design has.
 */
export function nodePorts(
  data: DtNodeData,
  binding: Binding | undefined,
  referenced: string[],
  known: Set<string>,
): NodePortSet {
  const specs = binding?.properties ?? [];
  const consumers = new Map<string, ConsumerPort>();
  const wired = new Set(referenced);
  const add = (property: string, cells: string | null, required = false) => {
    if (!consumers.has(property)) consumers.set(property, { property, cells, required, wired: wired.has(property) });
  };
  for (const spec of specs) {
    if (spec.type === "phandle-array") add(spec.name, providerCells(spec.name, known), spec.required);
    // A single phandle has no specifier cells to type it by.
    if (spec.type === "phandle" && spec.name !== "interrupt-parent") add(spec.name, null, spec.required);
  }
  // `interrupts` cells go to the interrupt parent, which is a reference.
  if (specs.some((s) => s.name === "interrupts") || data.properties.some((p) => p.name === "interrupts")) {
    add("interrupt-parent", "#interrupt-cells");
  }
  referenced.forEach((p) => add(p, providerCells(p, known)));

  return {
    consumers: [...consumers.values()].sort((a, b) => Number(b.required) - Number(a.required)),
    providers: providedCells(data, binding).map((cells) => ({ cells, label: cells.slice(1, -"-cells".length) })),
  };
}

/** Whether a consumer port may point at a provider port (`undefined`: the generic phandle handle). */
export function accepts(port: ConsumerPort, providerCellsName: string | undefined): boolean {
  return port.cells === null ? providerCellsName === undefined : port.cells === providerCellsName;
}

/** Number of specifier cells the provider declares for this consumer property. */
export function specifierCount(provider: DtNodeData, property: string): number | undefined {
  if (property === "interrupt-parent") return 0;
  const cells = providerCells(property);
  const found = cells ? provider.properties.find((p) => p.name === cells) : undefined;
  return found?.value.type === "cells" ? found.value.value[0] : undefined;
}

/**
 * Phandle property for a reference to `target`, from the provider port it was
 * dropped on (`cells`), else from the first `#...-cells` it provides.
 */
export function guessReferenceProperty(target: DtNodeData, binding: Binding | undefined, cells?: string): string {
  const provided = cells ?? providedCells(target, binding)[0];
  return provided ? propertyForProvider(provided) : "phandle";
}
