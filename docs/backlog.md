# Product backlog

> Status: **draft v0.2** (2026-10-19). Product decisions below were taken
> with the product owner; story details can still change during refinement.
> Milestones and stories are mirrored to GitHub Milestones and Issues once
> validated; this file stays the source of truth for goals and story wording.

## Product decisions

| # | Decision | Date |
| --- | --- | --- |
| D1 | Primary personas are the **board bring-up engineer** and the **BSP maintainer**; learners are secondary. | 2026-10-19 |
| D2 | v0.1 starts with **importing real devicetrees** (round-trip), before validation and typed wiring. | 2026-10-19 |
| D3 | Boards built on an SoC `.dtsi` keep it untouched: user changes are exported as **`&label { }` overrides**, never flattened. | 2026-10-19 |
| D4 | The element library is built **only from a local kernel checkout** chosen by the user; no prebuilt or downloaded catalog is shipped. | 2026-10-19 |
| D5 | Besides the graph, three views are in scope: **synchronized DTS text**, **address map** and **physical board view**. | 2026-10-19 |
| D6 | Milestone dates below are accepted as targets. | 2026-10-19 |

## Product vision

For embedded Linux developers who write and maintain devicetrees by hand,
**DesignTree** is a desktop editor that lets them build, import and check a
devicetree visually, as a node graph wired like n8n or Simulink. Unlike a text
editor plus `dtc` plus `make dtbs_check`, DesignTree knows every binding in the
Linux kernel, so it offers only valid elements, fills in required properties,
accepts only compatible connections and reports schema errors while you draw.

### Personas

| Persona | Need |
| --- | --- |
| **Board bring-up engineer** | Describe a new board on top of an existing SoC `.dtsi`, quickly and without schema errors. |
| **BSP maintainer** | Open existing `.dts`/`.dtsi` files, understand them at a glance, change them and keep diffs small. |
| **Learner / student** (secondary) | Understand how a devicetree is structured (hierarchy, phandles, address map) by seeing it. |

## SMART goals

| # | Goal | Measure | Deadline |
| --- | --- | --- | --- |
| G1 | **Round-trip fidelity.** Import an existing kernel board `.dts` (with its `#include`s), save it, export it, and get the same compiled result. | ≥ 90 % of a fixed corpus of 50 arm64/arm board files produce a `.dtb` identical to the kernel build (compared with `fdtdump`/`dtc -I dtb -O dts`), checked in CI. | 2026-12-18 (v0.1) |
| G2 | **Complete, typed element library.** Every kernel binding is usable from the palette with typed properties. | ≥ 95 % of binding schemas indexed without being skipped; ≥ 90 % of their properties have a resolved type. Reported by `designtree index --stats`. | 2026-12-18 (v0.1) |
| G3 | **Schema validation while editing.** Catch the errors `make dtbs_check` would report, without leaving the editor. | On a seeded corpus of 100 known errors, DesignTree reports ≥ 90 % of what `dtbs_check` reports; full validation of a 500-node design takes < 200 ms. | 2027-02-26 (v0.2) |
| G4 | **Fast first board.** A new user builds a minimal board (CPU, memory, clock, UART, GPIO LED) from an empty canvas to a compiling `.dtb`. | Median time < 15 min across 3 test users, no help from the authors. | 2027-03-31 (v0.3) |
| G5 | **Scales to real SoCs.** Large designs stay fluid. | A 1,000-node design pans/zooms at ≥ 50 fps and opens in < 2 s on a mid-range laptop (benchmark in CI). | 2027-03-31 (v0.3) |
| G6 | **Public 1.0 release.** Anyone can install and use it. | Signed installers for Linux (AppImage, .deb), Windows (.msi) and macOS (.dmg) built by CI; user guide and tutorial published; ≥ 70 % line coverage on `designtree-core`. | 2027-04-30 (v1.0) |

## Milestones

| Milestone | Theme | Goals | Target |
| --- | --- | --- | --- |
| **M0 Skeleton** ✅ | Graph model, DTS export, binding indexer, CLI, first Tauri + React Flow app | – | done 2026-10-19 |
| **M1 v0.1 Round-trip** | Import real devicetrees, typed library, compile with `dtc` | G1, G2 | 2026-12-18 |
| **M2 v0.2 Real boards** | Schema validation, typed wiring, SoC templates, overlays, address map | G3 | 2027-02-26 |
| **M3 v0.3 Productive editor** | Undo/redo, text/graph sync, board view, keyboard flow, performance | G4, G5 | 2027-03-31 |
| **M4 v1.0 Public release** | Packaging, docs, onboarding, usability test | G6 | 2027-04-30 |

