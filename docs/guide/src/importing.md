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
