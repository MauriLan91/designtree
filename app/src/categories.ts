// Node categories (US-15.6): one tint and icon per kind of device, on canvas
// nodes and library rows, so a board reads at a glance. The tint is
// decoration only; the name and compatible always carry the meaning.
import { Box, Clock, Cpu, MemoryStick, Text, ToggleLeft, Zap, type LucideIcon } from "lucide-react";

export type Kind = "cpu" | "irq" | "clock" | "bus" | "gpio" | "mem" | "other";

export const KINDS: Record<Kind, { title: string; Icon: LucideIcon }> = {
  cpu: { title: "CPU", Icon: Cpu },
  irq: { title: "Interrupt controller", Icon: Zap },
  clock: { title: "Clock, reset, power", Icon: Clock },
  bus: { title: "Bus or serial device", Icon: Text },
  gpio: { title: "GPIO, pins, LEDs", Icon: ToggleLeft },
  mem: { title: "Memory", Icon: MemoryStick },
  other: { title: "Device", Icon: Box },
};

// Binding categories are the first directory under the kernel's bindings.
const BY_CATEGORY: Record<string, Kind> = {
  cpu: "cpu",
  cpus: "cpu",
  arm: "cpu",
  riscv: "cpu",
  mips: "cpu",
  powerpc: "cpu",
  perf: "cpu",
  "interrupt-controller": "irq",
  clock: "clock",
  reset: "clock",
  power: "clock",
  regulator: "clock",
  timer: "clock",
  rtc: "clock",
  serial: "bus",
  i2c: "bus",
  spi: "bus",
  usb: "bus",
  net: "bus",
  mmc: "bus",
  pci: "bus",
  bus: "bus",
  gpio: "gpio",
  pinctrl: "gpio",
  leds: "gpio",
  input: "gpio",
  "memory-controllers": "mem",
  "reserved-memory": "mem",
  mtd: "mem",
  nvmem: "mem",
  sram: "mem",
};

// For nodes without a binding: the generic node names of the devicetree spec.
const BY_NAME: [RegExp, Kind][] = [
  [/^cpus?$/, "cpu"],
  [/^interrupt-controller$/, "irq"],
  [/^(clock|clock-controller|oscillator|reset-controller|regulator|timer|power-controller)$/, "clock"],
  [/^(serial|i2c|spi|usb|ethernet|mmc|pcie?|can|bus|soc)$/, "bus"],
  [/^(gpio|gpio-controller|pinctrl|pinmux|leds?|keys)$/, "gpio"],
  [/^(memory|sram|flash|reserved-memory|memory-controller)$/, "mem"],
];

/** The kind of a node, from its binding's category when it has one, else
 * from its node name (`serial`, `cpu`, …). */
export function kindOf(category: string | undefined, name: string): Kind {
  if (category && category in BY_CATEGORY) return BY_CATEGORY[category];
  const found = BY_NAME.find(([re]) => re.test(name));
  return found ? found[1] : "other";
}
