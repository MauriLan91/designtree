# The inspector

Select a node to edit it in the inspector.

- **Name**, **Unit address**, **Label** and **Compatible** (comma separated)
  come first.
- **Binding properties**: with a kernel checkout loaded, the properties of
  the node's schema, required ones first and marked with `*`. Each has an
  input for its type: a dropdown for an enum, a toggle for a boolean, a
  number list for a cell array, text for strings. Hover a property for the
  schema's description. Required properties without a value are marked as
  to-do.
- **Other properties** (or **Properties** without a schema): anything the schema does not describe stays
  editable as raw devicetree values, so nothing is lost.

Select a reference edge to change its property name and specifier cells;
select a group to rename it.

## Inherited nodes

After importing a board file, nodes defined in an included `.dtsi` have a
dashed border and show the file they come from. They are read-only so that
an accidental edit does not change the SoC: press **Override** to edit one.
Its changes are exported as a `&label { }` block in your board file, and
deleting it exports `/delete-node/`. Inherited nodes cannot move to another
parent.
