# GUI options

The backend is Rust; the front end must offer a node-graph canvas with
panning, zoom, wiring, grouping and a searchable palette of thousands of
elements.

| Option | Node editor | Strengths | Weaknesses |
| --- | --- | --- | --- |
| **Tauri 2 + React Flow** (or Svelte Flow) | React Flow / xyflow, mature, used by many n8n-like tools | Best-in-class node UX (groups, subflows, minimap, edge routing) out of the box; huge web ecosystem for property panels and search; small binaries compared with Electron | Two languages (Rust + TypeScript); depends on the system webview |
| **egui + egui-snarl** | egui-snarl or egui_node_graph | Pure Rust, single binary, also runs in the browser via WASM; very fast to iterate | Immediate-mode look; grouping, auto-layout and polish need to be built by hand |
| **Slint** | none built in | Declarative UI, good for embedded targets, pure Rust | Node canvas must be written from scratch; GPLv3/royalty-free licensing terms to check |
| **Iced** | community crates only (iced_node_editor, immature) | Elm architecture, pure Rust | Least ready for node editing today |

**Recommendation:** Tauri 2 with React Flow. A node editor in the style of
n8n is the core of the product, and React Flow already solves the hard parts
(grouping/subflows, selection, connection validation, minimap). The Rust
crates stay independent of the GUI, so switching to egui later only means
writing a new front end.
