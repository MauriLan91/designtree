// Generated from the Rust types by crates/designtree-cli/tests/typegen.rs.
// Do not edit; regenerate with:
//   UPDATE_TS=1 cargo test -p designtree --test typegen

export type NodeId = string;

export type Position = { x: number, y: number, };

export type Size = { width: number, height: number, };

export type PropertyValue = { "type": "empty" } | { "type": "cells", "value": Array<number> } | { "type": "strings", "value": Array<string> } | { "type": "bytes", "value": Array<number> } | { "type": "mixed", "value": Array<ValueChunk> };

export type Cell = number | string | { phandle: string, };

export type ValueChunk = { "type": "cells", bits: number, cells: Array<Cell>, } | { "type": "string", value: string, } | { "type": "bytes", value: Array<number>, } | { "type": "path", target: string, };

export type Property = { name: string, value: PropertyValue, };

export type Inherited = { 
/**
 * File that first defines the node, as written in the import.
 */
file: string, 
/**
 * Labels the included files give the node.
 */
labels?: Array<string>, 
/**
 * Properties as the included files define them, `compatible` and
 * phandle lists included (as [`PropertyValue::Mixed`]).
 */
properties?: Array<Property>, 
/**
 * The included files mark the node `/omit-if-no-ref/`.
 */
omit_if_no_ref?: boolean, };

export type Node = { id: NodeId, 
/**
 * Node name without unit address, e.g. `serial`. The root node is `/`.
 */
name: string, 
/**
 * Unit address, e.g. `10000000` for `serial@10000000`.
 */
unit_address?: string | null, 
/**
 * DTS label used as phandle target, e.g. `uart0`.
 */
label?: string | null, 
/**
 * More labels for the same node (`l2: l2_cache: cache { };`).
 * References always use `label`.
 */
extra_labels?: Array<string>, 
/**
 * `/omit-if-no-ref/`: dtc drops the node unless something references it.
 */
omit_if_no_ref?: boolean, compatible?: Array<string>, properties?: Array<Property>, 
/**
 * Set when the node comes from an included file (an SoC `.dtsi`).
 * Export then writes only what differs from that definition, as an
 * override (`&label { ... };`).
 */
inherited?: Inherited | null, position: Position, 
/**
 * Where the device sits in the board view (US-14.1). Only the nodes
 * placed there have one. Like `position`, not part of the devicetree.
 */
board_position?: Position, };

export type EdgeKind = { "kind": "child" } | { "kind": "reference", property: string, args?: Array<number>, };

export type Edge = { from: NodeId, to: NodeId, } & ({ "kind": "child" } | { "kind": "reference", property: string, args?: Array<number>, });

export type Group = { id: string, title: string, members: Array<NodeId>, subgroups?: Array<Group>, position: Position, size?: Size | null, 
/**
 * Shown as one block whose ports are the edges that cross its border.
 */
collapsed?: boolean, };

export type MemReserve = { address: number | string, size: number | string, 
/**
 * Comes from an included file.
 */
inherited?: boolean, };

export type Overlay = { 
/**
 * The base design or board file, as it was opened.
 */
base: string, };

export type PinKind = "signal" | "power" | "ground";

export type GpioLine = { controller: NodeId, 
/**
 * The specifier cells without the trailing flags cell: `[5]` for
 * `<&gpio1 5 GPIO_ACTIVE_HIGH>`, `[1, 2]` for `<&pio 1 2 0>`.
 */
cells: Array<number>, };

export type ConnectorPin = { 
/**
 * Pin number printed on the connector.
 */
number: number, 
/**
 * Signal name, e.g. `GPIO17` or `I2C1_SDA`.
 */
name: string, kind: PinKind, 
/**
 * The GPIO line of the SoC pad wired to this pin.
 */
gpio?: GpioLine, 
/**
 * `pinctrl` groups that mux the pad to a function (an I2C, UART or
 * SPI signal). A device that selects one of them claims the pin.
 */
pinctrl?: Array<NodeId>, };

export type Connector = { id: string, 
/**
 * Name printed on the board, e.g. `J8`.
 */
title: string, 
/**
 * The template the pins came from (`rpi-40`), if any.
 */
template?: string, 
/**
 * Where the connector sits in the board view.
 */
position: Position, pins: Array<ConnectorPin>, };

export type Board = { 
/**
 * Image drawn under the devices, such as a board photo or a schematic
 * export, as a path; a relative path is relative to the design file.
 */
background?: string, 
/**
 * Connectors on the board, with the SoC pin behind each of their pins
 * (US-14.3).
 */
connectors?: Array<Connector>, };

