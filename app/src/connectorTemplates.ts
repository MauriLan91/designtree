// Connector templates for the board view (US-14.3): pin numbers, names and
// power pins of common headers. The SoC pad behind each pin is board
// specific, so templates leave it unset.
import type { ConnectorPin, PinKind } from "./model.gen";

export interface ConnectorTemplate {
  id: string;
  title: string;
  /** For generic headers: the pin count is asked for. */
  generic?: { rows: 1 | 2 };
  pins?: [string, PinKind?][];
}

const P: PinKind = "power";
const G: PinKind = "ground";

export const TEMPLATES: ConnectorTemplate[] = [
  {
    id: "rpi-40",
    title: "40-pin header (Raspberry Pi layout)",
    pins: [
      ["3V3", P], ["5V", P], ["GPIO2 SDA"], ["5V", P], ["GPIO3 SCL"], ["GND", G],
      ["GPIO4"], ["GPIO14 TXD"], ["GND", G], ["GPIO15 RXD"], ["GPIO17"], ["GPIO18"],
      ["GPIO27"], ["GND", G], ["GPIO22"], ["GPIO23"], ["3V3", P], ["GPIO24"],
      ["GPIO10 MOSI"], ["GND", G], ["GPIO9 MISO"], ["GPIO25"], ["GPIO11 SCLK"], ["GPIO8 CE0"],
      ["GND", G], ["GPIO7 CE1"], ["ID_SD"], ["ID_SC"], ["GPIO5"], ["GND", G],
      ["GPIO6"], ["GPIO12"], ["GPIO13"], ["GND", G], ["GPIO19"], ["GPIO16"],
      ["GPIO26"], ["GPIO20"], ["GND", G], ["GPIO21"],
    ],
  },
  {
    id: "mikrobus",
    title: "mikroBUS socket",
    pins: [
      ["AN"], ["RST"], ["CS"], ["SCK"], ["MISO"], ["MOSI"], ["+3.3V", P], ["GND", G],
      ["GND", G], ["+5V", P], ["SDA"], ["SCL"], ["TX"], ["RX"], ["INT"], ["PWM"],
    ],
  },
  { id: "2xN", title: "Dual-row header", generic: { rows: 2 } },
  { id: "1xN", title: "Single-row header", generic: { rows: 1 } },
];

/** The pins of a new connector from `template`; `count` sizes a generic header. */
export function templatePins(template: ConnectorTemplate, count: number): ConnectorPin[] {
  const pins = template.pins ?? Array.from({ length: count }, () => [""] as [string, PinKind?]);
  return pins.map(([name, kind], i) => ({ number: i + 1, name, kind: kind ?? "signal", pinctrl: [] }));
}

/**
 * The pin numbers row by row, as the connector is drawn: odd pins on the
 * left and even on the right for dual-row headers, 1-8 down the left and
 * 16-9 down the right for mikroBUS, one column for single-row headers.
 */
export function pinRows(template: string | undefined, numbers: number[]): (number | null)[][] {
  if (template === "1xN") return numbers.map((n) => [n]);
  if (template === "mikrobus" && numbers.length === 16) {
    return Array.from({ length: 8 }, (_, i) => [i + 1, 16 - i]);
  }
  const rows: (number | null)[][] = [];
  for (let i = 0; i < numbers.length; i += 2) rows.push([numbers[i], numbers[i + 1] ?? null]);
  return rows;
}
