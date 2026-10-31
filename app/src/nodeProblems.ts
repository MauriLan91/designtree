import { createContext } from "react";

/** Messages of the schema problems of each node, by node id. */
export const NodeProblems = createContext<ReadonlyMap<string, string[]>>(new Map());
