# Product backlog

> Status: **draft v0.3** (2026-11-06, M5 added from the first UX feedback). Product decisions below were taken
> with the product owner; story details can still change during refinement.
> Every milestone is mirrored as a
> [GitHub milestone](https://github.com/MauriLan91/designtree/milestones) and
> every story as an issue titled with its ID (`US-1.1 ...`), labelled by
> feature, model and skills. This file stays the source of truth for goals and
> story wording; keep both in sync when a story changes.

## Product decisions

| # | Decision | Date |
| --- | --- | --- |
| D1 | Primary personas are the **board bring-up engineer** and the **BSP maintainer**; learners are secondary. | 2026-10-19 |
| D2 | v0.1 starts with **importing real devicetrees** (round-trip), before validation and typed wiring. | 2026-10-19 |
| D3 | Boards built on an SoC `.dtsi` keep it untouched: user changes are exported as **`&label { }` overrides**, never flattened. | 2026-10-19 |
| D4 | The element library is built **only from a local kernel checkout** chosen by the user; no prebuilt or downloaded catalog is shipped. | 2026-10-19 |
| D5 | Besides the graph, three views are in scope: **synchronized DTS text**, **address map** and **physical board view**. | 2026-10-19 |
| D6 | Milestone dates below are accepted as targets. | 2026-10-19 |
| D7 | The canvas shows **one scope at a time**: the root is the main canvas, double-clicking a node opens its children in a tab with a breadcrumb, and double-clicking a node that cannot have children opens its property editor. Edges are only for ports, buses and phandle references; the parent/child edge goes away. | 2026-11-06 |
| D8 | In a bus controller's scope (I²C, SPI, ...) the controller is drawn as a **bus bar** with generated, read-only bus edges to its children. | 2026-11-06 |
| D9 | The menu bar is drawn **in HTML** inside the window, from the same command registry as the command palette, the toolbar and the shortcuts. | 2026-11-06 |

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
| **M5 v1.1 Workbench UX** | Fixes and stories from the first UX feedback (2026-11-06): VSCode-like workbench, composition with drill-down, plist-style property table, grouped library | G4 | 2027-02-26 |

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

From M5 on, stories also name skills installed on the maintainer's machine (they are not
available in cloud sessions unless installed there):

| Skill | When |
| --- | --- |
| `refactoring-ui` | Visual hierarchy, spacing and colour of panels, tables and nodes. |
| `top-design`, `web-typography` | Mock-ups, theme and icon set of the workbench. |
| `ux-heuristics` | Menus, settings, navigation: check the change against usability heuristics. |
| `design-everyday-things` | Interaction models users must learn (scopes, drill-down, boundary ports). |
| `microinteractions` | Small interactions: collapsing panes, expanding rows, tidy animations. |
| `software-design-philosophy` | Front-end architecture changes (command registry, scoped canvas, property table). |
| `high-perf-browser` | Stories at risk for G5: large lists and canvases in the web view. |
| `testing-setup` | Setting up front-end tests where a story first needs them. |

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
| US-11.2 | As a user, I want validation and export to be incremental so that typing never lags. | Each stage of an edit measured on the G5 benchmark (generated board and a real SoC board); < 50 ms per edit, optimising the stages that miss it (incremental work only where measurements show it is needed). | 8 | Opus 5.5 | code-review |

## M4 · v1.0 Public release

### F12 Packaging and updates

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-12.1 | As a user, I want installers for my OS so that I do not need a Rust toolchain. | GitHub Actions matrix produces AppImage, .deb, .msi, .dmg on tag; artifacts attached to the release. Linux first (decided 2026-11-06): Arch PKGBUILDs (release and `-git`) built and checked with `namcap` in CI, AppImage and .deb on tag; .msi and .dmg follow later. | 5 | Sonnet 5.5 | security-review |
| US-12.2 | As a user, I want signed builds and in-app update notifications so that I stay current safely. | Code signing for Windows/macOS where certificates are available; Tauri updater with signature check. Linux first (2026-11-06): signed build provenance for every release asset, daily update notice that leaves updating to the package manager; self-update (Tauri updater) and Windows/macOS signing follow with those installers. | 5 | Sonnet 5.5 | security-review |
| US-12.3 | As a maintainer, I want versioning and a changelog generated from commits so that releases are cheap. | ~~Conventional commits~~ PR titles named after their story (already the convention) grouped by backlog feature; release notes generated; one version across crates, app and packages, checked in CI. | 2 | Haiku 5.5 | – |

