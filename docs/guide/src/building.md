# Building the .dtb

**Build .dtb** (Ctrl+B) compiles the design with `dtc`. A saved design is
built next to its file (`board.json` → `board.dtb`, an overlay to `.dtbo`);
an unsaved one asks where to write it.

`dtc` is taken from `PATH`. If it is elsewhere, set it in **Settings › Build** (also **Tools › Set dtc path…**), where it is remembered,
or start the app with `DESIGNTREE_DTC=/path/to/dtc`. When `dtc` is missing,
the Build tab of the bottom panel says so.

The **Build** panel lists `dtc`'s errors and warnings. Those about a node are
attached to it on the canvas; click one to select the node. `dtc` runs
without a shell and reads the source from standard input.
