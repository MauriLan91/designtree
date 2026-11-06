# Troubleshooting

**The window closes at start on Wayland** with `Error 71 (Protocol error)`.
DesignTree turns off WebKitGTK's DMA-BUF renderer on Linux by itself; if you
start it with `WEBKIT_DISABLE_DMABUF_RENDERER=0`, drop that.

**The library is empty.** No kernel checkout is loaded: see
[Kernel checkouts](library.md). The checkout needs
`Documentation/devicetree/bindings`.

**"Bindings may differ"** above the canvas: the design was made against
another kernel version than the loaded one. Pick the matching checkout under
**Tools › Kernel checkouts…**, or carry on and check the Problems tab of the bottom panel.

**Build .dtb says dtc is missing.** Install it (`dtc` on Arch,
`device-tree-compiler` on Debian and Ubuntu) or point **Tools › Set dtc path…** at it.

**Build .dtb is greyed out.** The design has structural errors; the DTS
source panel lists them.

**An include is not found when importing.** Includes are only read from the
file's directory, its kernel tree and the configured include directories.
Import from inside the kernel tree, or pass `-I <dir>` to `designtree import`.

**The first start with a checkout is slow.** Its binding schemas are
indexed once and cached; the next start reads the cache.

Bugs and questions: [GitHub issues](https://github.com/MauriLan91/designtree/issues).
