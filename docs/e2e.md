# End-to-end tests

`app/e2e` drives the real app, as a user would, and checks every UI element
by what it does to the design, the DTS text, the file written or the view
shown (US-4.5). It runs in CI as the `e2e` job, which attaches the report.

## Running it

```sh
sudo apt-get install webkitgtk-webdriver xvfb  # WebKitWebDriver (webkit2gtk-driver before Ubuntu 25.04)
cargo install tauri-driver --locked
cd app
VITE_E2E=1 npx tauri build --no-bundle        # release build with the test hook
xvfb-run -a -s "-screen 0 1400x900x24" npm run e2e
```

`--only <id,...>` runs some commands or elements; `--report <dir>` moves
`report.md`, `results.json` and the screenshots of failures (default
`app/e2e/report`). Use a release build: a debug build opens the web inspector
on Ctrl+Shift+I, the Inspector pane's shortcut, and the docked inspector
shrinks the page under the tests.

## How it works

- `VITE_E2E=1` builds `src/e2e.ts`: a `window.__designtree` hook that reports
  the command registry, the design and the open scope, and answers file
  dialogs with paths the test gives. Normal builds leave it out.
- Each test starts from the same state: a fresh config folder, the fixture
  design `e2e/fixtures/board.json` (from `board.dts`), a small bindings tree
  in `e2e/fixtures/linux` and a 1400x900 window.
- **Commands** come from the registry. `e2e/commands.mjs` has one test per
  command id, and each runs through every way in the command has: its menu
  item (or the palette), its shortcut and its toolbar button. A command with
  no test fails the run, as does a test for a command that is gone.
- **Other elements** (pointer gestures, panes, dialogs, Settings, the
  library, the board view) are listed by hand in `e2e/elements.mjs`.
- **Known bugs** are in `e2e/known.mjs` with their issue. They do not fail
  the run; once one passes, the run fails until its line is removed.

## First run

The first run, on 2026-11-25, before the failures were listed as known bugs.

Run 2026-11-25 22:04 UTC: 162 passed, 0 known bugs, 3 failed.

### Commands (from the registry)

Each command runs through every way in it has: its menu item (or the palette when it has no menu), its shortcut and its toolbar button.

