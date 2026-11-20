import { describe, expect, it } from "vitest";
import { copySelection, pasteClipboard } from "./clipboard";
import { fromDesign, isDtNode, toDesign, type Design } from "./model";

// A decompiled tree keeps phandles and property order the canvas never shows.
const design: Design = {
  nodes: [
    { id: "/", name: "/", position: { x: 0, y: 0 } },
    {
      id: "/clk",
      name: "clk",
      label: "clk",
      properties: [{ name: "#clock-cells", value: { type: "cells", value: [0] } }],
      phandle: 7,
      position: { x: 0, y: 0 },
    },
    {
      id: "/uart",
      name: "uart",
      properties: [{ name: "status", value: { type: "strings", value: ["okay"] } }],
      order: ["clocks", "status"],
      position: { x: 0, y: 0 },
    },
  ],
  edges: [
    { from: "/", to: "/clk", kind: "child" },
    { from: "/", to: "/uart", kind: "child" },
    { from: "/uart", to: "/clk", kind: "reference", property: "clocks" },
  ],
  groups: [],
} as Design;

describe("decompiled trees", () => {
  it("keep their phandles and property order through the canvas", () => {
    const { nodes, edges } = fromDesign(design);
    const back = toDesign(nodes, edges);
    expect(back.nodes.find((n) => n.id === "/clk")?.phandle).toBe(7);
    expect(back.nodes.find((n) => n.id === "/uart")?.order).toEqual(["clocks", "status"]);
  });

  it("do not copy a phandle into a pasted node", () => {
    const { nodes, edges } = fromDesign(design);
    const selected = nodes.map((n) => (n.id === "/clk" ? { ...n, selected: true } : n));
    const clip = copySelection(selected, edges)!;
    const pasted = pasteClipboard(clip, nodes, edges, null, (p) => `${p}1`);
    const copy = pasted.nodes.find((n) => n.id === "n1");
    expect(copy && isDtNode(copy)).toBe(true);
    expect(copy && isDtNode(copy) && copy.data.phandle).toBeUndefined();
  });
});