Assumed cadence: two-week sprints, about five sprints for M1 and four for each
following milestone. To be adjusted to the team's real capacity.

## How a story is implemented with Claude

Each story is worked in its own project thread on its own branch, opened as a
draft PR. The **model** column says which Claude model should drive it; the
**skills** column lists the Claude Code skills to run during the work.

| Model | Use it for |
| --- | --- |
| **Opus 5.5** | Parsers, schema semantics, graph algorithms, architecture decisions, anything where a subtle mistake corrupts the user's devicetree. |
| **Sonnet 5.5** | Typical feature work: React components, Tauri commands, CI jobs, tests around an existing design. |
| **Haiku 5.5** | Small, mechanical, well-specified changes: docs, config, renames, boilerplate. |

| Skill | When |
| --- | --- |
| `code-review` | Every story, before the PR leaves draft. Level `high` for Opus stories. |
| `simplify` | After the story works, before review, on stories touching more than a few files. |
| `security-review` | Stories that spawn processes (`cpp`, `dtc`), read user-chosen paths, download data or update the app. |
| `run` | Every story with a visible UI change: launch the real Tauri app (xvfb) and capture a screenshot for the PR. |
| `session-start-hook` | Setting up cloud sessions so they can build and test the repo. |
| `init` | Creating and maintaining `CLAUDE.md`. |
| `dataviz` | Stories that draw charts or maps (address map, benchmark reports). |
| `artifact-design` | Design mock-ups and the project landing page. |

Estimates are story points (Fibonacci). **Definition of Done:** acceptance
criteria met, unit/integration tests added, CI green, `code-review` findings
addressed, docs updated, screenshot in the PR for UI changes.

---

## M1 · v0.1 Round-trip

### F1 Devicetree import

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-1.1 | As a BSP maintainer, I want to open an existing `.dts` file so that I can edit my board visually instead of starting from scratch. | Parses nodes, properties of every value type, labels, phandle references (`&x`, `<&x 1 2>`), `/delete-node/`, `/delete-property/`, `&label { }` overrides; references become reference edges; parse errors show file, line and column. | 8 | Opus 5.5 | code-review, simplify |
| US-1.2 | As a BSP maintainer, I want `#include` of `.dtsi` files and `dt-bindings` headers to be resolved so that real kernel board files open. | Include paths configurable (defaults for a kernel tree); C preprocessor macros expanded (`GPIO_ACTIVE_LOW`, `IRQ_TYPE_*`); works on the G1 corpus. | 8 | Opus 5.5 | code-review, security-review |
| US-1.3 | As a BSP maintainer, I want nodes that come from an included `.dtsi` to be shown as inherited and my changes kept as overrides so that exporting does not flatten the SoC file into my board file. | Inherited nodes visibly marked and read-only by default; edits produce `&label { }` blocks in the board file; export of an unmodified import equals the original after `dtc` compilation. | 13 | Opus 5.5 | code-review |
| US-1.4 | As a user, I want an imported tree laid out automatically so that it is readable without dragging every node. | Hierarchical auto-layout (e.g. ELK) on import and on demand; groups for each bus; layout stored in the design file. | 5 | Sonnet 5.5 | run, simplify |
| US-1.5 | As a BSP maintainer, I want exported files formatted like kernel sources, keeping the original order of imported nodes, so that my diffs stay small. | Stable ordering, tabs, kernel style; re-exporting an unmodified import gives a textually identical file except whitespace normalization. | 3 | Sonnet 5.5 | code-review |

### F2 Typed element library

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-2.1 | As a user, I want every property in the library to know its type so that the editor can offer the right input. | Indexer resolves `$ref` to `/schemas/types.yaml`, common schemas (`/schemas/clock/...`) and `allOf` includes; types, enums, defaults, min/max captured; `index --stats` reports G2 metrics. | 8 | Opus 5.5 | code-review |
| US-2.2 | As a user, I want the inspector to list the required and optional properties of the selected compatible with typed inputs so that I do not have to read the YAML. | Required props on top; enums as dropdowns, booleans as toggles, cell arrays as number lists; description as tooltip; unknown props still editable as raw. | 5 | Sonnet 5.5 | run, code-review |
| US-2.3 | As a user, I want a node dropped from the palette to come with its required properties pre-filled so that it is almost valid immediately. | `compatible`, `reg` placeholder, `status = "okay"` and required props with defaults or empty placeholders flagged as to-do. | 3 | Sonnet 5.5 | run |

