#!/bin/sh
# Installs a release build into a staging root, for distribution packages:
#   packaging/linux/install.sh <destdir> [prefix] [target dir]
# Expects `designtree-app` and `designtree` already built in <target dir>
# (default target/release). Run from the repository root.
set -eu

destdir=$1
prefix=${2:-/usr}
target=${3:-target/release}
root=$destdir$prefix
id=io.github.maurilan91.designtree

install -Dm755 "$target/designtree-app" "$root/bin/designtree-app"
install -Dm755 "$target/designtree" "$root/bin/designtree"

install -Dm644 "packaging/linux/$id.desktop" "$root/share/applications/$id.desktop"
install -Dm644 "packaging/linux/$id.metainfo.xml" "$root/share/metainfo/$id.metainfo.xml"

icons=app/src-tauri/icons
for size in 32 64 128; do
	install -Dm644 "$icons/${size}x${size}.png" "$root/share/icons/hicolor/${size}x${size}/apps/$id.png"
done
install -Dm644 "$icons/128x128@2x.png" "$root/share/icons/hicolor/256x256/apps/$id.png"
install -Dm644 "$icons/icon.png" "$root/share/icons/hicolor/512x512/apps/$id.png"
install -Dm644 "$icons/icon.svg" "$root/share/icons/hicolor/scalable/apps/$id.svg"

# Sample designs, so the tutorial works without a repository checkout.
for f in examples/*; do
	[ -f "$f" ] && install -Dm644 "$f" "$root/share/designtree/examples/$(basename "$f")"
done
