# Installing DesignTree

DesignTree is packaged for Linux first. Arch Linux and its derivatives
(Manjaro, EndeavourOS) build it from a PKGBUILD; other distributions use the
AppImage or the `.deb` attached to each
[GitHub release](https://github.com/MauriLan91/designtree/releases).
Windows and macOS installers are not built yet; build from source there.

Every package installs the desktop app (`designtree-app`, with a menu entry)
and needs `dtc` for **Build .dtb**. The Arch package also installs the
`designtree` command line.

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

## AppImage

```sh
chmod +x DesignTree_<version>_amd64.AppImage
./DesignTree_<version>_amd64.AppImage
```

Install `dtc` from your distribution (`device-tree-compiler` on Debian and
Ubuntu) to build `.dtb` files. The AppImage is built on Ubuntu 22.04 and runs
on distributions with glibc 2.35 or newer.

## Debian and Ubuntu

```sh
sudo apt install ./DesignTree_<version>_amd64.deb
```

The package depends on `device-tree-compiler` and the WebKitGTK 4.1 runtime
(Ubuntu 22.04, Debian 12 or newer).

Each release also has a `SHA256SUMS` file: `sha256sum -c SHA256SUMS
--ignore-missing` checks what you downloaded.

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
