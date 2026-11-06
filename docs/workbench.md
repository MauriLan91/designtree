# Workbench design (v1.1)

The window layout, theme tokens, type, density and icons that the v1.1
stories (US-15.2 to US-15.6) implement. Mock-ups for US-15.1, approved by the
product owner on 2026-11-06; the design canvas with the light and dark
windows is kept by the maintainer.

## Layout

Top to bottom, VSCode-like:

| Region | Size | Content |
| --- | --- | --- |
| Menu bar | 30 px | File, Edit, View, Insert, Tools, Help (US-15.2) |
| Toolbar | 40 px | New, Open, Save · Undo, Redo · Add node, Auto layout · command search (Ctrl+K, the existing palette shortcut) · Build .dtb as the one primary button |
| Activity bar | 48 px wide | Library, Outline, Board view, Kernel schemas; Settings at the bottom |
| Side bar | 248 px (200–480) | The active view; library search with results, recents |
| Editor area | rest | Tabs of open designs with an unsaved dot; Graph / Split / DTS switch at the right of the tab row (US-15.4); zoom controls bottom left, minimap bottom right |
| Inspector | 288 px (240–560) | Category chip, node name and schema; name, unit address, label, compatible; properties; schema hints with a fix action |
| Bottom panel | 176 px (120 px–60 %) | Problems, Build, Interrupts, Address map, Schema check (US-15.3) |
| Status bar | 24 px | Kernel and schema count, dtc version, error and warning counts; node count, cursor, editor mode, zoom |

Side bar, inspector and bottom panel resize and collapse (US-15.3).

## Type

Inter for the interface, JetBrains Mono for anything that ends up in the
devicetree (node names, compatibles, properties, source). No text below 11 px.

| Role | Size / line | Weight |
| --- | --- | --- |
| Title | 20 / 28 | 600 |
| Heading (inspector node name) | 15 / 20 | 600 |
| Body | 13 / 20 | 400 |
| Small (secondary, status bar) | 12 / 16 | 400 |
| Section label | 11 / 16, caps, 0.06em tracking | 600 |
| Code | 12 / 20 mono | 400 |

## Density

4 px grid; spacing steps 4, 8, 12, 16, 24, 32. List rows and inputs 28 px,
activity bar buttons 40 px, toolbar buttons 32 px. Radii 4 (small controls),
6 (inputs, buttons, chips), 8 (nodes, cards).

## Color tokens

Cool-tinted greys, one blue accent, orange for phandle references. Every text
pair passes WCAG AA (4.5:1). These replace the variables in `app/src/styles.css`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `chrome` | `#eceef1` | `#15181c` | Menu bar, activity bar, tab row, status bar |
| `side` | `#f7f8fa` | `#181b20` | Side bar, inspector |
| `panel` | `#ffffff` | `#1c1f25` | Toolbar, active tab, bottom panel, inputs |
| `sunken` | `#eef0f3` | `#14171b` | Search field, segmented controls |
| `canvas` | `#f4f5f7` | `#111317` | Graph background |
| `code` | `#fbfbfc` | `#15171b` | DTS editor |
| `node` | `#ffffff` | `#22262d` | Canvas nodes |
| `border` | `#dcdfe4` | `#2b3038` | Dividers, inputs |
| `border-strong` | `#c3c8cf` | `#3b414b` | Node outlines |
| `hover` | `#e1e4e9` | `#272b32` | Hovered and active chrome buttons |
| `selected` | `#e6edfb` | `#1f2b42` | Selected list row |
| `text` | `#1b1f24` | `#e4e7eb` | Primary text |
| `muted` | `#57606a` | `#9ca4ae` | Secondary text, labels |
| `icon` | `#4b535d` | `#aab2bc` | Icons |
| `accent` | `#2463eb` | `#6aa1ff` | Selection, focus, primary button, active tab |
| `accent-soft` | `#d9e5fc` | `#21314f` | Focus and selection rings |
| `ref` | `#b45309` | `#f0a542` | Phandle references, reference edges |
| `danger` | `#c0262d` | `#f37b82` | Errors |
| `warn` | `#9a5b00` | `#e6b84c` | Warnings |
| `ok` | `#1f8a4c` | `#4cc47c` | Kernel loaded, build passed |

DTS syntax: node `#6d3fd6` / `#c3a6ff`, property `#0b5cad` / `#7cc4ff`,
string `#1f7a43` / `#86d39b`, number `#a14d00` / `#f0a542`, label and
reference `#2463eb` / `#8fb8ff`.

## Node categories

One tinted chip and icon per binding category, on canvas nodes, library rows
and the inspector header (US-15.6). The tint is decoration; the node name and
compatible always carry the meaning.

| Category | Lucide icon | Chip light (bg / ink) | Chip dark (bg / ink) |
| --- | --- | --- | --- |
| CPU, PMU | `cpu` | `#e6edfb` / `#1d4fd8` | `#1f2b42` / `#8fb8ff` |
| Interrupt controller | `zap` | `#fde8e8` / `#b42318` | `#3a1f23` / `#f59a9f` |
| Clock, reset | `clock` | `#fdf0dc` / `#9a5b00` | `#382a14` / `#f0be6a` |
| Serial, I²C, SPI | `text` | `#e7f6ec` / `#1f7a43` | `#18301f` / `#72d398` |
| GPIO, pinctrl, LEDs | `toggle-left` | `#efe9fd` / `#6d3fd6` | `#2a2142` / `#b9a0ff` |
| Memory, other | `memory-stick` | `#eef0f3` / `#4b535d` | `#14171b` / `#aab2bc` |

## Icons

[Lucide](https://lucide.dev) (ISC licence) through `lucide-react`, which
tree-shakes to the icons used. 24 px grid, 1.75 px stroke, round caps and
joins. Sizes: 16 px in lists and the status bar, 18 px in the toolbar, 20 px
in the activity bar. Every icon-only button has an `aria-label` and a tooltip
with its shortcut.

| Action | Icon |
| --- | --- |
| Library | `layout-grid` variant (`grid-2x2-plus`) |
| Outline | `list-tree` |
| Board view | `circuit-board` |
| Kernel schemas | `book` |
| Settings | `settings-2` |
| New, Open, Save | `file-plus`, `folder-open`, `save` |
| Undo, Redo | `undo-2`, `redo-2` |
| Add node, Auto layout | `square-plus`, `workflow` |
| Build .dtb | `hammer` |
| Error, Warning | `circle-alert`, `triangle-alert` |
