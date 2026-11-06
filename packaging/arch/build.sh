#!/bin/bash
# Builds and checks an Arch package in a disposable Arch Linux container
# (CI and the release workflow). Runs as root; makepkg runs as `builder`.
#
#   packaging/arch/build.sh git <commit>      designtree-git from this checkout
#   packaging/arch/build.sh release <version> designtree from the v<version> tag
#
# Writes the package, its PKGBUILD and .SRCINFO to dist-arch/.
set -euo pipefail

mode=$1
ref=$2
repo=$(cd "$(dirname "$0")/../.." && pwd)
out=$repo/dist-arch
work=$(mktemp -d)

pacman -Syu --noconfirm --needed base-devel git pacman-contrib namcap
id builder >/dev/null 2>&1 || useradd -m builder
git config --system --add safe.directory '*'

case $mode in
git)
	cp "$repo/packaging/arch/designtree-git/PKGBUILD" "$work/"
	# Build the commit under test instead of upstream main.
	sed -i "s|^source=.*|source=(\"designtree::git+file://$repo#commit=$ref\")|" "$work/PKGBUILD"
	;;
release)
	cp "$repo/packaging/arch/designtree/PKGBUILD" "$work/"
	sed -i "s/^pkgver=.*/pkgver=$ref/; s/^pkgrel=.*/pkgrel=1/" "$work/PKGBUILD"
	;;
*)
	echo "usage: $0 git <commit> | release <version>" >&2
	exit 2
	;;
esac

chown -R builder "$work"
cd "$work"
# The release tarball's checksum is only known once the tag exists.
if [ "$mode" = release ]; then
	su builder -c updpkgsums
fi
# makepkg -s would need sudo for builder; install the dependencies directly.
# shellcheck disable=SC1091,SC2154
deps=$(source ./PKGBUILD && echo "${depends[@]}" "${makedepends[@]}" "${checkdepends[@]}")
# shellcheck disable=SC2086
pacman -S --noconfirm --needed $deps
su builder -c "makepkg --noconfirm"
su builder -c "makepkg --printsrcinfo" > .SRCINFO

namcap PKGBUILD
namcap ./*.pkg.tar.zst

mkdir -p "$out"
cp ./*.pkg.tar.zst .SRCINFO "$out/"
# The release PKGBUILD carries the checksum and is what goes to the AUR.
if [ "$mode" = release ]; then
	cp PKGBUILD "$out/"
fi
pacman -Qlp "$out"/*.pkg.tar.zst
