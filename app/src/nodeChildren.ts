import { createContext } from "react";

/** What a node card needs to show what is inside it (US-16.7). */
export interface NodeChildrenInfo {
  /** How many child nodes each node has, by id; nodes without any are absent. */
  count: ReadonlyMap<string, number>;
  /** Opens a node's scope. */
  open: (id: string) => void;
}

export const NodeChildren = createContext<NodeChildrenInfo>({ count: new Map(), open: () => {} });
