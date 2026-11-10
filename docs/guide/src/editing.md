# Editing faster

## Undo and redo

Every change can be undone: nodes, edges, properties, groups, layout and
text edits. Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes, at least 200 steps
back.

## Copy and paste

Ctrl+C copies the selected nodes with their subtrees; Ctrl+V pastes them
under the selected node, also into another tab. Labels are renamed when they
would clash, and references between copied nodes are kept.

## Tabs

Each design has its own tab with its own undo history. Ctrl+Tab and
Ctrl+Shift+Tab switch tabs, Ctrl+W closes one, middle-click closes the tab
under the mouse.

## Snap to grid

**View › Snap to grid**, the grid button in the toolbar or Ctrl+' makes
nodes snap to a grid while you drag them, and the canvas shows the grid
lines. The grid size is in **Settings › Editor**; both are remembered.

## Command palette

The search box in the toolbar, **View › Command palette…** or Ctrl+K opens the
command palette: type part of a command and press Enter. It has every command
of the menus, and adds elements of the library by name. Commands that need a
second node, like **Insert › Reference from selected node to…** and **Edit ›
Move selected node under…**, ask for it there.

## Keyboard shortcuts

F1 lists them in the app.

| Keys | Action |
| --- | --- |
| Ctrl+K | Command palette |
| Ctrl+N | New design |
| Ctrl+O | Open design |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save as |
| Ctrl+B | Build .dtb |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z, Ctrl+Y | Redo |
| Ctrl+C / Ctrl+V | Copy / paste nodes |
| Ctrl+G | Group selection |
| Ctrl+Shift+G | Ungroup |
| Ctrl+L | Tidy this canvas |
| Ctrl+Shift+L | Tidy the selection |
| Ctrl+' | Snap to grid on or off |
| Ctrl+Tab | Next tab (Ctrl+Shift+Tab: previous) |
| Ctrl+W | Close the tab |
| Delete | Delete the selection, child nodes included |
| Shift+drag | Select an area |
| F1 | Keyboard shortcuts |
