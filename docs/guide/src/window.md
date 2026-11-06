# The window

![The DesignTree window](images/window.png)

- **Tabs** at the top hold the open designs. A dot marks unsaved changes;
  closing a tab or the window with unsaved changes asks first.
- **Toolbar**: New, New from SoC…, New overlay…, Open…, Import .dts…, Save…,
  Export .dts…, Build .dtb, Kernels…, dtc path…, and the views Interrupts,
  Address map and Board view. The second row has Commands… (the command
  palette), Undo, Redo, Auto layout, Group and Ungroup.
- **Library** (left): the elements of the loaded kernel checkout, with
  search, categories, favorites and recent elements.
- **Canvas** (middle): the devicetree as a graph. Zoom with the mouse wheel
  or the buttons at the bottom left; the minimap at the bottom right shows
  where you are.
- **Inspector** (right, top): the selected node, reference or group.
- **DTS source** (right, bottom): the devicetree source of the design,
  editable, kept in sync with the canvas. Under it, the Schema check and
  Build panels list problems when there are any.

To open a design at start, pass its path: `designtree-app board.json`.
