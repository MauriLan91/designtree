# Task: describe this board

Acme First Board is a small board around a single-core SoC. Describe it in
DesignTree and build its devicetree blob (`.dtb`). Save the design as
`first-board.json` in your home folder.

| Part | What the schematic and the SoC manual say |
| --- | --- |
| Board | Model "Acme First Board", compatible `acme,first-board`. 32-bit addresses and sizes (one cell each). |
| CPU | One ARM Cortex-A7 (`arm,cortex-a7`), CPU number 0. |
| Memory | 512 MiB of DRAM at 0x4000_0000. |
| Clock | A 24 MHz crystal oscillator feeding the SoC (a fixed clock). |
| Interrupt controller | ARM GIC (`arm,cortex-a7-gic`): distributor at 0x01c8_1000 (4 KiB), CPU interface at 0x01c8_2000 (8 KiB). Interrupts are described with 3 cells. |
| UART | A 16550-compatible UART (`ns16550a`) at 0x01c2_8000, 1 KiB. Registers are 32 bits wide, 4 bytes apart. Clocked by the 24 MHz oscillator. Interrupt: shared peripheral interrupt 0, level high. The console runs on it at 115200 baud. |
| GPIO controller | An OpenCores GPIO block (`opencores,gpio`): data register at 0x01c2_0800, direction register at 0x01c2_0801, 1 byte each. GPIOs are described with 2 cells. |
| LED | A user LED on GPIO line 0, active high, off at boot. |

You are done when DesignTree has built the `.dtb`.

You may use the user guide, except the chapter "Tutorial: your first
board". Please think aloud while you work.
