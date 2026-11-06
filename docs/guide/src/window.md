# The window

![The DesignTree window](images/window.png)

- **Menu bar** at the top: File, Edit, View, Insert, Tools and Help hold
  every command, each with its shortcut; greyed-out items cannot run right
  now (no selection, say). Alt and the underlined letter opens a menu, the
  arrow keys move through it.
- **Toolbar** under it: New, Open and Save; Undo and Redo; Add empty node and
  Auto layout; the command search (Ctrl+K); and **Build .dtb** on the right.
  Hover a button for its name and shortcut.
- **Tabs** hold the open designs. A dot marks unsaved changes; closing a tab
  or the window with unsaved changes asks first.
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