### F3 Build with dtc

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-3.1 | As a user, I want to compile my design to `.dtb` from the editor so that I know it builds. | Uses `dtc` from `PATH` or a configured path; output saved next to the design; missing `dtc` gives a clear message. | 3 | Sonnet 5.5 | security-review, code-review |
| US-3.2 | As a user, I want `dtc` errors and warnings attached to the node they refer to so that I can fix them on the canvas. | Line numbers of generated DTS mapped back to node ids; problems panel lists all of them; clicking one focuses the node. | 5 | Sonnet 5.5 | run |

### F4 Engineering enablers

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-4.1 | As a developer, I want the TypeScript model generated from the Rust types so that the two never drift. | `ts-rs` or `specta` generates `app/src/model.gen.ts`; CI fails if it is stale. | 3 | Sonnet 5.5 | code-review |
| US-4.2 | As a developer, I want cloud Claude sessions to build and test the repo out of the box. | SessionStart hook installs Tauri system deps and npm packages; `cargo test` and `npm run build` pass in a fresh session. | 2 | Haiku 5.5 | session-start-hook |
| US-4.3 | As a developer, I want a `CLAUDE.md` describing layout, conventions and commands. | Covers English-only rule, crate boundaries, how to run app headless. | 1 | Haiku 5.5 | init |
| US-4.4 | As a product owner, I want the G1 round-trip corpus run in CI so that fidelity is measured on every PR. | Pinned kernel tag sparse-checked-out and cached; job prints pass rate; fails below threshold. | 5 | Sonnet 5.5 | code-review |

## M2 · v0.2 Real boards

### F5 Schema validation

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-5.1 | As a user, I want each node checked against its binding schema while I edit so that I catch errors before building. | Required props, types, enums, const, `additionalProperties`/`unevaluatedProperties`, `if/then` on compatible; errors shown on node and in the problems panel; G3 timing met. | 13 | Opus 5.5 | code-review, simplify |
| US-5.2 | As a product owner, I want our validation compared with `make dtbs_check` on a seeded corpus so that G3 is measured. | Corpus of 100 injected errors; CI report of recall. | 5 | Sonnet 5.5 | dataviz |

### F6 Typed wiring

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-6.1 | As a user, I want consumer properties (`clocks`, `interrupts`, `gpios`, `resets`, `dmas`, `pinctrl-0`, ...) shown as named ports so that wiring is explicit. | Ports derived from the schema; provider ports derived from `#*-cells`; only compatible connections allowed; the edge writes the property. | 8 | Opus 5.5 | run, code-review |
| US-6.2 | As a user, I want to edit the specifier cells of a connection with symbolic names so that `<&gpio 17 GPIO_ACTIVE_LOW>` is easy to write. | Cell count from the provider; macros from `dt-bindings` headers offered by name. | 5 | Sonnet 5.5 | run |
| US-6.3 | As a user, I want an address-map view of each bus so that I can spot overlapping or unmapped `reg` ranges. | Translates `reg` through `ranges` and `#address-cells`/`#size-cells`; highlights overlaps and out-of-range regions. | 8 | Opus 5.5 | dataviz, run |
| US-6.4 | As a user, I want an interrupt view showing which controller each device interrupts so that I can check the interrupt tree. | Follows `interrupt-parent`/`interrupts-extended`; flags missing parents. | 5 | Sonnet 5.5 | run |

### F7 Board composition

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-7.1 | As a bring-up engineer, I want to start a new board from a kernel SoC `.dtsi` so that I only describe what my board adds. | Picker by architecture / vendor / SoC; result is a board design including the `.dtsi` (uses US-1.2/1.3). | 5 | Sonnet 5.5 | run |
| US-7.2 | As a bring-up engineer, I want to author overlays (`.dtso`) against a base design so that I can describe add-on boards. | Overlay design references labels of the base; exports a valid overlay; can be previewed applied to the base. | 8 | Opus 5.5 | code-review |
| US-7.3 | As a user, I want a group to collapse into a block with ports, like a Simulink subsystem, so that large designs stay readable. | Collapse/expand; edges crossing the group boundary become ports. | 5 | Sonnet 5.5 | run, simplify |

### F8 Library experience

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-8.1 | As a user, I want fuzzy search across compatible, vendor and title, plus favorites and recents, so that I find elements fast among 26,000 compatibles. | Results < 50 ms; ranking by match quality; favorites persisted. | 3 | Sonnet 5.5 | run |
| US-8.2 | As a user, I want to register one or more local kernel checkouts and pick which one a design uses so that the library matches my target kernel. | Settings list kernel source paths with detected version (`Makefile` VERSION/PATCHLEVEL); the design file records the kernel version it was built against; the index is cached per checkout and rebuilt only when bindings change; a design opened against a different version shows a warning. | 5 | Sonnet 5.5 | security-review, run |

## M3 · v0.3 Productive editor

