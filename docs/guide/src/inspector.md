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
    suggested as you type when the kernel bindings are loaded. A cell
    property holding one number, such as `#address-cells = <1>`, is a single
    field with no arrow, unless its binding declares a list; type a second
    number after the first to make it a list.
  - A cell list made of entries opens one row per entry instead, with a
    field for each cell: `reg` and `ranges` take their entry size from
    `#address-cells` and `#size-cells`, `interrupts` from the interrupt
    parent's `#interrupt-cells`, other properties from the binding. **Add
    entry** appends one of zeros. The row itself reads and takes the groups
    as in the source, `<0x1c81000 0x1000>, <0x1c82000 0x2000>`, and the DTS
    source writes `reg`, `ranges` and `interrupts` the same way. Warnings
    about the number of items count entries.
  - Long values stay readable. A byte array opens as a hex grid, 16 bytes
    per line with the offset on the left and the bytes as text on the
    right; type a line's bytes as hex pairs (it may get more or fewer), or
    use the empty last line to add bytes. A list of more than 64 items or
    entries shows them 64 at a time, with arrows to the other pages. A
    long string gets a box of several lines; Enter applies it and
    Shift+Enter breaks the line. Under each row's type is the size of its
    value in the blob.
  - A node with more than 100 properties shows the first 100, with
    **Show N more properties** under them.
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
  - A row holding numbers has a **Dec**, **Hex** or **Oct** selector under
    its type: the numbers are shown, and written to the DTS, in that base.
    Addresses (`reg`, `ranges`) start in hex and everything else in
    decimal; an imported file keeps the base each property was written in.
    A value can be typed in any base (`24000000`, `0x16e3600`, `0644`).
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
