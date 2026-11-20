# Importing board files

**File › Import .dts…** opens existing devicetree source: a kernel board file, a
vendor BSP file or anything `dtc` accepts.

- `#include` of `.dtsi` files and `dt-bindings` headers is resolved, and C
  macros such as `GPIO_ACTIVE_LOW` and `IRQ_TYPE_LEVEL_HIGH` are expanded.
  Inside a kernel tree the kernel's include directories are found
  automatically.
- For safety, includes are only read from the file's own directory, its
  kernel tree and the include directories you configure; nothing else on
  the disk is opened.
- Labels, phandle references (`&x`, `<&x 1 2>`), `/delete-node/`,
  `/delete-property/` and `&label { }` overrides are all understood.
  References become reference edges.
- Parse errors show the file, line and column.

## Board files stay board files

A board file that includes a SoC `.dtsi` is kept as one. The included nodes
appear as [inherited](inspector.md#inherited-nodes), and exporting writes
the same includes followed by only your board's changes as overrides. An
unmodified import compiles to the same `.dtb` as the original, and the text
stays close to it, so your diffs stay small.

When a file cannot be layered (an include inside a node, or after the board
nodes), the design is imported flat instead.

## Decompiled trees

A tree decompiled from a `.dtb` (`dtc -I dtb -O dts`) has numbers where the
source had references: `clocks = <0x2f 0x01>;`. DesignTree turns them back
into references wherever the property is known to hold phandles:
`interrupt-parent`, `clocks`, `resets`, `dmas`, `*-gpios`, `*-supply`,
`pinctrl-N`, `interrupt-map` and the other standard ones, plus every
property the binding schemas type as a phandle when a kernel tree is
loaded. Each phandle list is split by the provider's `#*-cells`, so
`<0x2f 0x01 0x30>` becomes `<&gcc 1>, <&osc>` when `gcc` has one clock
cell and `osc` none. A value that does not fit stays as numbers.

- Labels come from the tree's `__symbols__` node; a referenced node without
  one gets a label made from its name (`gpio_1000`).
- `__symbols__`, `__fixups__` and `__local_fixups__` are hidden: building
  writes them again.
- `phandle` properties are hidden too. dtc numbers the nodes again when it
  builds; where it would number a node differently from the original blob
  (some value the editor does not know may hold that number), the node
  keeps its number, written as `phandle = <…>;` on export.
- Properties keep their order, so the rebuilt `.dtb` holds the same bytes
  as the original. Vendor blobs merged from overlays may list their
  `__symbols__` in another order; their content is the same.
