# Command line

The `designtree` command (installed with the Arch package, or
`cargo build --release -p designtree-cli`) works on the same files as the
app, for scripts and CI. `designtree <command> --help` describes the options.

| Command | Does |
| --- | --- |
| `import board.dts -o board.json` | Import devicetree source into a design (`--linux <tree>`, `-I <dir>` for includes) |
| `export board.json` | Write devicetree source; a layered import becomes a board file again, `--flatten` writes the whole tree |
| `validate board.json` | Structural checks |
| `check board.json --linux <tree>` | Schema check like `make dtbs_check`; also takes `.dts` and `.dtb` |
| `overlay base.json -o overlay.json` | Start an overlay against a design or a `.dts` |
| `interrupts board.json` | Print the interrupt tree and its problems |
| `address-map board.json` | Print the address map, overlaps and unmapped regions |
| `pins board.json` | Print connector pins and who claims them; fails on a conflict |
| `layout board.json -o board.json` | Auto layout |
| `index <tree> -o catalog.json` | Build the element library from a kernel tree (`--stats` for counts) |
| `bench` | Time the backend on a generated 1,000-node board |

A typical CI step for a board kept as a design file:

```sh
designtree validate board.json
designtree check board.json --linux ~/linux
designtree export board.json > board.dts
dtc -I dts -O dtb -o board.dtb board.dts
```

The export of a layered board file still has its `#include` lines; build
it like the kernel does (`cpp`, then `dtc`), or export with `--flatten`.
