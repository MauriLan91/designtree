# Settings

**File › Settings…** (Ctrl+,) opens the settings. Pick a section on the left,
or type in the search box to find a setting by name in every section. Changes
apply at once; there is nothing to save.

| Section | What it holds |
| --- | --- |
| General | Theme: System (follows the desktop), Light or Dark. |
| Editor | The mode new tabs open in (Graph, Split or DTS); **Reset layout** puts the panes back to their first-start sizes. |
| Kernel | The kernel checkouts the library can be built from: add, use or remove one (also **Tools › Kernel checkouts…**). |
| Build | The dtc program: **Choose…** one that is not in `PATH`, or **Use PATH** again. The version found is shown. |
| Shortcuts | Every command with its shortcut. Click one and press the new keys; Backspace removes it, Escape keeps the old one, **Reset** goes back to the default. A shortcut used twice is flagged. Undo, Redo and the command palette keep theirs. |
| Updates | The daily check for a new release, and **Check now**. |

The settings are a JSON file in the app's configuration directory
(`~/.config/io.github.maurilan91.designtree/settings.json` on Linux). It can be
edited by hand; anything the app does not recognise falls back to its default.
Pane sizes are kept separately, per user, in the app's local storage.
