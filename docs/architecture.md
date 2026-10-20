# Architecture

DesignTree keeps all domain logic in Rust and treats the GUI as a thin,
replaceable layer.

```
 kernel source ──► designtree-bindings ──► Catalog (element library, JSON)
                                                │
                                                ▼
   Tauri app   ◄──── JSON ────►  designtree-core ◄──► .dts
 (React Flow)                 Graph · validate · to_dts · import_dts
```

## designtree-core

- `Graph` is the project file: nodes, edges and groups, serialized as JSON.
- Edges are either `child` (hierarchy) or `reference` (phandle property with
  optional specifier cells). Keeping the hierarchy as edges lets the canvas
  show both the tree and the cross-references as wires.
- `validate` returns every structural problem (missing root, detached nodes,
  cycles, duplicate labels, references to unlabeled nodes) so the editor can
  highlight them all at once.
- `to_dts` emits devicetree source from a valid graph. For a design
  imported from a board file with includes it writes a board file: the
  include directives (with the board's `#define`s), `/delete-node/` for
  deleted inherited nodes, then only the differences from the included
  definitions as `&label { }` overrides (`/ { }` for the root, nested blocks
  for unlabeled nodes). `to_dts_flat` always writes the whole tree.
- `import_dts` turns devicetree source into a graph in three stages:
  `preprocess` does what the kernel's `cpp` run does (`#include`, macros,
  `#if`, dtc's `/include/`) in-process, writing line markers so positions
  stay in the original files; `parse` builds a document that mirrors the
  source (root blocks, `&label { }` overrides and deletions stay separate
  items, every item keeps its file, line and column); `import` merges it into
  one tree with dtc semantics. Phandle lists (`clocks = <&a 1>, <&b 2>;`)
  become reference edges; values that do not fit the simple types
  (`/bits/ 64`, strings mixed with cells, path references, phandles in the
  middle of a cell list) are kept exactly as `mixed` values. Node ids are
  node paths. Include directories come from `ImportOptions`; inside a kernel
  tree the kernel's `scripts/dtc/include-prefixes` is found automatically.
  Every item's file decides where it belongs: nodes created by included
  files are marked `inherited` and keep their included definition
  (properties and labels), which is what export diffs against. When that
  layering cannot be expressed as overrides (an include inside a node, or
  an include after the board's nodes that fills them in, as Allwinner PMIC
  files do), the import is flat: no includes, nothing inherited.
- `tests/g1_corpus.rs` measures goal G1: it imports and exports the board
  files listed in `tests/corpus/g1.txt` and compares them, through `dtc`,
  with what the kernel build compiles (needs a kernel tree, `cpp`, `dtc`).
  Both the board export (built next to the original) and the flat export
  are checked.
- Canvas positions and groups are stored but never affect the output.

## designtree-bindings

Walks `Documentation/devicetree/bindings/**/*.yaml` and extracts, per schema:
category (first directory), title, compatible strings (from `const`, `enum`,
`items`, `oneOf`, ...), and properties with their description, whether they
are required, their type and their constraints (`enum`, `default`,
`minimum`/`maximum`, `minItems`/`maxItems`). Files that fail to parse are
listed in `skipped` instead of aborting the run.

Types are the definitions of dt-schema's `types.yaml` (`uint32`,
`phandle-array`, `string-array`, ...) plus `node` for child nodes. The kernel
tree does not contain the dt-schema core schemas that bindings refer to
(`/schemas/types.yaml`, `/schemas/clock/clock.yaml`, `/schemas/dt-core.yaml`),
so a pinned copy is embedded at build time from
`crates/designtree-bindings/dtschema`. A property's type is looked up in this
order, taking the first schema that states one:

1. its definition in the binding, following `$ref`, `allOf`, `oneOf` and
   `anyOf`;
2. the schemas the binding includes through a top-level `$ref` or `allOf`;
3. any other definition of the same name in the kernel or core schemas,
   like dt-schema's own property type database (`reset-gpios: true` is
   typed this way);
4. the pattern properties of the core schemas that apply to every node
   (`-gpios$`, `-microvolt$`, `^#.*-cells$`).

Only when none states a type is one guessed from listed values or bounds.
Constraints come from steps 1, 2 and the generic core schemas, never from an
unrelated binding. `designtree index --stats` reports the share of schemas
indexed and of properties typed (backlog goal G2).

## Boundary with the GUI

The GUI only needs three operations, all JSON in and out:

1. load the catalog (palette of elements, searchable by category/compatible);
2. edit a `Graph` and ask for `validate` on change;
3. ask for `to_dts` to preview or save the output.

These are `#[tauri::command]` functions in `app/src-tauri/src/lib.rs`. The
TypeScript mirror of the model lives in `app/src/model.ts` and must be kept in
sync with `designtree-core` (generating it with `ts-rs` or `specta` is a
candidate next step).

## Next steps

- Property editor driven by the schema types (`$ref` to `/schemas/types.yaml`).
- Schema validation of node properties against the catalog.
- `dtc` integration to produce `.dtb` and catch compiler errors.
