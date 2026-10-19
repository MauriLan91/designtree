# Architecture

DesignTree keeps all domain logic in Rust and treats the GUI as a thin,
replaceable layer.

```
 kernel source ──► designtree-bindings ──► Catalog (element library, JSON)
                                                │
                                                ▼
   GUI canvas  ◄──── JSON ────►  designtree-core ──► .dts
  (to be chosen)              Graph · validate · to_dts
```

## designtree-core

- `Graph` is the project file: nodes, edges and groups, serialized as JSON.
- Edges are either `child` (hierarchy) or `reference` (phandle property with
  optional specifier cells). Keeping the hierarchy as edges lets the canvas
  show both the tree and the cross-references as wires.
- `validate` returns every structural problem (missing root, detached nodes,
  cycles, duplicate labels, references to unlabeled nodes) so the editor can
  highlight them all at once.
- `to_dts` emits devicetree source from a valid graph.
- Canvas positions and groups are stored but never affect the output.

## designtree-bindings

Walks `Documentation/devicetree/bindings/**/*.yaml` and extracts, per schema:
category (first directory), title, compatible strings (from `const`, `enum`,
`items`, `oneOf`, ...), and properties with their description and whether
they are required. Files that fail to parse are listed in `skipped` instead of
aborting the run.

## Boundary with the GUI

The GUI only needs three operations, all JSON in and out:

1. load the catalog (palette of elements, searchable by category/compatible);
2. edit a `Graph` and ask for `validate` on change;
3. ask for `to_dts` to preview or save the output.

With Tauri these become `#[tauri::command]` functions; with a native Rust
toolkit the GUI calls the crates directly.

## Next steps

- DTS import (parse existing `.dts`/`.dtsi` into a graph, including `#include`).
- Property editor driven by the schema types (`$ref` to `/schemas/types.yaml`).
- Schema validation of node properties against the catalog.
- `dtc` integration to produce `.dtb` and catch compiler errors.
