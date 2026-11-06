import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { CHILD_HANDLE, PARENT_HANDLE, REF_HANDLE, PHANDLE_HANDLE, type DtFlowNode, type FlowNode } from "./model";
import { canHaveChildren, inScope, mainScope, parentsOf, scopePath, scopeView } from "./scopes";

const dt = (id: string, name: string, extra: Partial<DtFlowNode> = {}): DtFlowNode => ({
  id,
  type: "dt",
  position: { x: 0, y: 0 },
  data: { name, compatible: [], properties: [] },
  ...extra,
});
const child = (from: string, to: string): Edge => ({
  id: `c-${to}`,
  source: from,
  target: to,
  sourceHandle: CHILD_HANDLE,
  targetHandle: PARENT_HANDLE,
});
const ref = (from: string, to: string): Edge => ({
  id: `r-${from}-${to}`,
  source: from,
  target: to,
  sourceHandle: REF_HANDLE,
  targetHandle: PHANDLE_HANDLE,
  type: "ref",
});

// / ── cpus ── cpu0
//   └─ soc ─┬ uart (clocks → osc)
//           └ i2c ── sensor
//   └─ osc
const nodes: FlowNode[] = [
  dt("root", "/"),
  dt("cpus", "cpus"),
  dt("cpu0", "cpu"),
  dt("soc", "soc"),
  dt("uart", "serial", { parentId: "g" }),
  dt("i2c", "i2c"),
  dt("sensor", "temperature"),
  dt("osc", "oscillator"),
  { id: "g", type: "group", position: { x: 0, y: 0 }, data: { title: "UARTs" } },
];
const edges = [
  child("root", "cpus"),
  child("cpus", "cpu0"),
  child("root", "soc"),
  child("soc", "uart"),
  child("soc", "i2c"),
  child("i2c", "sensor"),
  child("root", "osc"),
  ref("uart", "osc"),
  ref("i2c", "uart"),
];
const parents = parentsOf(edges);
const ids = (v: { nodes: FlowNode[] }) => v.nodes.map((n) => n.id);

describe("scopes", () => {
  it("opens on the root's children", () => {
    const main = mainScope(nodes, parents);
    expect(main).toBe("root");
    expect(ids(scopeView(nodes, edges, main, main, parents))).toEqual(["cpus", "soc", "osc"]);
  });

  it("shows a scope's children with their groups and the references between them, never child edges", () => {
    const view = scopeView(nodes, edges, "soc", "root", parents);
    expect(ids(view)).toEqual(["uart", "i2c", "g"]);
    expect(view.edges.map((e) => e.id)).toEqual(["r-i2c-uart"]);
  });

  it("puts top-level nodes beside the root on the main canvas", () => {
    const withOverride = [...nodes, dt("ovr", "&uart0")];
    expect(inScope("ovr", "root", "root", parents)).toBe(true);
    expect(ids(scopeView(withOverride, edges, "root", "root", parents))).toContain("ovr");
  });

  it("uses the top level when there is no root", () => {
    const fragments = [dt("a", "&i2c1"), dt("b", "&uart0")];
    const none = new Map<string, string>();
    expect(mainScope(fragments, none)).toBeNull();
    expect(ids(scopeView(fragments, [], null, null, none))).toEqual(["a", "b"]);
  });

  it("builds the breadcrumb from the main scope down", () => {
    expect(scopePath("i2c", "root", parents)).toEqual(["root", "soc", "i2c"]);
    expect(scopePath("root", "root", parents)).toEqual(["root"]);
  });

  it("opens scopes of containers and buses, the properties of leaves", () => {
    expect(canHaveChildren(dt("x", "soc"), false)).toBe(true);
    expect(canHaveChildren(dt("x", "i2c"), false)).toBe(true);
    expect(canHaveChildren(dt("x", "temperature"), true)).toBe(true);
    expect(canHaveChildren(dt("x", "temperature"), false)).toBe(false);
    expect(canHaveChildren(dt("x", "oscillator"), false)).toBe(false);
  });
});

describe("boundaryPorts", () => {
  const box = (y: number) => ({ x: 0, y, width: 100, height: 40 });
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = { uart: box(0), i2c: box(100) };
  const title = (id: string) => (id === "osc" ? "&osc24m" : id);

  it("gives each outside node one port per side and rewires the references to it", async () => {
    const { boundaryPorts, realId } = await import("./scopes");
    const crossing = [...edges, ref("cpu0", "i2c")];
    const shown = new Set(["uart", "i2c"]);
    const { nodes: ports, edges: rewired } = boundaryPorts(crossing, shown, (id) => boxes[id], title);
    expect(ports.map((p) => [p.id, p.data.title, p.data.side])).toEqual([
      ["boundary:in:cpu0", "cpu0", "in"],
      ["boundary:out:osc", "&osc24m", "out"],
    ]);
    // Out ports on the right of the scope's nodes, in ports on the left.
    expect(ports[1].position.x).toBeGreaterThan(100);
    expect(ports[0].position.x).toBeLessThan(0);
    // The edges keep their ids and end at the ports.
    expect(rewired.map((e) => [e.id, e.source, e.target])).toEqual([
      ["r-uart-osc", "uart", "boundary:out:osc"],
      ["r-cpu0-i2c", "boundary:in:cpu0", "i2c"],
    ]);
    expect(realId("boundary:out:osc")).toBe("osc");
    expect(realId("uart")).toBe("uart");
  });
});
