// Conversion between the design file (types generated from the Rust model in
// model.gen.ts) and the React Flow canvas.
import type { Edge, Node } from "@xyflow/react";

import type {
  AddressMap,
  Binding,
  LibraryEntry,
  Board,
  BoardLink,
  Cell,
  Connector,
  ConnectorPin,
  DtMacro,
  GpioLine,
  Graph,
  Group,
  Inherited,
  InterruptTree,
  LinkKind,
  MemReserve,
  NumberBase,
  Node as GraphNode,
  Edge as GraphEdge,
  Position,
  Problem,
  PinCheck,
  PinKind,
  Property,
  PropertySpec,
  Region,
  PropertyType,
  PropertyValue,
  SocDtsi,
  ValueChunk,
} from "./model.gen";

export type {
  AddressMap,
  Binding,
  LibraryEntry,
  Board,
  BoardLink,
  LinkKind,
  Connector,
  ConnectorPin,
  GpioLine,
  PinCheck,
  PinKind,
  InterruptTree,
  Region,
  Cell,
  DtMacro,
  Inherited,
  MemReserve,
  NumberBase,
  Position,
  Problem,
  Property,
  PropertySpec,
  PropertyType,
  PropertyValue,
  SocDtsi,
  ValueChunk,
};

// The wire format comes from the Rust types (model.gen.ts); the editor
// keeps its own names for the design file.
export type Design = Graph;
export type DesignNode = GraphNode;
export type DesignEdge = GraphEdge;
export type DesignGroup = Group;

/** The parts of a design that belong to the whole tree, not to a node or group. */
export type DesignExtras = Omit<Design, "nodes" | "edges" | "groups">;

// ---------------------------------------------------------------------------
// Canvas representation

export interface DtNodeData extends Record<string, unknown> {
  name: string;
  unitAddress?: string;
  label?: string;
  extraLabels?: string[];
  omitIfNoRef?: boolean;
  compatible: string[];
  properties: Property[];
  inherited?: Inherited;
  /** Where the device sits in the board view; unset when it is not placed there. */
  boardPosition?: Position;
  /** Binding the node was created from; editor-only, not saved. */
  binding?: Binding;
  /** Pre-filled placeholder properties the user has not reviewed yet; editor-only. */
  todo?: string[];
}

/** An edge that crosses the border of a collapsed group (see collapse.ts). */
export interface GroupPort {
  /** Handle id on the block. */
  id: string;
  /** `in`: something outside points at a node inside; `out`: the other way round. */
  direction: "in" | "out";
  label: string;
}

export interface GroupData extends Record<string, unknown> {
  title: string;
  /** Drawn as one block with ports instead of a frame around its members. */
  collapsed?: boolean;
  /** The frame's size while the group is collapsed, to give back on expanding; editor-only. */
  expandedSize?: { width: number; height: number };
  /** Ports of a collapsed group; filled in for drawing, not saved. */
  ports?: GroupPort[];
}

export interface RefData extends Record<string, unknown> {
  property: string;
  args: number[];
  /** The x where the reference, drawn as right angles, turns (US-9.5). */
  route?: number;
}

export type DtFlowNode = Node<DtNodeData, "dt">;
export type GroupFlowNode = Node<GroupData, "group">;
export type FlowNode = DtFlowNode | GroupFlowNode;

export const CHILD_HANDLE = "children";
export const PARENT_HANDLE = "parent";
export const REF_HANDLE = "ref";
export const PHANDLE_HANDLE = "phandle";

export function isDtNode(node: FlowNode): node is DtFlowNode {
  return node.type === "dt";
}