| Command | Menu | Shortcut | Menu or palette | Shortcut | Toolbar |
| --- | --- | --- | --- | --- | --- |
| New design (`new`) | File | `Ctrl+N` | pass | pass | pass |
| New board from SoC… (`soc`) | File | – | pass | – | – |
| New overlay… (`overlay`) | File | – | pass | – | – |
| Open design… (`open`) | File | `Ctrl+O` | pass | pass | pass |
| Import .dts or .dtb… (`import`) | File | – | pass | – | – |
| Save (`save`) | File | `Ctrl+S` | pass | pass | pass |
| Save as… (`save-as`) | File | `Ctrl+Shift+S` | pass | pass | – |
| Export .dts… (`export`) | File | `Ctrl+E` | pass | pass | – |
| Settings… (`settings`) | File | `Ctrl+,` | pass | pass | – |
| Undo (`undo`) | Edit | `Ctrl+Z` | pass | pass | pass |
| Redo (`redo`) | Edit | `Ctrl+Shift+Z` | pass | pass | pass |
| Move selected node under… (`move`) | Edit | – | pass | – | – |
| Group selection (`group`) | Edit | `Ctrl+G` | pass | pass | – |
| Select all (`select-all`) | Edit | `Ctrl+A` | pass | pass | – |
| Select tool (`tool-select`) | Edit | – | pass | – | pass |
| Pan tool (`tool-pan`) | Edit | – | pass | – | pass |
| Ungroup (`ungroup`) | Edit | `Ctrl+Shift+G` | pass | pass | – |
| Tidy this canvas (`tidy`) | Arrange | `Ctrl+L` | pass | pass | pass |
| Tidy the selection (`tidy-selection`) | Arrange | `Ctrl+Shift+L` | pass | pass | – |
| Grid (`arrange-grid`) | Arrange | – | pass | – | pass |
| Tree, top down (`arrange-tree-vertical`) | Arrange | – | pass | – | pass |
| Tree, left to right (`arrange-tree-horizontal`) | Arrange | – | pass | – | pass |
| Star (`arrange-star`) | Arrange | – | pass | – | pass |
| Lay out the whole tree (`layout`) | Arrange | – | pass | – | pass |
| Align left edges (`align-left`) | Arrange | – | pass | – | pass |
| Align centres (`align-center`) | Arrange | – | pass | – | pass |
| Align right edges (`align-right`) | Arrange | – | pass | – | pass |
| Align top edges (`align-top`) | Arrange | – | pass | – | pass |
| Align middles (`align-middle`) | Arrange | – | pass | – | pass |
| Align bottom edges (`align-bottom`) | Arrange | – | pass | – | pass |
| Distribute horizontally (`distribute-horizontal`) | Arrange | – | pass | – | pass |
| Distribute vertically (`distribute-vertical`) | Arrange | – | pass | – | pass |
| Command palette… (`palette`) | View | `Ctrl+K` | pass | pass | pass |
| Go to node… (`go-to-node`) | View | `Ctrl+P` | pass | pass | – |
| Open selected node (`open-scope`) | View | – | pass | – | – |
| Up one scope (`up-scope`) | View | – | pass | – | – |
| Hide disabled nodes (`hide-disabled`) | View | – | pass | – | – |
| Outline (`outline`) | View | `Ctrl+Shift+O` | pass | pass | – |
| Graph (`mode-graph`) | View | `Ctrl+1` | pass | pass | – |
| Graph and DTS source (`mode-split`) | View | `Ctrl+2` | pass | pass | – |
| DTS source (`mode-dts`) | View | `Ctrl+3` | pass | pass | – |
| Library (`library`) | View | `Ctrl+Shift+E` | pass | pass | – |
| Inspector (`inspector`) | View | `Ctrl+Shift+I` | pass | pass | – |
| Bottom panel (`panel`) | View | `Ctrl+J` | pass | pass | – |
| Problems (`problems`) | View | `Ctrl+Shift+M` | pass | pass | – |
| Build output (`build-output`) | View | – | pass | – | – |
| Board view (`board`) | View | – | pass | – | – |
| Interrupt tree (`interrupts`) | View | – | pass | – | – |
| Address map (`address-map`) | View | – | pass | – | – |
| Fit the design in view (`fit`) | View | – | pass | – | – |
| Snap to grid (`snap`) | View | `Ctrl+'` | pass | pass | pass |
| Empty node (`add`) | Insert | – | pass | – | pass |
| Reference from selected node to… (`connect`) | Insert | – | pass | – | – |
| Build .dtb (`build`) | Tools | `Ctrl+B` | pass | pass | pass |
| Kernel checkouts… (`kernels`) | Tools | – | pass | – | – |
| Use kernel checkout… (`use-kernel`) | Tools | – | pass | – | – |
| Set dtc path… (`dtc`) | Tools | – | pass | – | – |
| Keyboard shortcuts (`shortcuts`) | Help | `F1` | pass | pass | – |
| Check for updates now (`updates`) | Help | – | pass | – | – |
| About DesignTree (`about`) | Help | – | pass | – | – |

### Other elements (listed by hand in `e2e/elements.mjs`)