### F13 Onboarding and docs

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-13.1 | As a new user, I want a guided tutorial that builds a first board so that I reach a working `.dtb` in minutes. | Step-by-step in-app tour or docs page; sample design per step. | 3 | Sonnet 5.5 | run |
| US-13.2 | As a new user, I want a user guide covering every feature so that I can learn on my own. | Docs site (mdBook or similar) published from CI. | 3 | Haiku 5.5 | – |
| US-13.3 | As a product owner, I want a landing page with screenshots so that the project is easy to discover. | One page, linked from the README. | 2 | Sonnet 5.5 | artifact-design |
| US-13.4 | As a product owner, I want a usability test with 3 users so that G4 is measured. | Script, sessions, timing and findings recorded; follow-up stories created. Kit in `docs/usability/` (script, task card, session sheet, results). | 3 | (PO) | – |

## M5 · v1.1 Workbench UX

Stories from the first hands-on feedback on v1.0 (19 notes, 2026-11-06). Three
of the notes were defects and are tracked as bugs in v1.0: the library adds the
first compatible of a schema instead of the one searched (`cortex-a7` gives
`apm,potenza`), the zoom controls and minimap stay light in dark mode, and the
side panel squeezes the DTS source when the inspector is long.

### F15 Workbench

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-15.1 | As a user, I want the window designed as a coherent workbench, like VSCode, so that the tool looks and feels professional. | Mock-ups (light and dark) of the window: activity bar, side bar, editor area with tabs and split, bottom panel, inspector, status bar; icon set chosen; density and typography fixed; approved by the product owner before US-15.2. Approved 2026-11-06; spec in `docs/workbench.md`. | 2 | Sonnet 5.5 | artifact-design, top-design, refactoring-ui, web-typography |
| US-15.2 | As a user, I want a traditional menu bar (File, Edit, View, Insert, Tools, Help) and a toolbar with only the essential actions as icons so that commands are easy to find. | One command registry feeds menus, toolbar, command palette and shortcuts (D9); menus show each shortcut and disabled state; toolbar icons with tooltips; every current toolbar button reachable from a menu. | 5 | Sonnet 5.5 | run, code-review, software-design-philosophy, ux-heuristics, testing-setup |
| US-15.3 | As a user, I want resizable, collapsible panes so that I can give the canvas the room it needs. | Library, inspector and bottom panel resize and collapse (button and shortcut); always-visible scrollbars in every pane; sizes and states remembered per user; problems, build, interrupts and address map move to the bottom panel; status bar with kernel, dtc and problem count. | 5 | Sonnet 5.5 | run, code-review, refactoring-ui, microinteractions |
| US-15.4 | As a BSP maintainer, I want the DTS source as a split or alternative view of the editor so that I see more of both text and graph. | Graph / Split / DTS modes per tab (like Qt Design Studio's Design / Code / Split); selection sync of US-10.1 kept; mode remembered. | 3 | Sonnet 5.5 | run, ux-heuristics |
| US-15.5 | As a user, I want a settings panel so that I can configure the editor in one place. | VSCode-like panel with search and sections (General, Editor, Kernel, Build, Shortcuts, Updates); kernel checkouts and dtc path move there; theme (system, light, dark); shortcuts remappable; saved as JSON in the app config directory. | 5 | Sonnet 5.5 | run, security-review, ux-heuristics |
| US-15.6 | As a user, I want the theme and icons of the mock-ups applied to the window and the nodes so that the canvas is readable at a glance. | Theme tokens for light and dark from US-15.1; icon per node category on canvas nodes and library entries; all React Flow controls themed. | 5 | Sonnet 5.5 | run, refactoring-ui, top-design |

### F16 Composition

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-16.1 | As a user, I want to compose the tree by opening nodes instead of wiring parents to children so that each canvas stays small and readable. | Root is the main canvas; double-click opens a node's children in a tab with a breadcrumb; double-click on a node that cannot have children opens its property editor (D7); a node is made a child by creating or dropping it in that scope; no parent/child edges; design files and DTS export unchanged; G5 met. | 13 | Opus 5.5 | run, code-review, simplify, software-design-philosophy, design-everyday-things, high-perf-browser |
| US-16.2 | As a user, I want references to nodes outside the current scope shown as ports on the canvas border so that I can still wire them. | A phandle to a node in another scope appears as a boundary port named by its label (`&osc24m`); wiring to a boundary port writes the reference; clicking it jumps to the node. | 8 | Opus 5.5 | run, code-review, design-everyday-things |
| US-16.3 | As a bring-up engineer, I want a bus controller's scope to show the controller as a bus with its devices attached so that I see the wiring of a bus. | In an I²C/SPI/other bus scope the controller is a bus bar; generated, read-only bus edges to each child (D8); unit addresses shown on the edges. | 5 | Sonnet 5.5 | run, ux-heuristics |
| US-16.4 | As a BSP maintainer, I want a navigator tree of the whole devicetree so that I can jump to any node. | Tree in the side bar (like Qt Design Studio's Navigator); selection synced with canvas and text; opening an item opens its scope. | 3 | Sonnet 5.5 | run, ux-heuristics |
| US-16.5 | As a new user, I want the tutorial, guide and examples to match the composition editor so that they still work step by step. | Tutorial, guide chapters and `examples/first-board-*` updated; screenshots refreshed. | 2 | Haiku 5.5 | – |

### F17 Property table

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-17.1 | As a user, I want to edit properties in a table, like an Apple plist, so that every value type is edited the same way. | Key · Type · Value columns; rows expand for arrays, phandle lists and cells; type dropdown for unknown properties; enums as dropdowns, booleans as checkboxes, `dt-bindings` macros suggested in cells; replaces the typed fields and the `name = value` text box, which stays as a raw mode; round trip of every value type tested. | 8 | Opus 5.5 | run, code-review, refactoring-ui, microinteractions, software-design-philosophy |
| US-17.2 | As a user, I want the required properties always present in the table and pre-set to their defaults so that a node is valid as early as possible. | Required rows pinned on top, cannot be deleted, reset to the schema default or a to-do placeholder; optional schema properties offered from a + row with completion. | 3 | Sonnet 5.5 | run, ux-heuristics |

### F18 Library browser

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-18.1 | As a user, I want one library entry per compatible so that I find and add exactly the device I searched for. | `arm,cortex-a7` is its own entry titled from its schema; search highlights the match; the entry adds that compatible; list virtualized for 26,000 entries, results < 50 ms. | 3 | Sonnet 5.5 | run, code-review, high-perf-browser |
| US-18.2 | As a user, I want the library grouped by category, like Qt Design Studio's components, so that I can browse it without searching. | Collapsible sections per category; grid or list view; icon per category; favorites and recents kept as sections. | 5 | Sonnet 5.5 | run, refactoring-ui |
| US-18.3 | As a new user, I want the basic devicetree nodes in the library instead of an empty node so that I can start a board without knowing their properties. | Basic section on top with root, `cpus`, `cpu`, `memory`, `chosen`, `aliases`, `reserved-memory` from the dt-schema core schemas, with their required properties; "+ Empty node" kept as the last entry. | 3 | Sonnet 5.5 | run |

### F9 Editing ergonomics (continued)

| ID | User story | Acceptance criteria | SP | Model | Skills |
| --- | --- | --- | --- | --- | --- |
| US-9.5 | As a user, I want commands that tidy the canvas so that I can reorder everything in one step. | Layout of the current scope, of the selection or of everything; align and distribute; orthogonal edge routing from the layout's bend points; fit view; all undoable. | 5 | Sonnet 5.5 | run, simplify, microinteractions |

## Ideas not yet scheduled

- Full pin multiplexing editor (`pinctrl`) per SoC, beyond the connector view of US-14.3.
- Import from a running system (`/proc/device-tree` or a `.dtb`).
- Git-aware diff of two designs, shown on the canvas.
- Zephyr devicetree support (same format, different bindings).
- Web build (the Rust crates compiled to WASM) for a try-in-browser demo.
- Claude assistant inside the app: "add an I²C temperature sensor at 0x48 on i2c1".
