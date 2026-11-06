// Builds the device icon set from the shapes below: one SVG per icon, plus
// icons.json with the same path data for tools that draw them themselves.
//
//   node design/devices/build.mjs
//
// Everything is plain path data, so an icon is one <path>.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const n = (v) => +v.toFixed(2);

const R = (x, y, w, h, r = 0) => {
  if (!r) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  const a = `A${r} ${r} 0 0 1`;
  return (
    `M${n(x + r)} ${n(y)}H${n(x + w - r)}${a} ${n(x + w)} ${n(y + r)}` +
    `V${n(y + h - r)}${a} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}` +
    `${a} ${n(x)} ${n(y + h - r)}V${n(y + r)}${a} ${n(x + r)} ${n(y)}Z`
  );
};
const C = (cx, cy, r) =>
  `M${n(cx - r)} ${n(cy)}A${r} ${r} 0 1 0 ${n(cx + r)} ${n(cy)}A${r} ${r} 0 1 0 ${n(cx - r)} ${n(cy)}Z`;
const L = (...p) => "M" + p.map(n).reduce((s, v, i) => s + (i === 0 ? "" : i % 2 ? " " : "L") + v, "");
// A dot: a zero-length segment drawn with a round cap.
const D = (x, y) => `M${x} ${y}h0`;
const range = (count, from, step) => Array.from({ length: count }, (_, i) => from + i * step);

// The kinds of US-15.6 (app/src/categories.ts), with the chip tokens of
// docs/workbench.md.
const KINDS = {
  cpu: { title: "CPU", light: ["#e6edfb", "#1d4fd8"], dark: ["#1f2b42", "#8fb8ff"] },
  irq: { title: "Interrupt controller", light: ["#fde8e8", "#b42318"], dark: ["#3a1f23", "#f59a9f"] },
  clock: { title: "Clock, reset, power", light: ["#fdf0dc", "#9a5b00"], dark: ["#382a14", "#f0be6a"] },
  bus: { title: "Bus or serial device", light: ["#e7f6ec", "#1f7a43"], dark: ["#18301f", "#72d398"] },
  gpio: { title: "GPIO, pins, LEDs", light: ["#efe9fd", "#6d3fd6"], dark: ["#2a2142", "#b9a0ff"] },
  mem: { title: "Memory", light: ["#eef0f3", "#4b535d"], dark: ["#14171b", "#aab2bc"] },
  other: { title: "Device", light: ["#eef0f3", "#4b535d"], dark: ["#14171b", "#aab2bc"] },
};

