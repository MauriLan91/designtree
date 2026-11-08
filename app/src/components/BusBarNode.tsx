// The bus bar (US-16.3, D8): in an I²C, SPI or other bus scope, the
// controller drawn as a bar that its devices hang from. Clicking it edits
// the controller; the edges below it are generated and read-only.
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BusBarNode as BusBar } from "../scopes";

const KIND_TITLES = { i2c: "I²C", spi: "SPI", bus: "Bus" } as const;

export function BusBarNode({ data }: NodeProps<BusBar>) {
  return (
    <div className={`bus-bar bus-${data.kind}`} title="The bus controller: click to edit it">
      <span className="bus-bar-kind">{KIND_TITLES[data.kind]}</span>
      <span className="bus-bar-title">{data.title}</span>
      {data.taps.map((t) => (
        <Handle
          key={t.id}
          type="source"
          id={`tap:${t.id}`}
          position={Position.Bottom}
          isConnectable={false}
          className="bus-tap"
          style={{ left: t.x }}
        />
      ))}
    </div>
  );
}