export function emptyDesign(): Design {
  return {
    nodes: [
      {
        id: "root",
        name: "/",
        properties: [
          { name: "#address-cells", value: { type: "cells", value: [1] } },
          { name: "#size-cells", value: { type: "cells", value: [1] } },
        ],
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
    groups: [],
  };
}

function absolutePosition(node: FlowNode, byId: Map<string, FlowNode>): Position {
  let { x, y } = node.position;
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  while (parent) {
    x += parent.position.x;
    y += parent.position.y;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return { x, y };
}

export function toDesign(nodes: FlowNode[], edges: Edge[], extras: DesignExtras = {}): Design {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const designNodes: DesignNode[] = nodes.filter(isDtNode).map((n) => ({
    id: n.id,
    name: n.data.name,
    unit_address: n.data.unitAddress || undefined,
    label: n.data.label || undefined,
    extra_labels: n.data.extraLabels,
    omit_if_no_ref: n.data.omitIfNoRef,
    compatible: n.data.compatible,
    properties: n.data.properties,
    inherited: n.data.inherited,
    position: absolutePosition(n, byId),
    board_position: n.data.boardPosition,
  }));

  const designEdges: DesignEdge[] = edges.map((e) =>
    e.sourceHandle === REF_HANDLE
      ? {
          from: e.source,
          to: e.target,
          kind: "reference",
          property: (e.data as RefData).property,
          args: (e.data as RefData).args,
          route: (e.data as RefData).route,
        }
      : { from: e.source, to: e.target, kind: "child" },
  );

  const buildGroup = (g: GroupFlowNode): DesignGroup => ({
    id: g.id,
    title: g.data.title,
    members: nodes.filter((n) => n.parentId === g.id && isDtNode(n)).map((n) => n.id),
    subgroups: nodes
      .filter((n): n is GroupFlowNode => n.parentId === g.id && n.type === "group")
      .map(buildGroup),
    position: absolutePosition(g, byId),
    // A collapsed group is measured as its block; its own size is what the
    // frame had (or still has once expanded).
    size: g.data.collapsed
      ? g.data.expandedSize ?? { width: 300, height: 200 }
      : { width: g.measured?.width ?? Number(g.style?.width ?? 300), height: g.measured?.height ?? Number(g.style?.height ?? 200) },
    collapsed: g.data.collapsed || undefined,
  });
  const designGroups = nodes
    .filter((n): n is GroupFlowNode => n.type === "group" && !n.parentId)
    .map(buildGroup);

  return { ...extras, nodes: designNodes, edges: designEdges, groups: designGroups };
}

export function fromDesign(design: Design): { nodes: FlowNode[]; edges: Edge[]; extras: DesignExtras } {
  const groupNodes: GroupFlowNode[] = [];
  const parentOf = new Map<string, { id: string; origin: Position }>();

  const walk = (g: DesignGroup, parent?: { id: string; origin: Position }) => {
    const abs = g.position ?? { x: 0, y: 0 };
    groupNodes.push({
      id: g.id,
      type: "group",
      data: { title: g.title, collapsed: g.collapsed, expandedSize: g.collapsed ? (g.size ?? undefined) : undefined },
      position: parent ? { x: abs.x - parent.origin.x, y: abs.y - parent.origin.y } : abs,
      parentId: parent?.id,
      style: { width: g.size?.width ?? 300, height: g.size?.height ?? 200 },
    });
    const self = { id: g.id, origin: abs };
    g.members.forEach((m) => parentOf.set(m, self));
    g.subgroups?.forEach((s) => walk(s, self));
  };
  design.groups.forEach((g) => walk(g));

  const dtNodes: DtFlowNode[] = design.nodes.map((n) => {
    const parent = parentOf.get(n.id);
    return {
      id: n.id,
      type: "dt",
      position: parent
        ? { x: n.position.x - parent.origin.x, y: n.position.y - parent.origin.y }
        : n.position,
      parentId: parent?.id,
      data: {
        name: n.name,
        unitAddress: n.unit_address ?? undefined,
        label: n.label ?? undefined,
        extraLabels: n.extra_labels,
        omitIfNoRef: n.omit_if_no_ref,
        compatible: n.compatible ?? [],
        properties: n.properties ?? [],
        inherited: n.inherited ?? undefined,
        boardPosition: n.board_position,
      },
    };
  });

  const edges: Edge[] = design.edges.map((e, i) =>
    e.kind === "child"
      ? { id: `e${i}`, source: e.from, target: e.to, sourceHandle: CHILD_HANDLE, targetHandle: PARENT_HANDLE }
      : {
          id: `e${i}`,
          source: e.from,
          target: e.to,
          sourceHandle: REF_HANDLE,
          targetHandle: PHANDLE_HANDLE,
          type: "ref",
          data: { property: e.property, args: e.args ?? [], ...(e.route != null ? { route: e.route } : {}) },
        },
  );

  // Parents must precede children in the React Flow node array.
  const { nodes: _nodes, edges: _edges, groups: _groups, ...extras } = design;
  return { nodes: [...groupNodes, ...dtNodes], edges, extras };
}

// ---------------------------------------------------------------------------
// Property text format, one property per line, DTS-like:
//   reg = <0x10000000 0x100>
//   status = "okay"
//   local-mac-address = [00 11 22 33 44 55]
//   dma-coherent

/**
 * The properties the backend read from the Text mode's `text`, with the
 * value of each line left exactly as `formatProperties` wrote it taken from
 * `previous`: values the text cannot spell the same way survive editing
 * other lines.
 */
export function keepUnchanged(parsed: Property[], text: string, previous: Property[]): Property[] {
  const lines = new Set(text.split("\n").map((l) => l.trim().replace(/;$/, "")));
  return parsed.map((p) => {
    const before = previous.find((q) => q.name === p.name);
    return before && lines.has(formatProperty(before)) ? before : p;
  });
}

export function formatCell(c: number, base: NumberBase = "hex"): string {
  if (base === "oct") return c > 0 ? `0${c.toString(8)}` : "0";
  return base === "dec" || c < 10 ? String(c) : `0x${c.toString(16)}`;
}

// Addresses read best in hex, everything else (frequencies, counts) in
// decimal: the same list as `NumberBase::default_for` in the core.
const HEX_PROPERTIES = new Set(["reg", "ranges", "dma-ranges", "interrupt-map", "interrupt-map-mask"]);

/** The base a property's numbers are shown and written in. */
export function baseOf(p: Pick<Property, "name" | "base">): NumberBase {
  return p.base ?? (HEX_PROPERTIES.has(p.name) ? "hex" : "dec");
}

function formatBytes(bytes: number[]): string {
  return `[${bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}]`;
}

function formatString(s: string): string {
  return JSON.stringify(s);
}

function formatReference(target: string): string {
  return target.startsWith("/") ? `&{${target}}` : `&${target}`;
}

function formatChunk(chunk: ValueChunk, base: NumberBase): string {
  switch (chunk.type) {
    case "cells": {
      const cells = chunk.cells.map((c) =>
        typeof c === "number" ? formatCell(c, base) : typeof c === "string" ? c : formatReference(c.phandle),
      );
      return `${chunk.bits === 32 ? "" : `/bits/ ${chunk.bits} `}<${cells.join(" ")}>`;
    }
    case "string":
      return formatString(chunk.value);
    case "bytes":
      return formatBytes(chunk.value);
    case "path":
      return formatReference(chunk.target);
  }
}

function formatProperty(p: Property): string {
  const base = baseOf(p);
  switch (p.value.type) {
    case "empty":
      return p.name;
    case "cells":
      return `${p.name} = ${formatChunk({ type: "cells", bits: 32, cells: p.value.value }, base)}`;
    case "strings":
      return `${p.name} = ${p.value.value.map(formatString).join(", ")}`;
    case "bytes":
      return `${p.name} = ${formatBytes(p.value.value)}`;
    case "mixed":
      return `${p.name} = ${p.value.value.map((c) => formatChunk(c, base)).join(", ")}`;
  }
}

export function formatProperties(props: Property[]): string {
  return props.map(formatProperty).join("\n");
}

// ---------------------------------------------------------------------------
// Helpers for new nodes and references

/** Generic node name for a binding category (devicetree spec 2.2.2). */
export function genericNodeName(binding: Binding): string {
  // CPU bindings live with their architecture (`arm/cpus.yaml`), whose
  // category would name the node `arm`; the schemas want `cpu`.
  if (/(^|\/)cpus?\.yaml$/.test(binding.path)) return "cpu";
  const names: Record<string, string> = {
    clock: "clock-controller",
    gpio: "gpio",
    i2c: "i2c",
    spi: "spi",
    serial: "serial",
    "interrupt-controller": "interrupt-controller",
    net: "ethernet",
    mmc: "mmc",
    usb: "usb",
    pinctrl: "pinctrl",
    regulator: "regulator",
    leds: "leds",
    display: "display",
    sound: "sound",
    watchdog: "watchdog",
    rtc: "rtc",
    pwm: "pwm",
    dma: "dma-controller",
    thermal: "thermal-sensor",
    iio: "adc",
  };
  return names[binding.category] ?? binding.category;
}

export function uniqueLabel(base: string, nodes: FlowNode[]): string {
  const clean = base.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  const taken = new Set(
    nodes.filter(isDtNode).flatMap((n) => [n.data.label, ...(n.data.extraLabels ?? [])]),
  );
  if (!taken.has(clean)) return clean;
  let i = 0;
  while (taken.has(`${clean}${i}`)) i++;
  return `${clean}${i}`;
}

/**
 * How export refers to an inherited node it deletes: a label the included
 * files give it, else its path (the id of an imported node).
 */
export function deletionTarget(node: DtFlowNode): string {
  const own = [node.data.label, ...(node.data.extraLabels ?? [])];
  return node.data.inherited?.labels?.find((l) => own.includes(l)) ?? node.id;
}

/** File name without directories, for display. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
