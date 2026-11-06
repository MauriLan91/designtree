# Device icons and canvas drawings

Original artwork for the element library and the canvas, kept aside for a
future story. Nothing here is wired into the app yet.

![All icons and drawings, light and dark](preview.png)

| Path | Content |
| --- | --- |
| `icons/` | 43 icons, one per kind of device in the kernel's binding schemas. |
| `drawings/` | 24 device drawings (top or front view of the part) to draw on canvas nodes instead of a plain rectangle. |
| `catalog.json` | The same shapes as path data, with each icon's binding directories and the theme colors. |
| `build.mjs` | Source of truth: edit the shapes there, then run `node design/devices/build.mjs`. |

## Categories

Icons and drawings use the seven node kinds of US-15.6 (`app/src/categories.ts`)
and the chip colors of `docs/workbench.md`:

| Kind | Icons |
| --- | --- |
| `cpu` | cpu, cores, pmu |
| `irq` | interrupt-controller, mailbox |
| `clock` | clock, crystal, reset, regulator, power-domain, battery, timer, rtc |
| `bus` | serial, i2c, spi, usb, ethernet, wireless, can, mmc, pci, bus |
| `gpio` | gpio, pinctrl, led, button |
| `mem` | memory, memory-controller, sram, flash, nvmem, reserved-memory |
| `other` | device, display, sensor, adc, thermal, audio, camera, dma, pwm, watchdog |

Each icon in `catalog.json` lists the binding directories it is meant for
(`categories`), a finer mapping than the kind for the library's sections
(US-18.2).

## Icons

24 px grid, 1.75 px stroke, round caps and joins, `currentColor`: the same
grammar as the Lucide icons of the workbench, so they can sit side by side.
Each icon is a single `<path>`.

## Drawings

160 × 100, flat, built from six layers back to front. Each layer reads a CSS
variable, with the light theme as fallback so a file renders on its own:

| Layer | Variable | Light | Dark |
| --- | --- | --- | --- |
| Pins and legs (under the body) | `--device-metal` | `#b9c0c9` | `#5b636e` |
| Body | `--device-body` | kind chip background | kind chip background |
| Face: lids, openings, screens | `--device-face` | `#ffffff` (node) | `#22262d` (node) |
| Contacts (over the body) | `--device-metal` | as pins | as pins |
| Markings, outlines | `--device-ink` | kind chip ink | kind chip ink |
| Solid marks: pin 1, logos | `--device-ink` | kind chip ink | kind chip ink |

Inlined in the page, a node sets the variables from its kind, for example:

```css
.kind-cpu svg { --device-body: var(--cat-cpu-bg); --device-ink: var(--cat-cpu-ink); }
```

The design canvas with the icon sheet, the drawing sheet and a mock-up of
canvas nodes using them (full and compact) is kept by the maintainer.
