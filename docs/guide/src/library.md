# Kernel checkouts and the library

The library lists every device the kernel's binding schemas describe:
thousands of schemas and tens of thousands of compatible strings. It comes
only from a kernel checkout on your machine (see
[First start](installing.md#first-start-a-kernel-checkout) for a sparse one).

## Adding a checkout

Choose **Tools › Kernel checkouts…**, then **Add checkout…** and pick the top directory of the
kernel tree. The list shows each checkout with its version, read from the
kernel's `Makefile`. **Use** loads one; the first index of a checkout takes a
few seconds and is cached, so the next start is fast. The cache is rebuilt
when the bindings change. **Load kernel bindings…** in the library does the
same for a checkout not in the list yet.

The design records the kernel version it was built against. Opening it while
a different version is loaded shows a warning above the canvas, because
bindings may differ between kernels.

## Finding an element

Every compatible string is an element of its own, titled from the schema
that documents it: `arm,cortex-a7` and `arm,cortex-a9` are two elements
named "ARM CPUs". The list holds all of them and scrolls through the whole
library.

## Browsing by category

Before you search, the library is grouped like a component palette:
**Favorites** and **Recent** first, then one section per category (the
directory of the schema in the kernel, such as *Serial* or *Interrupt
controller*), each with its icon and the number of elements. Click a
section header to open or close it; categories start closed so the whole
library reads as one short list of headers. The two buttons next to the
category list switch between a **list**, with the schema title of each
element, and a **grid** of compact tiles that fits more at once. The view
and the open sections are remembered.

Type in the search box: the search is fuzzy over the compatible string, the
vendor and the schema title, ranked by match quality, so `bme280`, `bosch
pressure` and `i2c eeprom` all work. The words you typed are highlighted
and the count above the list says how many elements match. Narrow it with
the category list.
The star next to an element adds it to **Favorites**; elements you add show
up under **Recent**. Both are kept between sessions. While a search is
typed, the sections give way to one list of matches, best first.

## Adding a node

Double-click an element, or drag it to the canvas. The new node comes with
that element's `compatible`, a `reg` placeholder, `status = "okay"` and the properties its
schema requires, filled with defaults where the schema has them. Properties
that still need a value are marked as to-do in the inspector.

## Basic nodes

The **Basic** section, always on top and there even before a kernel is
loaded, holds the nodes every board has and no compatible names: the
**Root node**, **CPUs** (`cpus`) and a **CPU** (`cpu@0`), **Memory**
(`memory@0`), **Chosen**, **Aliases** and **Reserved memory**. Their
properties come from the dt-schema core schemas built into the app, so each
arrives with its required properties, set where there is only one choice
(`device_type = "memory"`) and to-do otherwise. A design has a single root:
adding the **Root node** gives the existing root its schema, so `model`,
`compatible` and the cell sizes show as required rows, instead of adding a
second root. Likewise a second **Chosen**, **Aliases**, **CPUs** or
**Reserved memory** in the same place selects the one already there, and a
second **CPU** or **Memory** takes the next unit address (`cpu@1`).

The last entry, **Empty node**, adds a node with nothing preset, for
anything else.
