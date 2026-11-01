import { createContext } from "react";
import type { NodePortSet } from "./ports";

/** Typed ports of each node on the canvas, by node id. */
export const NodePorts = createContext<Map<string, NodePortSet>>(new Map());
