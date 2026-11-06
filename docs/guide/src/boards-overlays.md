# Boards from a SoC and overlays

## New board from a SoC

**New from SoC…** lists the SoC `.dtsi` files of the loaded kernel tree,
filterable by architecture and vendor. Pick one and the new design includes
it: the SoC's nodes are [inherited](inspector.md#inherited-nodes), and you
only add and override what your board has, as in a kernel board file.

## Overlays

**New overlay…** starts an overlay (`.dtso`) against a base: a design file
or a board `.dts`. Every node of the base is inherited. Add nodes and
override base nodes as usual; the export is `/plugin/` source with one
`&label { }` fragment per changed node, and **Build .dtb** produces a
`.dtbo`.

The DTS source panel switches between **Overlay**, the overlay source, and
**Applied**, the base with the overlay applied, to check the result. Some
changes cannot be expressed by an overlay (deleting a base node, for
example); they are reported as problems. The overlay's source is read-only
in the editor.