export type Graph = { nodes: Array<Node>, edges: Array<Edge>, groups: Array<Group>, 
/**
 * `/memreserve/` entries: memory regions the OS must not use.
 */
memreserves?: Array<MemReserve>, 
/**
 * Include directives of the board file, in order (`#include
 * "imx8mp.dtsi"`), with its `#define`s and `#undef`s. Export writes
 * them, then only the board's own content; nodes from the included
 * files are marked [`Node::inherited`].
 */
includes?: Array<string>, 
/**
 * Directives like [`Graph::includes`] that come after the board's
 * first node, written at the end (an included PMIC `.dtsi` that fills
 * in a node the board declares).
 */
trailing_includes?: Array<string>, 
/**
 * Inherited nodes the board deletes, as reference targets (a label,
 * or a path starting with `/`).
 */
deleted_nodes?: Array<string>, 
/**
 * Set when the design is an overlay (`.dtso`) for another design: its
 * nodes are then marked [`Node::inherited`] and export writes only
 * what the overlay adds or changes.
 */
overlay?: Overlay, 
/**
 * Version of the kernel whose binding schemas the design was edited
 * against (`7.3`); the editor warns when it opens the design with
 * another one. Not part of the exported devicetree.
 */
kernel?: string | null, 
/**
 * The board view: devices placed over a picture of the board.
 */
board?: Board, };

export type InterruptController = { node: NodeId, 
/**
 * The controller this one cascades into; `None` for a top-level
 * controller such as the GIC.
 */
parent?: NodeId, 
/**
 * Devices wired to this controller, in design order.
 */
devices: Array<NodeId>, };

export type InterruptProblem = { node: NodeId, message: string, };

export type InterruptTree = { controllers: Array<InterruptController>, 
/**
 * Devices that cannot be placed under a controller, and malformed
 * specifiers.
 */
problems: Array<InterruptProblem>, };

export type PinState = { connector: string, number: number, 
/**
 * Enabled devices that claim the pad, in design order.
 */
claimed_by: Array<NodeId>, };

export type PinProblem = { connector: string, number: number, message: string, 
/**
 * The devices involved, to select on the canvas.
 */
nodes: Array<NodeId>, };

export type PinCheck = { pins: Array<PinState>, problems: Array<PinProblem>, };

export type Region = { node: NodeId, 
/**
 * Which entry of `reg` this is.
 */
index: number, 
/**
 * Address and size on the bus, as hex (`0x1c28000`).
 */
address: string, size: string, 
/**
 * The CPU address range, as hex; `None` when the bus is not memory
 * mapped (I2C, SPI) or the region is outside the bus's `ranges`.
 */
cpu_start?: string, cpu_end?: string, 
/**
 * Enabled nodes whose regions overlap this one.
 */
overlaps?: Array<NodeId>, 
/**
 * The region is not (or not entirely) inside a window of the bus's
 * `ranges`, so the CPU cannot reach (all of) it.
 */
out_of_range?: boolean, };

export type Bus = { node: NodeId, address_cells: number, size_cells: number, 
/**
 * Bus addresses are CPU addresses after translation; false for buses
 * without `ranges` (I2C, SPI, MDIO), whose addresses are local.
 */
memory_mapped: boolean, regions: Array<Region>, };

export type AddressProblem = { node: NodeId, message: string, };

export type AddressMap = { buses: Array<Bus>, 
/**
 * Overlaps, regions outside their bus's windows and malformed `reg` or
 * `ranges`.
 */
problems: Array<AddressProblem>, };

export type Problem = { severity: Severity, message: string, 
/**
 * Line in the generated source, when dtc gave one.
 */
line?: number | null, 
/**
 * The node the message is about, when it could be found.
 */
node?: NodeId | null, };

export type Severity = "warning" | "error";

export type PropertyType = "flag" | "string" | "string-array" | "non-unique-string-array" | "uint8" | "uint8-array" | "uint8-matrix" | "int8" | "int8-array" | "int8-matrix" | "uint16" | "uint16-array" | "uint16-matrix" | "int16" | "int16-array" | "int16-matrix" | "uint32" | "uint32-array" | "uint32-matrix" | "int32" | "int32-array" | "int32-matrix" | "uint64" | "uint64-array" | "uint64-matrix" | "int64" | "int64-array" | "int64-matrix" | "phandle" | "phandle-array" | "address" | "node";

export type PropertySpec = { name: string, description?: string | null, required: boolean, 
/**
 * Value type; `None` when the schemas do not pin one down.
 */
type?: PropertyType | null, 
/**
 * Allowed values, when the schema lists them.
 */
enum?: Array<unknown>, default?: unknown, 
/**
 * Bounds of each number in the value.
 */
minimum?: number, maximum?: number, 
/**
 * Bounds on the number of entries of an array value.
 */
min_items?: number, max_items?: number, };

export type Binding = { 
/**
 * Path relative to the bindings directory, e.g. `serial/8250.yaml`.
 */
path: string, 
/**
 * Library category, taken from the first directory component (`serial`).
 */
category: string, title?: string | null, compatibles?: Array<string>, properties?: Array<PropertySpec>, };

export type DtMacro = { name: string, value: number, 
/**
 * Header as written in `#include <...>`, e.g. `dt-bindings/gpio/gpio.h`.
 */
header: string, };

export type SocDtsi = { 
/**
 * `arm64`, `arm`, `riscv`, ... (the directory under `arch/`).
 */
arch: string, 
/**
 * The directory under `boot/dts/` (`freescale`, `rockchip`); empty for
 * files that lie directly in it.
 */
vendor: string, 
/**
 * The file name without `.dtsi`, with the subdirectory in front when
 * the vendor directory has them (`imx/imx6q`).
 */
name: string, 
/**
 * Path relative to the kernel tree, with `/` separators.
 */
path: string, };
