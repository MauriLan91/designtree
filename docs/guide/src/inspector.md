# The inspector

Select a node to edit it in the inspector.

- **Name**, **Unit address**, **Label** and **Compatible** (strings separated by spaces, most specific first)
  come first.
- **Properties**: a table with a **Key**, a **Type** and a **Value** column,
  one row per property, edited the same way whatever the value holds.
  Clearing a value removes the property.
  - Rows with several parts (cell arrays such as `reg`, string lists, bytes)
    have an arrow that opens one child row per item. Edit an item in place,
    remove it with its ×, or add one with **Add cell**. A cell takes a number,
    a `&label` reference or a `dt-bindings` name such as `GIC_SPI`; names are
    suggested as you type when the kernel bindings are loaded.
  - With a kernel checkout loaded, the binding fixes the type of the
    properties it describes. An enum is a dropdown, a single number one
    field, and a boolean a checkbox: untick it to remove the property. Hover a key for the schema's description; values outside the
    schema's limits get a warning under the row.
  - The binding's required properties, marked with `*`, are always on top
    and cannot be removed. One without a value is an empty to-do row: type
    its value to add it, or press ↺ to take the binding's default. ↺ on a
    filled one resets it to the default, or empties it when there is none.
    A required phandle, such as `resets`, is set by connecting the node on
    the canvas. The **Text** mode lists the required properties not set yet
    under the text.
  - **Add a property…** offers the binding's optional properties as you
    type, with their type and description.
  - For a property the schema does not describe, pick the type yourself:
    Boolean, String, String list, Cells, Bytes, Reference or Mixed.
    Changing it keeps what can be kept, so cells become bytes and back.
  - A **Reference** names a node by its label, picked from a list, and is
    written as `&label` (the DTS turns it into the node's path). Under
    `aliases` every property is one. Renaming the label updates it.
  - References drawn on the canvas (`clocks`, `interrupt-parent`, `gpios`)
    are rows of type **Phandle**; open one to edit the specifier cells of
    each target.
  - **Text** switches to the raw mode: every property as `name = value`,
    one per line, as in the DTS. It reads values as the DTS source panel
    does, so `<0x1000 0x100>, <0x2000 0x100>`, `&uart0` and `<&gic 0 4>`
    are accepted and `010` is octal; the `;` is optional. A `compatible`
    line goes to the **Compatible** field. **Table** switches back.

Select a reference edge to change its property name and specifier cells;
select a group to rename it.

## Inherited nodes

After importing a board file, nodes defined in an included `.dtsi` have a
dashed border and show the file they come from. They are read-only so that
an accidental edit does not change the SoC: press **Override** to edit one.
Its changes are exported as a `&label { }` block in your board file, and
deleting it exports `/delete-node/`. Inherited nodes cannot move to another
parent.
