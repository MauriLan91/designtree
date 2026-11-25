# Contributing to DesignTree

Thanks for your interest in DesignTree. Bug reports, ideas, documentation
fixes and code are all welcome. This page explains how to get a change
merged with as little back and forth as possible.

## Ways to contribute

- **Report a bug** with the [bug report form](https://github.com/MauriLan91/designtree/issues/new?template=bug_report.yml).
  A small `.dts` or design file that shows the problem helps the most.
- **Suggest a feature** with the [feature request form](https://github.com/MauriLan91/designtree/issues/new?template=feature_request.yml).
  Planned work lives in [`docs/backlog.md`](docs/backlog.md) as user stories
  (`US-x.y`); check it and the open issues first.
- **Ask a question or share a board** in
  [Discussions](https://github.com/MauriLan91/designtree/discussions).
- **Improve the docs**: the user guide is in `docs/guide` (mdBook), the
  landing page in `site/`.
- **Write code**: issues labelled
  [`good first issue`](https://github.com/MauriLan91/designtree/labels/good%20first%20issue)
  and [`help wanted`](https://github.com/MauriLan91/designtree/labels/help%20wanted)
  are a good start.

Security problems are not reported in public issues; see
[SECURITY.md](SECURITY.md).

## Before you write code

For anything larger than a small fix, comment on the issue (or open one)
before you start, so we can agree on the approach and avoid duplicate work.
Say that you are working on it; an issue nobody has claimed for two weeks is
free to pick up again.

The labels `model: …` and `skill: …` on issues are planning notes for the
maintainer's own workflow. You can ignore them.

## Development setup

DesignTree targets Linux. You need:

- Rust 1.90 or later and Node.js 20 or later
- `dtc` (`device-tree-compiler`) for the round-trip and build tests
- for the desktop app, the Tauri system packages, on Debian or Ubuntu:
  `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev`
  (on Arch: `webkit2gtk-4.1 gtk3 dtc`)

Then:

```sh
git clone https://github.com/MauriLan91/designtree.git
cd designtree
mkdir -p app/dist            # cargo builds of the app need it to exist
cargo test --all
(cd app && npm install && npm run tauri dev)
```

Many features need a kernel checkout for the element library; see
[docs/install.md](docs/install.md) for a sparse clone that only fetches
the binding schemas. `DESIGNTREE_LINUX_SRC=/path/to/linux npm run tauri dev`
indexes it at startup.

## Where things live

| Path | Role |
| --- | --- |
| `crates/designtree-core` | Graph model, DTS parser and import, validation, DTS and `.dtb` export, layout. No GUI and no kernel-schema knowledge. |
| `crates/designtree-bindings` | Indexes the kernel binding schemas into the element library and validates `.dtb` blobs against them. |
| `crates/designtree-cli` | The `designtree` command line. |
| `app/src-tauri` | Tauri shell: thin command wrappers over the crates. |
| `app/src` | React + React Flow front end. |
| `docs/`, `site/` | Architecture notes, backlog, user guide, landing page. |

Dependencies point one way: the app and the CLI use core and bindings; core
and bindings never use each other or the app. Keep logic in the crates, not
in `app/src-tauri`. [docs/architecture.md](docs/architecture.md) has the
details.

## Checks to run

CI runs these on every pull request, and a pull request can only be merged
when they pass:

```sh
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
DESIGNTREE_REQUIRE_DTC=1 cargo test --all
(cd app && npm test && npm run build)
```

CI also runs two corpus checks against a real kernel tree (G1 round trip and
G3 validation recall) and a performance benchmark. You normally do not need
to run them locally; [CLAUDE.md](CLAUDE.md) explains how if CI flags them.

Some changes need an extra step:

- **Changed a serialized Rust type?** Regenerate the TypeScript types with
  `UPDATE_TS=1 cargo test -p designtree-cli --test typegen` and commit
  `app/src/model.gen.ts`.
- **Changed the UI of a feature?** Update its chapter in `docs/guide` and
  check it with `mdbook build docs/guide`.
- **Implemented or changed a story?** Update its row in `docs/backlog.md`.

## Conventions

- Everything in the repository is in English: code, comments, docs, commit
  messages, pull request text and UI strings.
- Rust: edition 2021, `cargo fmt` defaults, no clippy warnings; errors use
  `thiserror` in libraries and `anyhow` in the CLI.
- Generated DTS follows kernel style (tabs, a blank line between properties
  and subnodes) and keeps the order of imported nodes.
- Code that reads includes or runs `dtc` stays confined: includes only from
  the file's directory, its kernel tree and `-I` directories; `dtc` runs
  without a shell with the source on stdin. Changes there get a closer review.
- Comments explain why, not what.
- Add or update tests for the behaviour you change.

## Pull requests

- One topic per pull request. A pull request that implements a backlog story
  starts its title with the story id, for example
  `US-15.9 Save to the current file`; other titles just say what changes.
- Link the issue it closes (`Closes #123`) and fill in the template.
- Include a screenshot or short recording for visible UI changes.
- Keep commits focused, with a short imperative subject line. The maintainer
  usually merges with a merge commit, so a tidy history on your branch is
  appreciated but not required.
- Pull requests from first-time contributors need a maintainer's approval
  before CI runs; this is a GitHub safety setting, not a judgement.

The project is maintained by one person in their spare time, so a review can
take a few days. A friendly ping after a week is fine.

### AI-assisted contributions

Much of DesignTree is written with AI coding assistants, and you are welcome
to use them too. You are responsible for what you submit: read and
understand every line, run the checks above, and be ready to explain the
change in review.

## License

DesignTree is MIT licensed. By submitting a contribution you agree that it is
licensed under the same [MIT license](LICENSE) as the project, and that you
have the right to submit it. No separate contributor agreement is needed.

## Code of conduct

Everyone taking part in the project is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