### F9 Editing ergonomics

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-9.1 | As a user, I want undo/redo for every edit so that I can experiment safely. | Ctrl+Z / Ctrl+Shift+Z for node, edge, property, group and layout changes; history of ≥ 200 steps. | 5 | Sonnet 5.5 | run, code-review |
| US-9.2 | As a user, I want copy/paste of nodes and subtrees, also between designs, so that I can reuse parts. | Labels de-duplicated on paste; references inside the selection preserved. | 3 | Sonnet 5.5 | run |
| US-9.3 | As a user, I want a command palette and keyboard shortcuts so that I can work without the mouse. | Ctrl+K palette for add node, connect, group, export; shortcuts listed in a help sheet. | 3 | Haiku 5.5 | run |
| US-9.4 | As a user, I want several designs open in tabs so that I can compare boards. | Tabs with unsaved-change markers; prompt on close. | 3 | Sonnet 5.5 | run |

### F10 Text and graph together

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-10.1 | As a BSP maintainer, I want to edit the DTS text side by side with the graph, with changes flowing both ways, so that I can use whichever is faster. | Code editor (Monaco or CodeMirror) with DTS highlighting; text edits re-parse incrementally; selection is synced. | 13 | Opus 5.5 | run, code-review, simplify |

### F14 Physical board view

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-14.1 | As a bring-up engineer, I want a board view where I place devices where they sit on the PCB (SoC, connectors, sensors) so that the design matches the schematic I work from. | Second canvas sharing the same model; nodes positioned freely over an optional background image (board photo or schematic export); selection synced with the graph view; positions saved in the design file and ignored by DTS export. | 8 | Sonnet 5.5 | run, artifact-design |
| US-14.2 | As a bring-up engineer, I want buses and connections drawn between devices in the board view so that I see which controller drives which peripheral. | Edges derived from hierarchy and phandle references (I²C, SPI, GPIO, interrupts), filterable by type. | 5 | Sonnet 5.5 | run |
| US-14.3 | As a bring-up engineer, I want connector pin-outs on the board view (e.g. a 40-pin header) mapped to SoC pins so that I can check pin multiplexing. | Connector templates with pin numbers; pins linked to `pinctrl`/GPIO nodes; conflicts flagged. | 8 | Opus 5.5 | run, code-review |

### F11 Performance

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-11.1 | As a user, I want large SoC designs to stay fluid so that the tool works on real hardware. | G5 benchmark in CI with a generated 1,000-node design; report trend. | 5 | Sonnet 5.5 | dataviz, run |
| US-11.2 | As a user, I want validation and export to be incremental so that typing never lags. | Only changed subtrees re-validated; measured < 50 ms per edit on the benchmark. | 8 | Opus 5.5 | code-review |

## M4 · v1.0 Public release

### F12 Packaging and updates

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-12.1 | As a user, I want installers for my OS so that I do not need a Rust toolchain. | GitHub Actions matrix produces AppImage, .deb, .msi, .dmg on tag; artifacts attached to the release. | 5 | Sonnet 5.5 | security-review |
| US-12.2 | As a user, I want signed builds and in-app update notifications so that I stay current safely. | Code signing for Windows/macOS where certificates are available; Tauri updater with signature check. | 5 | Sonnet 5.5 | security-review |
| US-12.3 | As a maintainer, I want versioning and a changelog generated from commits so that releases are cheap. | Conventional commits; release notes generated. | 2 | Haiku 5.5 | – |

### F13 Onboarding and docs

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-13.1 | As a new user, I want a guided tutorial that builds a first board so that I reach a working `.dtb` in minutes. | Step-by-step in-app tour or docs page; sample design per step. | 3 | Sonnet 5.5 | run |
| US-13.2 | As a new user, I want a user guide covering every feature so that I can learn on my own. | Docs site (mdBook or similar) published from CI. | 3 | Haiku 5.5 | – |
| US-13.3 | As a product owner, I want a landing page with screenshots so that the project is easy to discover. | One page, linked from the README. | 2 | Sonnet 5.5 | artifact-design |
| US-13.4 | As a product owner, I want a usability test with 3 users so that G4 is measured. | Script, sessions, timing and findings recorded; follow-up stories created. | 3 | (PO) | – |

## Ideas not yet scheduled

- Full pin multiplexing editor (`pinctrl`) per SoC, beyond the connector view of US-14.3.
- Import from a running system (`/proc/device-tree` or a `.dtb`).
- Git-aware diff of two designs, shown on the canvas.
- Zephyr devicetree support (same format, different bindings).
- Web build (the Rust crates compiled to WASM) for a try-in-browser demo.
- Claude assistant inside the app: "add an I²C temperature sensor at 0x48 on i2c1".
