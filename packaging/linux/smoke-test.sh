#!/bin/sh
# Installs a release package in a clean distribution container and checks that
# the app starts (CI, `linux-packages.yml`). Runs as root:
#
#   packaging/linux/smoke-test.sh <package file>
#
# A package goes through the distribution's package manager (apt, dnf, zypper,
# pacman), so a missing dependency fails the install; an AppImage gets only a
# display server and the desktop libraries AppImages leave to the system
# (fonts, X11/Wayland, GL), so a library it forgot to bundle fails the start.
set -eu

pkg=$(realpath "$1")

if command -v apt-get >/dev/null; then
	export DEBIAN_FRONTEND=noninteractive
	apt-get update -qq
	apt-get install -y -qq xvfb >/dev/null
	installer="apt-get install -y -qq"
	desktop="libfontconfig1 libfreetype6 libharfbuzz0b libfribidi0 libx11-6 libx11-xcb1 libxcb1 libwayland-client0 libgl1 libegl1 libgbm1"
elif command -v dnf >/dev/null; then
	dnf install -y -q xorg-x11-server-Xvfb
	installer="dnf install -y -q"
	desktop="fontconfig freetype harfbuzz fribidi libX11 libX11-xcb libxcb libwayland-client mesa-libGL mesa-libEGL mesa-libgbm"
elif command -v zypper >/dev/null; then
	zypper --non-interactive -q install xorg-x11-server-Xvfb
	# The package is not signed with a key zypper knows.
	installer="zypper --non-interactive -q install --allow-unsigned-rpm"
	desktop="fontconfig libfreetype6 libharfbuzz0 libfribidi0 libX11-6 libX11-xcb1 libxcb1 libwayland-client0 libGL1 libEGL1 libgbm1"
elif command -v pacman >/dev/null; then
	pacman -Syu --noconfirm --needed xorg-server-xvfb
	installer="pacman -U --noconfirm"
	desktop="fontconfig freetype2 harfbuzz fribidi libx11 libxcb wayland libglvnd mesa"
else
	echo "no known package manager" >&2
	exit 2
fi

case $pkg in
*.deb | *.rpm | *.pkg.tar.zst)
	$installer "$pkg" >/dev/null
	designtree --version
	# Every packaged build can build a .dtb, so dtc must have come along.
	dtc --version
	test -f /usr/share/metainfo/io.github.maurilan91.designtree.metainfo.xml
	test -f /usr/share/designtree/examples/simple-board.json
	app=designtree-app
	;;
*.AppImage)
	# shellcheck disable=SC2086
	$installer $desktop >/dev/null
	chmod +x "$pkg"
	# No FUSE in a container.
	export APPIMAGE_EXTRACT_AND_RUN=1
	app=$pkg
	;;
*)
	echo "usage: $0 <.deb | .rpm | .pkg.tar.zst | .AppImage>" >&2
	exit 2
	;;
esac

Xvfb :99 -screen 0 1400x900x24 >/dev/null 2>&1 &
xvfb=$!
trap 'kill $xvfb 2>/dev/null || true' EXIT
sleep 2

# The app has no headless mode: it passes when it is still running after
# 20 seconds (timeout exits 124) and printed no panic.
log=$(mktemp)
status=0
DISPLAY=:99 timeout 20 "$app" >"$log" 2>&1 || status=$?
cat "$log"
if [ "$status" -ne 124 ]; then
	echo "::error::$app exited with status $status before the timeout" >&2
	exit 1
fi
if grep -q "panicked" "$log"; then
	echo "::error::$app panicked" >&2
	exit 1
fi
echo "smoke test passed: $(basename "$pkg")"
