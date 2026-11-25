# Installing DesignTree

DesignTree runs on Linux; there are no Windows or macOS builds. Each
[GitHub release](https://github.com/MauriLan91/designtree/releases) carries:

| Distribution | File | Section |
| --- | --- | --- |
| Arch Linux, Manjaro, EndeavourOS | `PKGBUILD` (also on the AUR) | [Arch Linux and Manjaro](#arch-linux-and-manjaro) |
| Debian 12+, Ubuntu 22.04+, Linux Mint, Pop!_OS | `DesignTree_<version>_amd64.deb` | [Debian and Ubuntu](#debian-and-ubuntu) |
| Fedora, openSUSE Tumbleweed | `DesignTree-<version>-1.x86_64.rpm` | [Fedora and openSUSE](#fedora-and-opensuse) |
| Any, with Flatpak | `DesignTree_<version>_x86_64.flatpak` | [Flatpak](#flatpak) |
| Any other, glibc 2.35 or newer | `DesignTree_<version>_amd64.AppImage` | [AppImage](#appimage) |

Every package installs the desktop app (`designtree-app`, with a menu entry),
the `designtree` command line and the example designs, and brings `dtc`
for **Build .dtb** (as a dependency, or inside the Flatpak; the AppImage
uses the system's). Before a release is published, CI
installs each package in clean containers of the distributions above and
checks that the app starts.

## Arch Linux and Manjaro

Two PKGBUILDs live in `packaging/arch/`:

| Package | Builds | Use it for |
| --- | --- | --- |
| `designtree` | the tagged release (`v<version>` tarball) | normal use |
| `designtree-git` | the latest commit on `main` | trying unreleased work |

Build and install either with `makepkg`, from a clone of the repository:

```sh
git clone https://github.com/MauriLan91/designtree.git
cd designtree/packaging/arch/designtree-git    # or designtree, once a release is tagged
makepkg -si
```

`makepkg -s` installs the build dependencies (`cargo`, `nodejs`, `npm`)
with pacman. The build takes a few minutes; `check()` runs the core and
bindings test suites. Remove the package with `sudo pacman -R designtree-git`.

The PKGBUILD attached to each release already carries the tarball checksum
and is the file published to the AUR (see [Publishing to the AUR](#publishing-to-the-aur)).

### Wayland and NVIDIA

On some Wayland sessions, KDE Plasma with an NVIDIA GPU among them,
WebKitGTK's DMA-BUF renderer closes the window at start with
`Error 71 (Protocol error) dispatching to Wayland display`. DesignTree sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` for itself on Linux, so no setup is
needed. To try the DMA-BUF renderer anyway, start it with
`WEBKIT_DISABLE_DMABUF_RENDERER=0 designtree-app`.

## Debian and Ubuntu

```sh
sudo apt install ./DesignTree_<version>_amd64.deb
```

The package depends on `device-tree-compiler` and the WebKitGTK 4.1 runtime
(Ubuntu 22.04, Debian 12 or newer). Remove it with `sudo apt remove design-tree`.

## Fedora and openSUSE

```sh
sudo dnf install ./DesignTree-<version>-1.x86_64.rpm                         # Fedora
sudo zypper install --allow-unsigned-rpm ./DesignTree-<version>-1.x86_64.rpm  # openSUSE
```

The package depends on `dtc` and the WebKitGTK 4.1 runtime, which the
package manager installs with it. openSUSE Leap 15 is too old for it; use
the AppImage there.

## Flatpak

```sh
flatpak install --user ./DesignTree_<version>_x86_64.flatpak
flatpak run io.github.maurilan91.designtree
```

The bundle uses the GNOME runtime from [Flathub](https://flathub.org/setup),
which `flatpak install` fetches when Flathub is configured, and carries its
own `dtc`. It can read and write your home folder, where kernel checkouts and
board files live, and reach `api.github.com` for the update check. The
command line runs with
`flatpak run --command=designtree io.github.maurilan91.designtree`.

## AppImage

```sh
chmod +x DesignTree_<version>_amd64.AppImage
./DesignTree_<version>_amd64.AppImage
```

The AppImage carries its own WebKitGTK and runs on distributions with
glibc 2.35 or newer. Install `dtc` from your distribution
(`device-tree-compiler` on Debian and Ubuntu, `dtc` elsewhere) to build
`.dtb` files. On a distribution without FUSE 2, run it with
`--appimage-extract-and-run`.

## Verifying a download

Each release has a `SHA256SUMS` file: `sha256sum -c SHA256SUMS
--ignore-missing` checks what you downloaded. The packages also carry a
signed [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations)
that ties the file to the release workflow run that built it from this
repository:

```sh
gh attestation verify DesignTree_<version>_amd64.AppImage --repo MauriLan91/designtree
```

## Updates

Once a day at start, DesignTree asks GitHub for the latest published
release (one request to `api.github.com`, nothing else is sent). When it is
newer than the running version, a bar at the bottom says so and how to
update for the way it was installed: the AUR helper or PKGBUILD on Arch, a
new `.deb`, `.rpm`, Flatpak bundle or AppImage elsewhere. The app does not replace itself; on Arch
the package manager stays in charge. **Don't check** in the bar turns the
check off; **Check for updates now** in the command palette (Ctrl+K) checks
at once and turns it back on.

## First start: a kernel checkout

The element library comes only from the binding schemas of a Linux kernel
checkout on your machine. Without one, the canvas works but the library is
empty and schema checks are off. A sparse checkout of the parts DesignTree
reads is enough:

```sh
scripts/fetch-kernel-dts.sh ~/linux        # from the repository; tag v7.3 by default
```

or by hand:

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/torvalds/linux.git ~/linux
git -C ~/linux sparse-checkout set Documentation/devicetree/bindings \
    arch/arm/boot/dts arch/arm64/boot/dts include/dt-bindings include/uapi/linux \
    scripts/dtc/include-prefixes
```

Then press **Kernels…** in the toolbar, **Add checkout…**, pick `~/linux`
and **Use**. DesignTree remembers the checkouts you add.
`DESIGNTREE_LINUX_SRC=~/linux designtree-app` loads one at start instead.

## From source

Needs Rust 1.90 or newer, Node.js 20 or newer, `dtc` and the WebKitGTK 4.1
development files (Arch: `webkit2gtk-4.1`; Debian/Ubuntu:
`libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`).

```sh
cd app
npm ci
npx tauri build --no-bundle               # target/release/designtree-app
cargo build --release -p designtree-cli   # target/release/designtree
```

`packaging/linux/install.sh <destdir>` installs both with the desktop entry,
icons and AppStream metadata, for distribution packages.

## Publishing to the AUR

For the maintainer, after a release is published:

```sh
git clone ssh://aur@aur.archlinux.org/designtree.git aur-designtree
cd aur-designtree
cp ~/Downloads/PKGBUILD .                      # from the release assets
cp ~/Downloads/designtree.SRCINFO .SRCINFO
git add PKGBUILD .SRCINFO
git commit -m "Update to <version>" && git push
```

`designtree-git` is published the same way from `packaging/arch/designtree-git`
(`makepkg --printsrcinfo > .SRCINFO`), once; it rebuilds from `main` on
every install.
