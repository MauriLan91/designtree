# Introduction

DesignTree is a graphical editor for Linux devicetrees. Instead of writing
`.dts` files by hand, you place nodes on a canvas, wire them together and
group them, in the style of node editors such as n8n or Simulink. The
result is ordinary devicetree source in kernel style, and a `.dtb` built
with `dtc`.

The element library is not bundled: it is built from the binding schemas
(`Documentation/devicetree/bindings`) of a Linux kernel checkout on your
machine, so it always matches the kernel you target.

| On the canvas | In the devicetree |
| --- | --- |
| Node | A node (`serial@10000000`) with its compatible strings and properties |
| Child edge (bottom to top handle) | The parent/child relation |
| Reference edge (right to left handle) | A phandle property, such as `clocks = <&osc24m>;` |
| Group | Visual grouping only, like a Simulink subsystem; no effect on the output |

DesignTree is made for two kinds of work:

- **Board bring-up**: start from a SoC `.dtsi` of the kernel and describe what
  your board adds, with the board view next to the schematic.
- **BSP maintenance**: open existing board files, change them on the canvas
  or in the text, and export them with small diffs: the includes stay, and
  your changes become `&label { }` overrides.

Design files are JSON (`.json`). They hold the tree, the canvas layout, the
board view and the kernel version the design was built against. Devicetree
source is an export, not the file you save.
