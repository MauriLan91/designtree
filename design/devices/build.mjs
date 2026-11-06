// Builds the device icon set and the canvas device drawings from the shapes
// below: one SVG per icon and per drawing, plus catalog.json with the same
// path data for tools that draw them themselves.
//
//   node design/devices/build.mjs
//
// Everything is plain path data so an icon is one <path> and a drawing is a
// fixed stack of role layers, each themed by a CSS variable.
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
// docs/workbench.md. A drawing is tinted with its kind's chip colors.
const KINDS = {
  cpu: { title: "CPU", light: ["#e6edfb", "#1d4fd8"], dark: ["#1f2b42", "#8fb8ff"] },
  irq: { title: "Interrupt controller", light: ["#fde8e8", "#b42318"], dark: ["#3a1f23", "#f59a9f"] },
  clock: { title: "Clock, reset, power", light: ["#fdf0dc", "#9a5b00"], dark: ["#382a14", "#f0be6a"] },
  bus: { title: "Bus or serial device", light: ["#e7f6ec", "#1f7a43"], dark: ["#18301f", "#72d398"] },
  gpio: { title: "GPIO, pins, LEDs", light: ["#efe9fd", "#6d3fd6"], dark: ["#2a2142", "#b9a0ff"] },
  mem: { title: "Memory", light: ["#eef0f3", "#4b535d"], dark: ["#14171b", "#aab2bc"] },
  other: { title: "Device", light: ["#eef0f3", "#4b535d"], dark: ["#14171b", "#aab2bc"] },
};
// Neutral layers of a drawing: pins and contacts, and openings or screens.
const NEUTRAL = {
  light: { metal: "#b9c0c9", face: "#ffffff" },
  dark: { metal: "#5b636e", face: "#22262d" },
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

// Drawings for canvas nodes: a top or front view of the part, 160 × 100,
// drawn as role layers back to front. `metal` sits under the body (legs),
// `contacts` on top of it (pads, pins seen from above).
const LAYERS = ["metal", "body", "face", "contacts", "detail", "solid"];

const qfnPads = (x0, y0, size, count, len = 8) => {
  const step = (size - 20) / (count - 1);
  return range(count, 10, step).flatMap((o) => [
    R(x0 - len / 2 - 1, y0 + o - 2, len, 4, 1), R(x0 + size - len / 2 + 1, y0 + o - 2, len, 4, 1),
    R(x0 + o - 2, y0 - len / 2 - 1, 4, len, 1), R(x0 + o - 2, y0 + size - len / 2 + 1, 4, len, 1),
  ]);
};

const DEVICES = {
  cpu: {
    kind: "cpu", label: "CPU (QFP)", icon: "cpu",
    metal: range(8, 22, 8).flatMap((p) => [R(34, p - 1.8, 12, 3.6, 0.8), R(114, p - 1.8, 12, 3.6, 0.8)])
      .concat(range(8, 52, 8).flatMap((p) => [R(p - 1.8, 4, 3.6, 12, 0.8), R(p - 1.8, 84, 3.6, 12, 0.8)])),
    body: [R(44, 14, 72, 72, 5)],
    face: [R(60, 30, 40, 40, 3)],
    detail: ["M67 46H93M67 54H85"],
    solid: [C(52, 22, 2.6)],
  },
  soc: {
    kind: "cpu", label: "SoC (BGA, lidded)", icon: "cores",
    body: [R(28, 6, 104, 88, 8)],
    face: [R(50, 22, 60, 56, 5)],
    detail: [R(56, 28, 48, 44, 3)],
    solid: ["M35 13H44L35 22Z"],
  },
  "interrupt-controller": {
    kind: "irq", label: "Interrupt controller (QFN)", icon: "interrupt-controller",
    metal: qfnPads(52, 22, 56, 5),
    body: [R(52, 22, 56, 56, 6)],
    solid: ["M84 30L68 54H80L76 70L92 46H80Z"],
  },
  oscillator: {
    kind: "clock", label: "Oscillator", icon: "clock",
    metal: [R(38, 24, 14, 12, 2), R(108, 24, 14, 12, 2), R(38, 64, 14, 12, 2), R(108, 64, 14, 12, 2)],
    body: [R(46, 26, 68, 48, 6)],
    face: [R(54, 34, 52, 32, 4)],
    detail: [L(60, 58, 60, 42, 70, 42, 70, 58, 80, 58, 80, 42, 90, 42, 90, 58, 100, 58, 100, 42)],
  },
  crystal: {
    kind: "clock", label: "Crystal (HC-49)", icon: "crystal",
    metal: [R(14, 46, 22, 8, 2), R(124, 46, 22, 8, 2)],
    body: [R(30, 28, 100, 44, 22)],
    face: [R(38, 35, 84, 30, 15)],
    detail: ["M66 50H94"],
  },
  regulator: {
    kind: "clock", label: "Regulator (SOT-223)", icon: "regulator",
    metal: [R(56, 6, 48, 20, 2), R(60, 72, 8, 22, 1.5), R(76, 72, 8, 22, 1.5), R(92, 72, 8, 22, 1.5)],
    body: [R(48, 22, 64, 54, 4)],
    detail: ["M60 40H100M60 50H88"],
    solid: [C(58, 66, 2.5)],
  },
  rtc: {
    kind: "clock", label: "RTC backup cell", icon: "rtc",
    metal: [R(34, 42, 12, 16, 2), R(114, 42, 12, 16, 2)],
    body: [C(80, 50, 38)],
    face: [C(80, 50, 30)],
    detail: ["M80 41V59M71 50H89"],
  },
  battery: {
    kind: "clock", label: "Battery, supply", icon: "battery",
    metal: [R(124, 40, 12, 20, 2)],
    body: [R(24, 26, 104, 48, 6)],
    face: [R(30, 32, 30, 36, 3)],
    detail: ["M100 50H112M106 44V56M39 50H51"],
  },
  serial: {
    kind: "bus", label: "Serial port (DE-9)", icon: "serial",
    metal: [R(8, 22, 144, 56, 6)],
    body: ["M36 28H124L116 72H44Z"],
    face: ["M42 33H118L111 67H49Z", C(22, 50, 6), C(138, 50, 6)],
    solid: [...range(5, 56, 12).map((x) => C(x, 43, 3)), ...range(4, 62, 12).map((x) => C(x, 57, 3))],
  },
  ethernet: {
    kind: "bus", label: "Ethernet jack (RJ45)", icon: "ethernet",
    body: [R(30, 8, 100, 84, 6)],
    face: ["M46 28H114V68H98V78H62V68H46Z"],
    contacts: range(8, 54, 7.2).map((x) => R(x, 30, 3, 12, 0.8)),
    solid: [R(36, 14, 14, 7, 2), R(110, 14, 14, 7, 2)],
  },
  usb: {
    kind: "bus", label: "USB-C receptacle", icon: "usb",
    body: [R(22, 30, 116, 40, 20)],
    face: [R(30, 37, 100, 26, 13)],
    solid: [R(48, 46, 64, 8, 4)],
  },
  mmc: {
    kind: "bus", label: "SD card", icon: "mmc",
    body: ["M34 14H120L132 26V84A2 2 0 0 1 130 86H34A2 2 0 0 1 32 84V16A2 2 0 0 1 34 14Z"],
    face: [R(60, 26, 58, 48, 4)],
    contacts: range(8, 20, 8).map((y) => R(38, y, 12, 5, 1)),
  },
  wireless: {
    kind: "bus", label: "Wireless module", icon: "wireless",
    metal: [...range(10, 34, 10).map((x) => R(x, 84, 5, 10, 1)), ...range(6, 22, 12).flatMap((y) => [R(18, y, 10, 5, 1), R(132, y, 10, 5, 1)])],
    body: [R(26, 12, 108, 76, 5)],
    face: [R(98, 18, 30, 64, 3)],
    detail: [L(104, 28, 122, 28, 122, 36, 104, 36, 104, 44, 122, 44, 122, 52, 104, 52, 104, 60, 122, 60, 122, 68, 104, 68), "M38 30H80M38 40H70"],
  },
  gpio: {
    kind: "gpio", label: "Pin header (2 × 5)", icon: "gpio",
    body: [R(30, 28, 100, 44, 4)],
    contacts: range(5, 38, 18).flatMap((x, i) => (i ? [R(x, 34, 12, 12, 1.5)] : [])).concat(range(5, 38, 18).map((x) => R(x, 54, 12, 12, 1.5))),
    solid: [R(38, 34, 12, 12, 1.5)],
  },
  led: {
    kind: "gpio", label: "LED (5 mm)", icon: "led",
    metal: [R(70, 66, 5, 30, 1), R(86, 66, 5, 22, 1)],
    body: ["M62 60V38A18 18 0 0 1 98 38V60Z", R(58, 60, 44, 8, 2)],
    face: [R(72, 42, 16, 12, 2)],
    detail: ["M48 24L40 18M46 40H36M112 24L120 18M114 40H124"],
  },
  button: {
    kind: "gpio", label: "Push button", icon: "button",
    metal: [R(36, 18, 14, 8, 2), R(110, 18, 14, 8, 2), R(36, 74, 14, 8, 2), R(110, 74, 14, 8, 2)],
    body: [R(45, 15, 70, 70, 5)],
    face: [C(80, 50, 20)],
    detail: [C(80, 50, 13)],
  },
  memory: {
    kind: "mem", label: "Memory module (DIMM)", icon: "memory",
    metal: range(28, 10, 5).filter((x) => x < 64 || x > 74).map((x) => R(x, 74, 3, 14, 0.8)),
    body: ["M8 16H152A2 2 0 0 1 154 18V78H74V73H66V78H6V18A2 2 0 0 1 8 16Z"],
    face: range(4, 16, 35).map((x) => R(x, 26, 24, 32, 2)),
    detail: ["M18 68H54"],
  },
  flash: {
    kind: "mem", label: "Flash (SOIC-8)", icon: "flash",
    metal: [32, 44, 56, 68].flatMap((y) => [R(36, y - 2.5, 16, 5, 1), R(108, y - 2.5, 16, 5, 1)]),
    body: [R(48, 22, 64, 56, 4)],
    detail: ["M64 48H96M64 58H88"],
    solid: [C(58, 32, 3)],
  },
  nvmem: {
    kind: "mem", label: "EEPROM, fuses (SOT-23)", icon: "nvmem",
    metal: [R(68, 20, 6, 14, 1), R(86, 20, 6, 14, 1), R(64, 66, 6, 14, 1), R(77, 66, 6, 14, 1), R(90, 66, 6, 14, 1)],
    body: [R(58, 30, 44, 40, 3)],
    detail: ["M68 46H92M68 54H84"],
  },
  device: {
    kind: "other", label: "Device (QFN)", icon: "device",
    metal: qfnPads(54, 24, 52, 4),
    body: [R(54, 24, 52, 52, 6)],
    detail: ["M68 52H92M68 60H84"],
    solid: [C(63, 33, 2.5)],
  },
  sensor: {
    kind: "other", label: "Sensor (DFN)", icon: "sensor",
    metal: [32, 47, 62].flatMap((y) => [R(46, y, 10, 6, 1.5), R(104, y, 10, 6, 1.5)]),
    body: [R(52, 24, 56, 52, 6)],
    face: [C(80, 50, 12)],
    detail: [C(80, 50, 5)],
    solid: [C(61, 33, 2.5)],
  },
  display: {
    kind: "other", label: "Display panel", icon: "display",
    metal: [R(64, 84, 32, 14, 1)],
    body: [R(12, 6, 136, 82, 6)],
    face: [R(20, 14, 120, 60, 3)],
    detail: ["M70 81H90"],
  },
  audio: {
    kind: "other", label: "Speaker", icon: "audio",
    body: [C(80, 50, 40)],
    face: [C(80, 50, 28)],
    detail: [C(80, 50, 18)],
    solid: [C(80, 50, 7)],
  },
  camera: {
    kind: "other", label: "Camera module", icon: "camera",
    metal: [R(70, 78, 20, 20, 1)],
    body: [R(44, 10, 72, 70, 6)],
    face: [C(80, 45, 24)],
    detail: [C(80, 45, 15)],
    solid: [C(80, 45, 6)],
  },
};

// Role styles. Variables let a host theme a drawing per kind; the fallbacks
// are the light theme, so a file also renders on its own.
const style = (kind) => {
  const [bg, ink] = KINDS[kind].light;
  const v = (name, fallback) => `var(--device-${name}, ${fallback})`;
  const line = "stroke-linecap:round;stroke-linejoin:round";
  return {
    metal: `fill:${v("metal", NEUTRAL.light.metal)}`,
    body: `fill:${v("body", bg)};stroke:${v("ink", ink)};stroke-width:2;${line}`,
    face: `fill:${v("face", NEUTRAL.light.face)};stroke:${v("ink", ink)};stroke-width:1.5;${line}`,
    contacts: `fill:${v("metal", NEUTRAL.light.metal)};stroke:${v("ink", ink)};stroke-width:1;${line}`,
    detail: `fill:none;stroke:${v("ink", ink)};stroke-width:1.75;${line}`,
    solid: `fill:${v("ink", ink)}`,
  };
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function iconSvg({ label, d }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${esc(label)}">\n` +
    `  <path d="${d.join("")}"/>\n</svg>\n`
  );
}

function deviceSvg(dev) {
  const s = style(dev.kind);
  const paths = LAYERS.filter((l) => dev[l]?.length).map((l) => `  <path d="${dev[l].join("")}" style="${s[l]}"/>`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100" ` +
    `role="img" aria-label="${esc(dev.label)}">\n${paths.join("\n")}\n</svg>\n`
  );
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

for (const [name, icon] of Object.entries(ICONS)) write(join(here, "icons", `${name}.svg`), iconSvg(icon));
for (const [name, dev] of Object.entries(DEVICES)) write(join(here, "drawings", `${name}.svg`), deviceSvg(dev));

const catalog = {
  kinds: KINDS,
  neutral: NEUTRAL,
  icons: Object.fromEntries(Object.entries(ICONS).map(([k, { kind, label, categories, d }]) => [k, { kind, label, categories, d: d.join("") }])),
  drawings: Object.fromEntries(
    Object.entries(DEVICES).map(([k, dev]) => [
      k,
      { kind: dev.kind, label: dev.label, icon: dev.icon, ...Object.fromEntries(LAYERS.map((l) => [l, (dev[l] ?? []).join("")])) },
    ]),
  ),
};
write(join(here, "catalog.json"), JSON.stringify(catalog, null, 1) + "\n");
console.log(`${Object.keys(ICONS).length} icons, ${Object.keys(DEVICES).length} drawings`);
