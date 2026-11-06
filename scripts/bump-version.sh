#!/bin/bash
# Sets the release version everywhere it is written down, and adds its
# section to CHANGELOG.md:
#
#   scripts/bump-version.sh <version>     e.g. 1.0.0
#   scripts/bump-version.sh --check       fail if the files disagree (CI)
#
# Then commit, merge, and tag the merge commit `v<version>`; the release
# workflow builds from the tag.
set -euo pipefail

cd "$(dirname "$0")/.."

cargo_version() { sed -n '/^\[workspace.package\]/,/^\[/ s/^version = "\(.*\)"/\1/p' Cargo.toml; }
versions() {
	printf 'Cargo.toml\t%s\n' "$(cargo_version)"
	printf 'app/src-tauri/tauri.conf.json\t%s\n' "$(jq -r .version app/src-tauri/tauri.conf.json)"
	printf 'app/package.json\t%s\n' "$(jq -r .version app/package.json)"
	printf 'app/package-lock.json\t%s\n' "$(jq -r .version app/package-lock.json)"
	printf 'packaging/arch/designtree/PKGBUILD\t%s\n' "$(sed -n 's/^pkgver=//p' packaging/arch/designtree/PKGBUILD)"
}

if [ "${1:-}" = --check ]; then
	if [ "$(versions | cut -f2 | sort -u | wc -l)" -ne 1 ]; then
		echo "Versions disagree; run scripts/bump-version.sh <version>:" >&2
		versions >&2
		exit 1
	fi
	exit 0
fi

version=${1:?usage: $0 <version> | --check}
if ! [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
	echo "not a semantic version: $version" >&2
	exit 2
fi

sed -i "/^\[workspace.package\]/,/^\[/ s/^version = \".*\"/version = \"$version\"/" Cargo.toml
cargo update --workspace --quiet
tmp=$(mktemp)
jq --arg v "$version" '.version = $v' app/src-tauri/tauri.conf.json >"$tmp" && mv "$tmp" app/src-tauri/tauri.conf.json
(cd app && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)
sed -i "s/^pkgver=.*/pkgver=$version/; s/^pkgrel=.*/pkgrel=1/" packaging/arch/designtree/PKGBUILD

# The new section goes on top, under the file's title.
notes=$(scripts/changelog.sh)
{
	echo "# Changelog"
	echo
	echo "## $version ($(date -u +%Y-%m-%d))"
	echo
	printf '%s\n\n' "$notes"
	[ -f CHANGELOG.md ] && sed '1{/^# Changelog$/d}; 2{/^$/d}' CHANGELOG.md
} >"$tmp"
mv "$tmp" CHANGELOG.md

versions
echo "Review CHANGELOG.md, commit as \"Release v$version\", and tag the merge commit v$version."
