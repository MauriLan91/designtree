# DesignTree

A graphical editor for Linux devicetrees: a node canvas on top of a Rust
backend, with the element library built from the kernel's binding schemas.
Product backlog: `docs/backlog.md` (stories, goals G1-G6, milestones).

## Language

Everything in the repository is English: code, comments, docs, commit
messages, PR text and UI strings. The maintainer may chat in Italian; the
repository never carries it.

## Layout and crate boundaries

| Path | Role |
| --- | --- |
| `crates/designtree-core` | Graph model (`model.rs`), DTS parser/preprocessor/import, validation, DTS export, auto-layout, `dtc` runner, problem parsing. No GUI, no kernel-schema knowledge. |
| `crates/designtree-bindings` | Indexes kernel binding schemas (YAML) into the element library. Depends on nothing from core. |
| `crates/designtree-cli` | `designtree` command line over both crates. Also hosts the type-generation test. |
| `app/src-tauri` | Tauri shell: thin `#[tauri::command]` wrappers over the crates. Keep logic in the crates, not here. |
| `app/src` | React + React Flow front end. `model.gen.ts` is generated; `model.ts` converts to and from the canvas. |
| `docs/` | Architecture, GUI options, backlog. |

Dependencies point one way: app and cli use core and bindings; core and
bindings never use each other or the app.

## Commands

```sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
DESIGNTREE_REQUIRE_DTC=1 cargo test --all        # needs dtc (device-tree-compiler)
(cd app && npm install && npm run build)         # tsc + vite
```

CI runs the same, plus the G1 corpus (`g1-corpus` job). Rust tests that need
`dtc` skip without it, unless `DESIGNTREE_REQUIRE_DTC` is set.

- **Generated types**: `app/src/model.gen.ts` comes from the Rust types. After
  changing a serialized type in Rust, run
  `UPDATE_TS=1 cargo test -p designtree --test typegen` and commit the result;
  the test fails when the file is stale.
- **G1 corpus** (round trip of 50 kernel board files): `scripts/fetch-kernel-dts.sh ~/linux-g1`,
  then `DESIGNTREE_LINUX_SRC=~/linux-g1 cargo test -p designtree-core --test g1_corpus -- --ignored --nocapture`.
- **Cloud sessions**: `scripts/cloud-session-setup.sh` installs the system
  packages, npm packages and crates a fresh container needs (`docs/cloud-sessions.md`).
- Tauri on Linux needs `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`;
  `cargo` builds of `app/src-tauri` also need `app/dist` to exist (`mkdir -p app/dist`).

## Running the app headless

There is no display in cloud sessions or CI. Use a virtual one:

```sh
cd app
WEBKIT_DISABLE_DMABUF_RENDERER=1 xvfb-run -a -s "-screen 0 1400x900x24" npm run tauri dev &
# drive it with xdotool; capture the window with `import -window root shot.png`
```

`WEBKIT_DISABLE_DMABUF_RENDERER=1` avoids a WebKitGTK crash on some Wayland/NVIDIA
setups. `DESIGNTREE_LINUX_SRC=/path/to/linux` indexes a kernel tree at startup
and a design file path after `--` opens it.

## Conventions

- Rust: edition 2021, `cargo fmt` defaults, no clippy warnings. Errors use
  `thiserror` in libraries and `anyhow` in the CLI.
- Generated DTS follows kernel style (tabs, blank line between properties and
  subnodes); keep the original order of imported nodes.
- Security-sensitive code (includes, running `dtc`) stays confined: includes are
  limited to the file's directory, its kernel tree and `-I` dirs; `dtc` is run
  without a shell with the source on stdin.
- One story per PR, named `US-x.y` in the title; update `docs/backlog.md` and
  the GitHub issue when a story changes.
- Comments explain why, not what; match the density of the surrounding code.
