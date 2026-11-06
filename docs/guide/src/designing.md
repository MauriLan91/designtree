# Building a design

**New** (Ctrl+N) starts an empty design with a root node `/`. Everything
else hangs below it.

## Nodes and the tree

Each node shows its label and name (`uart0: serial@10000000`), its first
compatible string and how many properties it has. To put a node under
another one, drag from the parent's **bottom** handle to the child's **top**
handle; a node has one parent. **Move selected node under…** in the command
palette does the same from the keyboard.

## References

Phandle properties are edges from the consumer's **right** handle to the
provider's **left** handle. When the schemas know the node, its handles are
named ports: a UART shows `clocks`, a clock controller `clock`, a GPIO
controller `gpio`. Only matching ports connect, and the edge writes the
property (`clocks = <&osc24m>;`), with as many specifier cells as the
provider's `#clock-cells` asks for. Without a schema, the property name is
guessed from the target's `#…-cells` and can be edited in the inspector.

Click an edge to edit it in the inspector: the property name, and the
specifier cells with names from the kernel's `dt-bindings` headers, such as
`GPIO_ACTIVE_LOW` or `IRQ_TYPE_LEVEL_HIGH`.

## Groups

Select nodes (Shift+drag selects an area) and press **Group** (Ctrl+G) to
frame them, for example "SoC peripherals". Groups are only visual and never
reach the devicetree. The triangle in a group's header collapses it into a
block, like a Simulink subsystem: edges that cross its border become ports
on the block. **Ungroup** (Ctrl+Shift+G) removes the frame.

## Layout

**Auto layout** (Ctrl+L) arranges the tree from the root down, with a group
for each bus. Imported designs are laid out on import. Positions are saved in
the design file.

## Saving

**Save…** (Ctrl+S) writes the design file (`.json`). **Export .dts…** writes
the devicetree source: kernel style, tabs, a blank line between properties
and subnodes, imported nodes in their original order.
