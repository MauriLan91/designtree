# Views: interrupts, address map, board

## Interrupt tree

**View › Interrupt tree** (the Interrupts tab of the bottom panel) shows each interrupt controller with the devices wired to it,
following `interrupt-parent`, `interrupts` and `interrupts-extended`.
Devices without an interrupt parent, and interrupt specifiers that do not
fit their controller, are flagged.

## Address map

**View › Address map** (a tab of the bottom panel) shows the `reg` regions of each bus, translated to CPU
addresses through `ranges`, `#address-cells` and `#size-cells`. Overlapping
regions and regions outside their bus's ranges are highlighted.

## Board view

**View › Board view** is a second canvas over the same design, for where devices
sit on the PCB.

- **Background…** puts a board photo or a schematic export behind the
  devices; **Clear** removes it.
- Drag devices from **Not on the board** onto the board and place them as on
  the PCB. Selection is shared with the graph. Positions are saved in the
  design file and never reach the devicetree.
- **Connections** draws the links between placed devices: I²C and SPI buses,
  other buses, GPIOs, interrupts and other references, each with its own
  color and a checkbox to show or hide it. A link to a device that is not
  placed is drawn to its nearest placed ancestor.
- **Connectors** adds pin headers: the 40-pin Raspberry Pi layout, a
  mikroBUS socket, or a single- or dual-row header with any number of pins.
  Click a pin to name it, mark it as power or ground, and map it to a SoC pad
  (a GPIO line or a pinctrl group). Two devices claiming the same pad are
  flagged as a conflict.
