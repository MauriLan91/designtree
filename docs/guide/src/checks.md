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

## Errors and warnings

Every problem is an **error** or a **warning**, so that you fix first what
breaks the tree.

- **Errors** (a red round mark) make the tree wrong: a structural error, a
  value of the wrong type or length, a value or node name the binding
  forbids, a missing required property, a `dtc` error.
- **Warnings** (an amber triangle) are suspect but build: a property or a
  child node the binding does not document, a vendor property no binding
  types, a deprecated compatible, property or binding, a node placed under
  a bus it does not fit, a `dtc` warning, a binding the check cannot use.

The two marks are the same everywhere: in the Problems tab, on the node
cards (a red border for errors, amber for warnings only, with the count of
each), in the Outline (a collapsed branch shows the worst problem below it,
dimmed) and in the status bar, which counts each. `designtree check`
prints the severity of each problem, `--json` gives it as `"severity"`,
and the command only fails on errors.

## The Problems tab

The **Problems** tab of the bottom panel lists every problem of the three
checks together; dtc's are there while the last build is of the design on
show. A vendor tree can have thousands, so the list is made to be worked
through:

- **Group** them **by rule** (problems of one kind together, such as
  `"…" is a required property`), **by node** (its path) or **by
  property**, each group with its count; groups with errors first, then
  the largest. Errors come before warnings in a group; not grouping at all
  keeps that order too.
  Click a group to open it.
- **Filter** by severity, by source (**Structure**, **Schema**, **dtc**,
  each with its count) and by text, which also matches the node path, the
  property and the binding.
- Properties no binding documents, usually vendor ones such as
  `qcom,msm-id`, are one class of their own at the end, **Undocumented
  vendor properties**, closed until you open it.
- The list follows what you are looking at: on the canvas, the problems
  of the open scope and the nodes below it; in the **DTS** mode, those of
  the nodes the text writes; in the board view, those of the devices
  placed on the board. (In the split mode the canvas decides.) Problems
  about no node in particular are always listed. The line above the list
  says what it covers and how many problems lie outside it; click that
  count, or press **Whole design**, to list them all. The tab's count
  follows the list, while the status bar always counts the whole design.
- Each row shows the node's path, the property and the binding or dtc
  check that reports it. A value written as bytes that reads as text is
  shown as text (`"okay"` rather than `[6f 6b 61 79 00]`).

The list draws only the rows in view, as does the Outline, so thousands of
problems or nodes scroll as smoothly as ten.

The address map and interrupt views add their own checks: overlapping
`reg` regions and devices with no usable interrupt parent (see
[Views](views.md)).
