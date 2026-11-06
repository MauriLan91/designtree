# Tutorial: your first board

This tutorial builds a minimal board from an empty canvas to a `.dtb`: a
CPU, memory, a clock, an interrupt controller with a UART, and an LED on a
GPIO. It takes about 15 minutes. Each step ends with a checkpoint design in
`examples/` (installed in `/usr/share/designtree/examples` by the Arch
package); open it with **File › Open design…** to compare, or to start from that step.

You need a kernel checkout loaded under **Tools › Kernel checkouts…** (see
[Kernel checkouts](library.md)) and `dtc` installed.

Properties that have no field of their own go in the inspector's
**Properties** box, one `name = value` per line (`reg = <0x40000000
0x20000000>`), or straight into the DTS source panel.

Nodes the kernel's schemas do not describe (`cpus`, `memory`, `chosen`,
`aliases`, the LED itself) are added with **+ Empty node** and named in the
inspector. Everything else comes from the library search.

## 1. The root and the CPU

1. **New** (Ctrl+N). Select the root node `/`.
2. In the inspector, set **Compatible** to `acme,first-board` and add
   `model = "Acme First Board"` to its properties. The root already has
   `#address-cells = <1>` and `#size-cells = <1>`.
3. **+ Empty node**, name it `cpus`, and wire it under the root (root's
   bottom handle to its top handle). Give it `#address-cells = <1>` and
   `#size-cells = <0>`.
4. Search the library for `cortex-a7` and add the CPU. Wire it under `cpus`,
   name it `cpu` with unit address `0`, and set `device_type = "cpu"` and
   `reg = <0>`.

Checkpoint: `first-board-1-cpu.json`.

## 2. Memory

1. **+ Empty node** under the root, named `memory`.
2. Set the unit address to `40000000`, and the properties
   `device_type = "memory"` and `reg = <0x40000000 0x20000000>` (512 MiB at
   0x40000000).

Checkpoint: `first-board-2-memory.json`.

## 3. A clock

1. Search for `fixed-clock` and add it under the root, named `oscillator`
   with the label `osc24m`.
2. Its required properties come pre-filled: set `clock-frequency` to
   `24000000` and keep `#clock-cells = <0>`.

Checkpoint: `first-board-3-clock.json`.

## 4. Interrupt controller and UART

1. Search for `cortex-a7-gic`, add it under the root as
   `interrupt-controller@1c81000` with the label `gic`. Set
   `reg = <0x01c81000 0x1000>, <0x01c82000 0x2000>` and
   `#interrupt-cells = <3>`; `interrupt-controller` is a toggle.
2. Search for `ns16550a`, add it under the root as `serial@1c28000` with the
   label `uart0`, and set `reg = <0x01c28000 0x400>`, `reg-shift = <2>`,
   `reg-io-width = <4>`.
3. Wire the UART's `clocks` port to the oscillator, and its
   `interrupt-parent` port to the interrupt controller.
4. Set `interrupts = <0 0 4>` on the UART: shared peripheral interrupt
   (`GIC_SPI` is 0) number 0, level high (`IRQ_TYPE_LEVEL_HIGH` is 4), the
   three cells `#interrupt-cells` asks for.
5. So that the kernel prints to this UART: add empty nodes `aliases` with
   `serial0 = &uart0`, and `chosen` with `stdout-path = "serial0:115200n8"`.

**View › Interrupt tree** should now show the UART under `gic`.

Checkpoint: `first-board-4-uart.json`.

## 5. An LED on a GPIO

1. Search for `opencores,gpio`, add it under the root as `gpio@1c20800`
   with the label `gpio`, and set `reg = <0x01c20800 0x1>, <0x01c20801 0x1>`
   and `reg-names = "dat", "dirout"`. `gpio-controller` is a toggle and
   `#gpio-cells` is `2`.
2. Search for `gpio-leds` and add it under the root, named `leds`.
3. **+ Empty node** under `leds`, named `led-0`, with
   `default-state = "off"`.
4. Wire the LED's right handle to the GPIO controller: the property becomes
   `gpios`. Click the new edge and, in the specifier editor, set line `0`
   and pick `GPIO_ACTIVE_HIGH` (the names come from the kernel's
   `dt-bindings` headers).

Checkpoint: `first-board-5-led.json`.

## 6. Check and build

- The **Schema check** panel should be empty. If it lists something, click
  the problem to jump to the node, and compare with the checkpoint.
- **View › Address map** shows the four devices on the root bus with no overlaps.
- **File › Save design…** (Ctrl+S), then **Build .dtb** (Ctrl+B): `board.dtb` appears
  next to `board.json`, and the Build panel shows no warnings.

You have a devicetree that the kernel can boot with. From here, try
**View › Board view** to place the devices on a photo of your board, or
**File › Export .dts…** to see the source in kernel style.
