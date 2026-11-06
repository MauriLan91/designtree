# Kernel checkouts and the library

The library lists every device the kernel's binding schemas describe:
thousands of schemas and tens of thousands of compatible strings. It comes
only from a kernel checkout on your machine (see
[First start](installing.md#first-start-a-kernel-checkout) for a sparse one).

## Adding a checkout

Press **Kernels…**, then **Add checkout…** and pick the top directory of the
kernel tree. The list shows each checkout with its version, read from the
kernel's `Makefile`. **Use** loads one; the first index of a checkout takes a
few seconds and is cached, so the next start is fast. The cache is rebuilt
when the bindings change. **Load kernel bindings…** in the library does the
same for a checkout not in the list yet.

The design records the kernel version it was built against. Opening it while
a different version is loaded shows a warning above the canvas, because
bindings may differ between kernels.

## Finding an element

Type in the search box: the search is fuzzy over the compatible string, the
vendor and the schema title, ranked by match quality, so `bme280`, `bosch
pressure` and `i2c eeprom` all work. Narrow it with the category list.
The star next to an element adds it to **Favorites**; elements you add show
up under **Recent**. Both are kept between sessions.

## Adding a node

Click an element, or drag it to the canvas. The new node comes with its
`compatible`, a `reg` placeholder, `status = "okay"` and the properties its
schema requires, filled with defaults where the schema has them. Properties
that still need a value are marked as to-do in the inspector.

**+ Empty node** adds a node without a compatible, for nodes the schemas do
not describe (`chosen`, `aliases`, `memory`).
