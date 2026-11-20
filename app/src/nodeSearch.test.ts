import { describe, expect, it } from "vitest";
import { CHILD_HANDLE, PARENT_HANDLE, type DtFlowNode, type DtNodeData } from "./model";
import { parentsOf } from "./scopes";
import { nodePaths, searchNodes } from "./nodeSearch";

const dt = (id: string, name: string, data: Partial<DtNodeData> = {}): DtFlowNode => ({
  id,
  type: "dt",
  position: { x: 0, y: 0 },
  data: { name, compatible: [], properties: [], ...data },
});
const child = (from: string, to: string) => ({ id: `c-${to}`, source: from, target: to, sourceHandle: CHILD_HANDLE, targetHandle: PARENT_HANDLE });

const nodes = [
  dt("root", "/"),
  dt("soc", "soc"),
  dt("uart0", "serial", { unitAddress: "1000", label: "uart0", compatible: ["ns16550a"] }),
  dt("uart1", "serial", { unitAddress: "2000", label: "console", compatible: ["vendor,uart"], phandle: 31 }),
  dt("pin", "uart-pins", { label: "pins_uart" }),
  dt("over", "&gpio"),
];
const edges = [child("root", "soc"), child("soc", "uart0"), child("soc", "uart1"), child("soc", "pin")];
const paths = nodePaths(nodes, parentsOf(edges));
const ids = (query: string) => searchNodes(nodes, paths, query).map((m) => m.id);

describe("searchNodes", () => {
  it("writes each node's path", () => {
    expect(paths.get("root")).toBe("/");
    expect(paths.get("uart1")).toBe("/soc/serial@2000");
    expect(paths.get("over")).toBe("&gpio");
  });

  it("finds by name, label, compatible, path and phandle", () => {
    expect(ids("console")).toEqual(["uart1"]);
    expect(ids("ns16550")).toEqual(["uart0"]);
    expect(ids("/soc/serial@1000")).toEqual(["uart0"]);
    expect(ids("31")).toEqual(["uart1"]);
    expect(ids("0x1f")).toEqual(["uart1"]);
    expect(ids("0x1")).toEqual([]);
    expect(ids("soc/ serial")).toEqual(["uart0", "uart1"]);
    // Without a slash the path is not searched, or "soc" would find its children.
    expect(ids("soc")).toEqual(["soc"]);
  });

  it("puts names and labels that are the query first, then ones that start with it", () => {
    // uart0's label and uart-pins start with it, in design order; uart1
    // has it only in its compatible.
    expect(ids("uart")).toEqual(["uart0", "pin", "uart1"]);
    expect(ids("uart-pins")).toEqual(["pin"]);
    expect(ids("pins")).toEqual(["pin"]);
    expect(ids("uart0")).toEqual(["uart0"]);
    expect(ids("serial@2000")).toEqual(["uart1"]);
    expect(ids("serial")).toEqual(["uart0", "uart1"]);
  });

  it("titles a node by its label and name, and matches all with no query", () => {
    expect(searchNodes(nodes, paths, "console")[0].title).toBe("console: serial@2000");
    expect(ids("")).toHaveLength(nodes.length);
  });
});
