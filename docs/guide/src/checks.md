# Checks and problems

DesignTree checks a design at three levels while you edit.

- **Structure**: a missing or second root, a node with two parents or
  none, duplicate labels, references to nodes that do not exist. These block **Build .dtb** until fixed.
- **Schema check**: with a kernel checkout loaded, every node is checked
  against its binding schemas, like `make dtbs_check`: required properties,
  types, enums and constants, properties the schema does not allow, and
  conditions on the compatible. Problems are marked on the nodes and listed
  in the **Problems** tab of the bottom panel.
- **dtc**: warnings and errors from building the `.dtb` (see
  [Building the .dtb](building.md)).

Click a problem in a panel to select its node on the canvas.

The address map and interrupt views add their own checks: overlapping
`reg` regions and devices with no usable interrupt parent (see
[Views](views.md)).
