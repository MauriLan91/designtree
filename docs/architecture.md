# Architecture

DesignTree keeps all domain logic in Rust and treats the GUI as a thin,
replaceable layer.

```
 kernel source ──► designtree-bindings ──► Catalog (element library, JSON)
                         ▲   Checker (schema validation)
                         │ .dtb         │
                         │              ▼
   Tauri app   ◄──── JSON ────►  designtree-core ◄──► .dts
 (React Flow)                 Graph · validate · to_dts · to_dtb · import_dts
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
- `to_dtb` writes the blob dtc would compile from `to_dts_flat`, without
  dtc: phandles assigned to referenced nodes, path references expanded,
  unreferenced `/omit-if-no-ref/` nodes dropped, with the path of each node.
  It feeds schema validation; the G1 corpus checks it against dtc.
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

### Schema validation

`Checker` validates a devicetree blob the way `make dtbs_check` does, by
porting dt-schema's pipeline rather than inventing one, so that both report
the same errors (goal G3):

1. every binding is rewritten with dt-schema's fixups (`check/fixups.rs`):
   scalars become lists, cell values become matrices, `interrupts` implies
   `interrupts-extended`, every node may carry `status`, `pinctrl-*` and so
   on;
2. a property type database is built from the processed schemas
   (`check/types.rs`), with matrix dimensions;
3. the blob is decoded with those types (`check/decode.rs`): integers
   sized and signed, `reg` split by `#address-cells`/`#size-cells`, phandle
   lists split by the provider's `#*-cells`;
4. each node, with its subtree, is validated with a JSON Schema 2019-09
   validator (the `jsonschema` crate) against the schema of its first
   documented `compatible` and every schema whose `select` matches it.
   dt-schema's `typeSize` keyword is implemented on the side, since JSON
   numbers do not carry a width. Disabled nodes may miss or have extra
   properties.

The processed schemas are part of the catalog (and its cache), and a
validator is compiled per schema on first use. The input is a blob, so
bindings stay independent of the design model; the app compiles the design
with `to_dtb` and maps the problems back to nodes by path.
`designtree check --linux <tree> <file>` runs the same check on a design,
a `.dts` or a `.dtb`.

`crates/designtree-cli/tests/g3_corpus.rs` measures goal G3: it appends
each of 100 seeded mistakes (`tests/corpus/g3.txt`) to a kernel board
file, runs dt-schema's `dt-validate` on what the kernel build compiles and
DesignTree on the imported source, and reports which share of the problems
`dt-validate` adds DesignTree adds too, matched by node and property. The
corpus covers nine kinds of mistakes over twelve boards, and only keeps
mistakes `dt-validate` reports.

## Boundary with the GUI

The GUI only needs three operations, all JSON in and out:

1. load the catalog (palette of elements, searchable by category/compatible);
2. edit a `Graph` and ask for `validate` and `check_schemas` on change;
3. ask for `to_dts` to preview or save the output.

These are `#[tauri::command]` functions in `app/src-tauri/src/lib.rs`. The
TypeScript types of the wire format are generated from the Rust types with
`ts-rs` into `app/src/model.gen.ts`; `app/src/model.ts` re-exports them and
adds the canvas conversion. `cargo test` fails when the generated file is
stale; regenerate it with `UPDATE_TS=1 cargo test -p designtree --test typegen`.

Typed wiring (`app/src/ports.ts`) is a canvas concern: a node's phandle
properties from its binding become consumer ports, its `#*-cells`
properties provider ports, and a connection is only allowed between a
consumer and a provider of the matching `#*-cells` (dt-schema's naming
rule: `clocks` → `#clock-cells`, `*-gpios` → `#gpio-cells`). The edge it
creates is an ordinary reference edge writing that property.

## Next steps

- Incremental validation: only re-check the subtrees an edit changed
  (US-11.2).