| Element | Kind | Where | Result |
| --- | --- | --- | --- |
| Ctrl+Y redoes (`key-ctrl-y`) | shortcut | window | pass |
| Ctrl+C, Ctrl+V copy and paste nodes (`key-copy-paste`) | shortcut | canvas | pass |
| Delete removes the selection (`key-delete`) | shortcut | canvas | pass |
| Ctrl+Tab and Ctrl+Shift+Tab switch tabs (`key-ctrl-tab`) | shortcut | window | **fail** |
| Ctrl+W closes the tab, asking about unsaved changes (`key-ctrl-w`) | shortcut | window | pass |
| Alt+letter opens a menu (`key-alt-letter`) | shortcut | menu bar | pass |
| Ctrl+click and Shift+click add to the selection or take out (`click-modifiers`) | pointer | canvas | pass |
| Dragging a card moves the node (`drag-node`) | pointer | canvas | pass |
| With the pan tool, dragging the canvas moves the view (`pan-tool-drag`) | pointer | canvas | pass |
| With the select tool, dragging the canvas selects an area (`select-tool-area`) | pointer | canvas | pass |
| + opens a new tab (`tab-new`) | button | tab bar | pass |
| Clicking a tab shows its design (`tab-switch`) | tab | tab bar | pass |
| × closes a tab (`tab-close`) | button | tab bar | pass |
| Unsaved changes: Cancel keeps the tab, Discard closes it (`unsaved-dialog`) | dialog | tab bar | pass |
| Library and Outline buttons switch the side bar (`activity-library-outline`) | button | activity bar | pass |
| The gear opens the settings (`activity-settings`) | button | activity bar | pass |
| Graph, Split and DTS buttons set the editor mode (`mode-switch`) | button | canvas header | pass |
| The inspector's collapse button folds it to a rail and back (`pane-toggle-inspector`) | button | inspector | pass |
| Dragging a pane edge resizes it; a double-click restores it (`splitter`) | splitter | panes | pass |
| The graph and DTS divider sets the split (`split-handle`) | splitter | canvas | pass |
| Panel tabs and the hide button (`panel-tabs`) | tab | bottom panel | pass |
| A card's "nodes inside" button opens its scope (`card-inside`) | button | node card | pass |
| Scope tabs, their close button and the breadcrumb (`scope-bar`) | tab | scope bar | pass |
| Zoom in, zoom out, fit and lock (`canvas-controls`) | button | canvas | pass |
| The minimap draws the cards (`minimap`) | view | canvas | pass |
| Dragging from a card's reference handle to another wires a reference (`handle-connect`) | pointer | canvas | pass |
| The search narrows the library (`library-search`) | field | library | pass |
| Class, vendor and bus filters, and their clear buttons (`library-filters`) | field | library | pass |
| Fits here keeps what goes under the open bus (`library-fits`) | button | library | pass |
| List and grid views (`library-view`) | button | library | pass |
| Double-click adds an element; dragging it onto the canvas too (`library-add`) | pointer | library | pass |
| The star keeps an element in Favorites (`library-star`) | button | library | pass |
| Name, label and compatible fields change the node (`inspector-fields`) | field | inspector | pass |
| Text view of the properties, and back to the table (`inspector-properties`) | field | inspector | pass |
| Add a property in the table (`inspector-add-property`) | field | inspector | pass |
| Typing in the DTS text changes the design (`dts-edit`) | field | DTS source | pass |
| The Outline's filter, twisty, click and double-click (`outline`) | tree | Outline | pass |
| Grouping, severity, sources, text filter, Whole design and a row's click (`problems-view`) | panel | Problems | pass |
| Whole design lists the problems outside the open scope (`problems-whole-design`) | button | Problems | pass |
| Panel toggle, kernel, dtc, problem counts and version buttons (`status-bar`) | button | status bar | **fail** |
| The theme setting changes the window's colours and is kept (`settings-theme`) | field | Settings | pass |
| Searching the settings (`settings-search`) | field | Settings | pass |
| About's Copy puts the build facts on the clipboard (`about-copy`) | button | About | pass |
| Escape closes the palette, the shortcut sheet and About (`dialog-escape`) | dialog | window | pass |
| The update notice's close button (`update-notice`) | dialog | window | pass |
| Mode of new tabs sets the mode a new tab opens in (`settings-editor-mode`) | field | Settings | pass |
| Pressing a new combination on a shortcut rebinds the command (`settings-shortcut`) | field | Settings | pass |
| The update check setting is kept (`settings-updates`) | field | Settings | pass |
| The kernel checkouts list shows the checkout in use (`settings-kernels`) | field | Settings | pass |
| The SoC picker lists the SoC .dtsi files or says there are none, and closes (`soc-picker`) | dialog | File | **fail** |
| Rows of the interrupt tree and the address map show their node (`panel-rows`) | button | bottom panel | pass |
| The Build tab shows dtc's result (`build-panel`) | panel | bottom panel | pass |
| Dragging a device onto the board places it (`board-place`) | pointer | board view | pass |
| Add a connector to the board (`board-connector`) | button | board view | pass |

### Failures

- `key-ctrl-tab` (shortcut): timed out waiting for the other tab again. Filed as #252: Ctrl+Shift+Tab arrives on WebKitGTK with `key` "Unidentified".
- `status-bar` (button): timed out waiting for the pick closed. Filed as #253: Escape on a pick opened from a menu goes back to the command list.
- `soc-picker` (dialog): timed out waiting for the picker closed. Filed as #254: the SoC picker has no Escape.
