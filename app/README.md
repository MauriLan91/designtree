# DesignTree desktop app

Tauri 2 shell (`src-tauri/`, Rust) around the DesignTree crates, with a
React + [React Flow](https://reactflow.dev) canvas (`src/`).

## Prerequisites

- Rust (stable) and Node.js 20+
- Tauri system dependencies, see <https://tauri.app/start/prerequisites/>
  (on Debian/Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`)

## Run

```sh
npm install
npm run tauri dev     # desktop app with hot reload
npm run tauri build   # release bundle
```

## Layout

| Path | Content |
| --- | --- |
| `src-tauri/src/lib.rs` | Tauri commands: load kernel bindings, search, validate, export, open/save |
| `src/model.ts` | Design types (mirror of `designtree-core`) and canvas conversion |
| `src/backend.ts` | Typed wrappers around the Tauri commands |
| `src/components/` | Palette, canvas node, inspector, DTS preview |

## Canvas conventions

- Bottom handle → top handle: child node (devicetree hierarchy).
- Right handle → left handle: phandle reference (`clocks = <&osc>;`). The
  property name is guessed from the target's `#...-cells` and can be edited.
- Select nodes and press **Group** to create a visual group.
- Nodes from an included `.dtsi` (after **Import .dts…** of a board file)
  have a dashed border and show their file. They are read-only until you
  press **Override** in the inspector; their changes, and deleting them,
  are exported as `&label { }` overrides and `/delete-node/` in the board
  file. They cannot be moved to another parent.
