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

## The Problems tab

The **Problems** tab of the bottom panel lists every problem of the three
checks together; dtc's are there while the last build is of the design on
show. A vendor tree can have thousands, so the list is made to be worked
through:

- **Group** them **by rule** (problems of one kind together, such as
  `"…" is a required property`), **by node** (its path) or **by
  property**, each group with its count, largest first; or not at all.
  Click a group to open it.
- **Filter** by severity, by source (**Structure**, **Schema**, **dtc**,
  each with its count) and by text, which also matches the node path, the
  property and the binding.
- Properties no binding documents, usually vendor ones such as
  `qcom,msm-id`, are one class of their own at the end, **Undocumented
  vendor properties**, closed until you open it.
- Each row shows the node's path, the property and the binding or dtc
  check that reports it. A value written as bytes that reads as text is
  shown as text (`"okay"` rather than `[6f 6b 61 79 00]`).

The list draws only the rows in view, as does the Outline, so thousands of
problems or nodes scroll as smoothly as ten.

The address map and interrupt views add their own checks: overlapping
`reg` regions and devices with no usable interrupt parent (see
[Views](views.md)).