// Icons: 24 px grid, 1.75 px stroke, round caps and joins, like Lucide, so
// they sit next to the workbench's Lucide icons. `categories` are the kernel
// binding directories (Documentation/devicetree/bindings/<dir>) each one is
// meant for.
const ICONS = {
  cpu: {
    kind: "cpu", label: "CPU", categories: ["cpu", "cpus", "arm", "riscv", "mips", "powerpc"],
    d: [R(6, 6, 12, 12, 2), R(9.5, 9.5, 5, 5, 0.75),
      ...[9.5, 14.5].flatMap((p) => [L(p, 2.5, p, 6), L(p, 18, p, 21.5), L(2.5, p, 6, p), L(18, p, 21.5, p)])],
  },
  cores: {
    kind: "cpu", label: "CPU cluster", categories: ["cpus"],
    d: [R(3, 3, 18, 18, 3), R(6.5, 6.5, 4.5, 4.5, 1), R(13, 6.5, 4.5, 4.5, 1), R(6.5, 13, 4.5, 4.5, 1), R(13, 13, 4.5, 4.5, 1)],
  },
  pmu: {
    kind: "cpu", label: "Performance monitor", categories: ["perf"],
    d: ["M4.5 17A8 8 0 1 1 19.5 17", L(12, 14, 15.5, 9.5), C(12, 14, 1.25)],
  },
  "interrupt-controller": {
    kind: "irq", label: "Interrupt controller", categories: ["interrupt-controller"],
    d: [R(5, 4, 14, 16, 2.5), "M13 7L9.5 12.5H14.5L11 17", L(2, 9, 5, 9), L(2, 15, 5, 15), L(19, 12, 22, 12)],
  },
  mailbox: {
    kind: "irq", label: "Mailbox", categories: ["mailbox"],
    d: [R(3, 6, 18, 12, 2), L(3.5, 7, 12, 13, 20.5, 7)],
  },
  clock: {
    kind: "clock", label: "Clock, oscillator", categories: ["clock"],
    d: [R(3, 5, 18, 14, 2.5), L(6, 14, 6, 10, 9, 10, 9, 14, 12, 14, 12, 10, 15, 10, 15, 14, 18, 14)],
  },
  crystal: {
    kind: "clock", label: "Crystal", categories: ["clock"],
    d: [L(8, 6, 8, 18), L(16, 6, 16, 18), R(10.5, 8, 3, 8, 0.5), L(2.5, 12, 8, 12), L(16, 12, 21.5, 12)],
  },
  reset: {
    kind: "clock", label: "Reset controller", categories: ["reset"],
    d: ["M20 12A8 8 0 1 1 17.66 6.34", "M17.66 2.34V6.34H13.66", D(12, 12)],
  },
  regulator: {
    kind: "clock", label: "Regulator", categories: ["regulator"],
    d: [R(7, 3, 10, 5, 1), R(6, 8, 12, 9, 1.5), L(9, 17, 9, 21), L(12, 17, 12, 21), L(15, 17, 15, 21), D(12, 5.5)],
  },
  "power-domain": {
    kind: "clock", label: "Power domain", categories: ["power"],
    d: ["M7.76 7.76A6 6 0 1 0 16.24 7.76", L(12, 3.5, 12, 11)],
  },
  battery: {
    kind: "clock", label: "Battery, supply", categories: ["power"],
    d: [R(3, 7, 16, 10, 2), L(21, 10.5, 21, 13.5), L(6.5, 10, 6.5, 14), L(9.5, 10, 9.5, 14)],
  },
  timer: {
    kind: "clock", label: "Timer", categories: ["timer"],
    d: [C(12, 13.5, 7.5), L(12, 13.5, 12, 9.5), L(10, 2.5, 14, 2.5), L(12, 2.5, 12, 6), L(18, 6.5, 19.5, 5)],
  },
  rtc: {
    kind: "clock", label: "Real-time clock", categories: ["rtc"],
    d: [C(12, 12, 8.5), L(12, 7.5, 12, 12, 15, 14)],
  },
  serial: {
    kind: "bus", label: "Serial port (UART)", categories: ["serial"],
    d: ["M3 7H21L19 17H5Z", ...range(5, 7, 2.5).map((x) => D(x, 10.5)), ...range(4, 8.25, 2.5).map((x) => D(x, 13.5))],
  },
  i2c: {
    kind: "bus", label: "I²C bus", categories: ["i2c"],
    d: [L(3, 5, 21, 5), L(3, 9, 21, 9), R(4, 15, 6, 5, 1), R(14, 15, 6, 5, 1),
      L(6, 5, 6, 15), L(8, 9, 8, 15), L(16, 5, 16, 15), L(18, 9, 18, 15)],
  },
  spi: {
    kind: "bus", label: "SPI bus", categories: ["spi"],
    d: [R(3, 5, 6, 14, 1.5), L(9, 8.5, 21, 8.5), L(9, 12, 21, 12), L(9, 15.5, 21, 15.5), L(17, 15.5, 17, 19), L(14, 19, 20, 19)],
  },
  usb: {
    kind: "bus", label: "USB", categories: ["usb"],
    d: [L(12, 3.5, 12, 17), C(12, 19, 2), "M9.5 6L12 3.5L14.5 6", L(12, 14, 7, 11, 7, 9), C(7, 7.75, 1.25),
      L(12, 12, 17, 9.5, 17, 7.5), R(15.75, 5, 2.5, 2.5, 0.25)],
  },
  ethernet: {
    kind: "bus", label: "Ethernet", categories: ["net"],
    d: ["M4 5H20V16H16V19H8V16H4Z", ...range(5, 8, 2).map((x) => L(x, 8, x, 10.5))],
  },
  wireless: {
    kind: "bus", label: "Wireless", categories: ["net"],
    d: [L(12, 9, 12, 21), D(12, 9), "M9.17 6.17A4 4 0 0 0 9.17 11.83", "M14.83 6.17A4 4 0 0 1 14.83 11.83",
      "M6.34 3.34A8 8 0 0 0 6.34 14.66", "M17.66 3.34A8 8 0 0 1 17.66 14.66"],
  },
  can: {
    kind: "bus", label: "CAN bus", categories: ["net"],
    d: ["M3 8C7 8 9 16 12 16C15 16 17 8 21 8", "M3 16C7 16 9 8 12 8C15 8 17 16 21 16"],
  },
  mmc: {
    kind: "bus", label: "SD, MMC", categories: ["mmc"],
    d: ["M8 3H16L19 6V20A1 1 0 0 1 18 21H6A1 1 0 0 1 5 20V6A3 3 0 0 1 8 3Z", L(9, 6.5, 9, 9), L(12, 6.5, 12, 9), L(15, 6.5, 15, 9)],
  },
  pci: {
    kind: "bus", label: "PCI, PCIe", categories: ["pci"],
    d: [R(3, 4, 18, 11, 1.5), R(6, 7, 6, 5, 1), ...[5, 7.5, 10, 14, 16.5, 19].map((x) => L(x, 15, x, 19))],
  },
  bus: {
    kind: "bus", label: "Bus, SoC interconnect", categories: ["bus"],
    d: [L(3, 12, 21, 12), R(5, 3, 5, 5, 1), R(14, 16, 5, 5, 1), L(7.5, 8, 7.5, 12), L(16.5, 12, 16.5, 16), D(3, 12), D(21, 12)],
  },
  gpio: {
    kind: "gpio", label: "GPIO", categories: ["gpio"],
    d: [R(3, 8, 18, 8, 1.5), ...range(4, 6, 4).map((x) => D(x, 12))],
  },
  pinctrl: {
    kind: "gpio", label: "Pin controller", categories: ["pinctrl"],
    d: ["M8 4L16 7V17L8 20Z", L(3, 8, 8, 8), L(3, 12, 8, 12), L(3, 16, 8, 16), L(16, 12, 21, 12)],
  },
  led: {
    kind: "gpio", label: "LED", categories: ["leds"],
    d: ["M7.5 14V9A4.5 4.5 0 0 1 16.5 9V14", L(6, 14, 18, 14), L(10, 14, 10, 21), L(14, 14, 14, 19)],
  },
  button: {
    kind: "gpio", label: "Button, keys", categories: ["input"],
    d: [R(4, 4, 16, 16, 2), C(12, 12, 4)],
  },
  memory: {
    kind: "mem", label: "Memory (DRAM)", categories: ["memory-controllers"],
    d: [R(2, 6, 20, 10, 1.5), R(4.5, 8.5, 3.5, 4.5, 0.5), R(10.25, 8.5, 3.5, 4.5, 0.5), R(16, 8.5, 3.5, 4.5, 0.5),
      ...[5, 8, 11, 15, 18].map((x) => L(x, 16, x, 18.5))],
  },
  "memory-controller": {
    kind: "mem", label: "Memory controller", categories: ["memory-controllers"],
    d: [R(3, 7, 9, 10, 1.5), L(12, 10, 16, 10), L(12, 14, 16, 14), R(16, 5, 5, 14, 1)],
  },
  sram: {
    kind: "mem", label: "SRAM", categories: ["sram"],
    d: [R(4, 4, 16, 16, 2), L(4, 9.33, 20, 9.33), L(4, 14.67, 20, 14.67), L(9.33, 4, 9.33, 20), L(14.67, 4, 14.67, 20)],
  },
  flash: {
    kind: "mem", label: "Flash (MTD)", categories: ["mtd"],
    d: [R(7, 4, 10, 16, 1.5), D(9.5, 7), ...[7.5, 10.5, 13.5, 16.5].flatMap((y) => [L(3.5, y, 7, y), L(17, y, 20.5, y)])],
  },
  nvmem: {
    kind: "mem", label: "NVMEM, fuses", categories: ["nvmem"],
    d: [R(6, 8, 12, 8, 1.5), L(2, 12, 22, 12)],
  },
  "reserved-memory": {
    kind: "mem", label: "Reserved memory", categories: ["reserved-memory"],
    d: [R(5, 3, 14, 18, 1.5), L(5, 8, 19, 8), L(5, 16, 19, 16), L(5, 12, 9, 8), L(5, 16, 13, 8), L(9, 16, 17, 8), L(13, 16, 19, 10)],
  },
  device: {
    kind: "other", label: "Device", categories: [],
    d: [R(5, 5, 14, 14, 2), L(2, 9, 5, 9), L(2, 15, 5, 15), L(19, 9, 22, 9), L(19, 15, 22, 15)],
  },
  display: {
    kind: "other", label: "Display", categories: ["display"],
    d: [R(3, 4, 18, 13, 2), L(9, 21, 15, 21), L(12, 17, 12, 21)],
  },
  sensor: {
    kind: "other", label: "Sensor (IIO)", categories: ["iio"],
    d: [R(4, 4, 16, 16, 2.5), L(6.5, 12, 8.5, 12, 10, 8, 12, 16, 14, 10, 15.5, 12, 17.5, 12)],
  },
  adc: {
    kind: "other", label: "ADC", categories: ["iio"],
    d: [L(4, 20, 8, 20, 8, 16, 12, 16, 12, 12, 16, 12, 16, 8, 20, 8), "M4 13C7 4 11 4 14 7"],
  },
  thermal: {
    kind: "other", label: "Thermal sensor", categories: ["thermal"],
    d: ["M10 5A2 2 0 0 1 14 5V13.5A4 4 0 1 1 10 13.5Z", L(12, 9, 12, 16)],
  },
  audio: {
    kind: "other", label: "Audio", categories: ["sound"],
    d: ["M4 9.5H7.5L12 5.5V18.5L7.5 14.5H4Z", "M15.5 9A4 4 0 0 1 15.5 15", "M18 6.5A7.5 7.5 0 0 1 18 17.5"],
  },
  camera: {
    kind: "other", label: "Camera, media", categories: ["media"],
    d: ["M3 9A2 2 0 0 1 5 7H7.5L9 5H15L16.5 7H19A2 2 0 0 1 21 9V17A2 2 0 0 1 19 19H5A2 2 0 0 1 3 17Z", C(12, 13, 3.5)],
  },
  dma: {
    kind: "other", label: "DMA engine", categories: ["dma"],
    d: [R(3, 4, 7, 7, 1.5), R(14, 13, 7, 7, 1.5), "M10 7.5H17.5V13", "M15 10.5L17.5 13L20 10.5"],
  },
  pwm: {
    kind: "other", label: "PWM", categories: ["pwm"],
    d: ["M2.5 16H4V8H9V16H11V8H14V16H16V8H17V16H21.5"],
  },
  watchdog: {
    kind: "other", label: "Watchdog", categories: ["watchdog"],
    d: ["M12 3L19 6V11.5C19 16 16 19.5 12 21C8 19.5 5 16 5 11.5V6Z", L(12, 8.5, 12, 12.5, 14.5, 14)],
  },
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function iconSvg({ label, d }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${esc(label)}">\n` +
    `  <path d="${d.join("")}"/>\n</svg>\n`
  );
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

for (const [name, icon] of Object.entries(ICONS)) write(join(here, "icons", `${name}.svg`), iconSvg(icon));

const catalog = {
  kinds: KINDS,
  icons: Object.fromEntries(Object.entries(ICONS).map(([k, { kind, label, categories, d }]) => [k, { kind, label, categories, d: d.join("") }])),
};
write(join(here, "icons.json"), JSON.stringify(catalog, null, 1) + "\n");
console.log(`${Object.keys(ICONS).length} icons`);
