// Which library elements fit the scope on show, and which nodes sit under a
// parent their binding does not expect (US-18.4). The indexer reads, from
// each schema's examples, the class of bus its nodes hang from (`i2c`,
// `spi`, `cpus`, `mmio` for the SoC's memory-mapped bus); a scope has a
// class too, from its node. Matching the two is a hint, never a rule: the
// placement check only warns.
import type { Binding, DtFlowNode, LibraryEntry, Problem } from "./model";
import { busKind } from "./scopes";

/** The bus class of a node name, as `bus_class` in the bindings crate:
 * without labels, unit address and instance number, `mmio` for the root and
 * plain memory-mapped buses. Keep the two alike. */
export function busClass(name: string): string {
  const unlabelled = name.split(":").pop()!.trim();
  const base = unlabelled
    .split("@")[0]
    .replace(/\d+$/, "")
    .replace(/[-_]+$/, "")
    .toLowerCase();
  if (["", "/", "soc", "bus", "simple-bus", "apb", "ahb", "axi", "aips-bus", "aips"].includes(base)) return "mmio";
  return base === "pcie" ? "pci" : base;
}

/** Classes the placement check knows well enough to warn about. */
const KNOWN = new Set(["i2c", "i3c", "spi", "cpus", "mmio", "mdio", "spmi", "usb", "pci", "w1"]);

const TITLES: Record<string, string> = {
  i2c: "an I²C bus",
  i3c: "an I3C bus",
  spi: "an SPI bus",
  cpus: "/cpus",
  mmio: "the memory-mapped bus",
  mdio: "an MDIO bus",
  spmi: "an SPMI bus",
  usb: "a USB controller",
  pci: "a PCI bus",
  w1: "a 1-Wire bus",
};

export const classTitle = (cls: string) => TITLES[cls] ?? `a ${cls} node`;

/** The class of the bus a scope's node is: an I²C or SPI controller by its
 * binding or compatible, a simple bus or the root as memory-mapped, else
 * by its name. */
export function scopeClass(node: DtFlowNode): string {
  const kind = busKind(node);
  if (kind === "i2c" || kind === "spi") return kind;
  if (node.data.compatible.includes("simple-bus")) return "mmio";
  return busClass(node.data.name);
}

/** The entries whose examples put them under a `cls` node. */
export const fitting = (entries: LibraryEntry[], cls: string) => entries.filter((e) => e.buses?.includes(cls));

/** A warning for a node whose binding expects another kind of parent. */
export function placementProblem(
  child: DtFlowNode,
  binding: Binding | undefined,
  parent: DtFlowNode,
  nodeName: (id: string) => string,
): Problem | null {
  const buses = binding?.buses ?? [];
  const cls = scopeClass(parent);
  if (!KNOWN.has(cls) || buses.includes(cls) || !buses.some((b) => KNOWN.has(b))) return null;
  const expected = buses.filter((b) => KNOWN.has(b)).map(classTitle);
  const where = expected.length === 1 ? expected[0] : `${expected.slice(0, -1).join(", ")} or ${expected[expected.length - 1]}`;
  return {
    severity: "warning",
    node: child.id,
    message: `Under ${nodeName(parent.id)}, ${classTitle(cls)}, but its binding (${binding?.path}) places it under ${where}`,
  };
}
