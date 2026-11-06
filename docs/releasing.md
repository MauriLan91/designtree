# Releasing

Versions follow [semantic versioning](https://semver.org). One version is
shared by the crates, the app and the packages; CI fails when the files
disagree (`scripts/bump-version.sh --check`).

## Steps

1. On a branch from `main`, run `scripts/bump-version.sh <version>`. It
   writes the version to `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`,
   `app/package.json`, `app/package-lock.json` and the release PKGBUILD, and
   adds a `## <version>` section to `CHANGELOG.md`.
2. Read the new section and edit it if needed, then open a PR titled
   `Release v<version>` and merge it.
3. Tag the merge commit and push the tag:

   ```sh
   git tag -a v<version> -m "DesignTree <version>" <merge commit>
   git push origin v<version>
   ```

4. The release workflow builds the Arch package, AppImage and `.deb`, and
   creates a draft release with the changelog section as notes. Check it,
   then publish it.
5. Update the AUR package from the release's `PKGBUILD` and
   `designtree.SRCINFO` ([docs/install.md](install.md#publishing-to-the-aur)).

## Changelog

`scripts/changelog.sh [<since> [<until>]]` lists the PRs merged into `main`
since the previous tag, grouped by the backlog feature of their story. It
reads the `US-x.y` in each PR title and the feature tables in
`docs/backlog.md`, so a PR titled after its story (the convention in
`CLAUDE.md`) lands in the right section; other PRs go under "Other
changes". Commit messages need no special format.
