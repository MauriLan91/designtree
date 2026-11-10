# Building a design

**New** (Ctrl+N) starts an empty design with a root node `/`. Everything
else hangs below it.

## Nodes and the tree

Each node shows its label and name (`uart0: serial@10000000`), its first
compatible string and how many properties it has.

The canvas shows one level of the tree at a time, its **scope**. The main
canvas holds the root's children. Double-click a node that holds others
(`cpus`, `soc`, a bus, or any node that already has children) to open its
children in a scope tab; the breadcrumb under the tabs shows where you are
and takes you back up. Double-clicking any other node opens its properties
in the inspector. **View › Open selected node** and **View › Up one scope**
do the same from the keyboard or the command palette.

In the scope of an I²C, SPI or other bus controller, the controller is a
**bus bar** above its devices, with an edge to each labelled with its unit
address (`@48`). The bar and its edges are drawn from the tree: click the bar
to edit the controller, and change a device's address in the inspector.

A node you add, drop from the library or paste goes into the scope on show.
**Edit › Move selected node under…** moves it elsewhere in the tree.

## References

Phandle properties are edges from the consumer's **right** handle to the
provider's **left** handle. When the schemas know the node, its handles are
named ports: a UART shows `clocks`, a clock controller `clock`, a GPIO
controller `gpio`. Only matching ports connect, and the edge writes the
property (`clocks = <&osc24m>;`), with as many specifier cells as the
provider's `#clock-cells` asks for. Without a schema, the property name is
guessed from the target's `#…-cells` and can be edited in the inspector.

A reference to a node in another scope ends at a **boundary port** on the
canvas border, named by the node's label (`&osc24m`): on the right for nodes
this scope refers to, on the left for nodes elsewhere that refer into it.
Click a port to go to its node. To make a new reference to a node in another
scope, drag from the handle and drop on empty canvas, then pick the node;
drop on an existing port to reuse it.

Click an edge to edit it in the inspector: the property name, and the
specifier cells with names from the kernel's `dt-bindings` headers, such as
`GPIO_ACTIVE_LOW` or `IRQ_TYPE_LEVEL_HIGH`.

## Groups

Select nodes (Shift+drag selects an area) and choose **Edit › Group selection** (Ctrl+G) to
frame them, for example "SoC peripherals". Groups are only visual and never
reach the devicetree. The triangle in a group's header collapses it into a
block, like a Simulink subsystem: edges that cross its border become ports
on the block. **Edit › Ungroup** (Ctrl+Shift+G) removes the frame.

## Layout

The **Arrange** menu tidies the canvas in one step; every command is one
undo.

- **Tidy this canvas** (Ctrl+L, also in the toolbar) lays out the level on
  show in columns along the references, left to right the way a devicetree
  reads: a device left of the clocks and interrupt controller it uses. A
  reference to the next column then turns at right angles in the gap
  between them, each at its own place, the gap widening so they stay
  apart; one that skips a column or points back stays a curve. Nodes with no reference on this
  level go in rows below. The view then fits the result.
- **Tidy the selection** (Ctrl+Shift+L) does the same for the selected
  nodes only, from where the selection starts, and leaves the rest alone.
- **Lay out the whole tree** arranges every node of the design from the
  root down, with a group for each bus; references go back to curves. Imported designs are laid out this way on import.
- **Align** left, centre, right, top, middle or bottom lines up the selected
  nodes (two or more); **Distribute horizontally** or **vertically** spaces
  three or more evenly between the outer two.

**View › Fit the design in view** frames everything on show. Positions and
the places where references turn are saved in the design file. Moving a
node keeps its references at right angles while the turn is still between
the two ends, and draws them as curves past that; tidying again redraws
them. Pasted references start as curves.

## Saving

**Save** (Ctrl+S) writes the design file (`.json`) it was opened from or
last saved to, and asks for a file only the first time. **Save as…**
(Ctrl+Shift+S) always asks, and the new file becomes the design's. File
dialogs start in the folder of the design's file, or of the last file you
picked. **Export .dts…** writes
the devicetree source: kernel style, tabs, a blank line between properties
and subnodes, imported nodes in their original order.
