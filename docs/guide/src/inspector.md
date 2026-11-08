# The inspector

Select a node to edit it in the inspector.

- **Name**, **Unit address**, **Label** and **Compatible** (comma separated)
  come first.
- **Properties**: a table with a **Key**, a **Type** and a **Value** column,
  one row per property, edited the same way whatever the value holds.
  - Rows with several parts (cell arrays such as `reg`, string lists, bytes)
    have an arrow that opens one child row per item. Edit an item in place,
    remove it with its ×, or add one with **Add cell**. A cell takes a number,
    a `&label` reference or a `dt-bindings` name such as `GIC_SPI`; names are
    suggested as you type when the kernel bindings are loaded.
  - With a kernel checkout loaded, the binding fixes the type of the
    properties it describes and lists the missing ones under **Add a
    property…**. Required properties are marked with `*`, and those still
    without a real value are marked as to-do. An enum is a dropdown and a
    boolean a checkbox. Hover a key for the schema's description; values
    outside the schema's limits get a warning under the row.
  - For a property the schema does not describe, pick the type yourself:
    Boolean, String, String list, Cells, Bytes or Mixed. Changing it keeps
    what can be kept, so cells become bytes and back.
  - References drawn on the canvas (`clocks`, `interrupt-parent`, `gpios`)
    are rows of type **Phandle**; open one to edit the specifier cells of
    each target.
  - **Text** switches to the raw mode: every property as `name = value`,
    one per line, as in the DTS. **Table** switches back.

Select a reference edge to change its property name and specifier cells;
select a group to rename it.

## Inherited nodes

After importing a board file, nodes defined in an included `.dtsi` have a
dashed border and show the file they come from. They are read-only so that
an accidental edit does not change the SoC: press **Override** to edit one.
Its changes are exported as a `&label { }` block in your board file, and
deleting it exports `/delete-node/`. Inherited nodes cannot move to another
parent.
