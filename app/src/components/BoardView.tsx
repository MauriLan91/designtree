// The board view (US-14.1): the devices placed where they sit on the PCB,
// over a photo or schematic of the board. It is a second canvas over the
// same nodes as the graph: positions live on the nodes (`boardPosition`),
// and selecting a device here selects it in the graph.
import { memo, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { backend, dialogs, inTauri } from "../backend";
import { isDtNode, type Board, type DtFlowNode, type FlowNode } from "../model";

const PLACE_MIME = "application/x-designtree-node";

interface DeviceData extends Record<string, unknown> {
  title: string;
  compatible?: string;
}
type DeviceNode = Node<DeviceData, "device">;

const Device = memo(function Device({ data, selected }: NodeProps<DeviceNode>) {
  return (
    <div className={`board-device${selected ? " selected" : ""}`}>
      <div className="board-device-title">{data.title}</div>
      {data.compatible && <div className="board-device-compatible">{data.compatible}</div>}
    </div>
  );
});
const nodeTypes = { device: Device };

const title = (n: DtFlowNode) => {
  const name = n.data.unitAddress ? `${n.data.name}@${n.data.unitAddress}` : n.data.name;
  return n.data.label ? `${n.data.label}: ${name}` : name;
};

interface Props {
  nodes: FlowNode[];
  board: Board | undefined;
  /** The design file, against which a relative background path resolves. */
  designPath: string | null;
  /** Moves devices onto the board (a position) or off it (null). */
  onPlace: (positions: Map<string, XYPosition | null>) => void;
  onSelect: (ids: string[]) => void;
  onBoardChange: (board: Board | undefined) => void;
}

export function BoardView(props: Props) {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  );
}

function BoardCanvas({ nodes, board, designPath, onPlace, onSelect, onBoardChange }: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const devices = useMemo(() => nodes.filter(isDtNode), [nodes]);
  // React Flow draws a node once it knows its size, which only the canvas
  // measures: sizes are kept here, as the nodes come from the design.
  const [measured, setMeasured] = useState(new Map<string, { width: number; height: number }>());
  const placed: DeviceNode[] = useMemo(
    () =>
      devices
        .filter((n) => n.data.boardPosition)
        .map((n) => ({
          id: n.id,
          type: "device",
          position: n.data.boardPosition!,
          selected: n.selected,
          measured: measured.get(n.id),
          data: { title: title(n), compatible: n.data.compatible[0] },
        })),
    [devices, measured],
  );
  const [filter, setFilter] = useState("");
  const unplaced = devices.filter(
    (n) => !n.data.boardPosition && title(n).toLowerCase().includes(filter.trim().toLowerCase()),
  );

  const [image, setImage] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    const path = board?.background;
    if (!path || !inTauri) {
      setImage({ url: null, error: null });
      return;
    }
    let stale = false;
    backend.readBoardImage(path, designPath).then(
      (url) => !stale && setImage({ url, error: null }),
      (e) => !stale && setImage({ url: null, error: String(e) }),
    );
    return () => {
      stale = true;
    };
  }, [board?.background, designPath]);

  const onNodesChange = (changes: NodeChange<DeviceNode>[]) => {
    const positions = new Map<string, XYPosition | null>();
    const sizes: [string, { width: number; height: number }][] = [];
    let selection: Set<string> | null = null;
    for (const c of changes) {
      if (c.type === "position" && c.position) positions.set(c.id, c.position);
      // Deleting on the board takes the device off the board, not out of the design.
      else if (c.type === "remove") positions.set(c.id, null);
      else if (c.type === "dimensions" && c.dimensions) sizes.push([c.id, c.dimensions]);
      else if (c.type === "select") {
        selection ??= new Set(placed.filter((n) => n.selected).map((n) => n.id));
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    }
    if (positions.size) onPlace(positions);
    if (selection) onSelect([...selection]);
    if (sizes.length) setMeasured((m) => new Map([...m, ...sizes]));
  };

  const onDrop = (e: DragEvent) => {
    // Library entries dropped here would land on the hidden graph.
    e.stopPropagation();
    e.preventDefault();
    const id = e.dataTransfer.getData(PLACE_MIME);
    if (!id) return;
    onPlace(new Map([[id, screenToFlowPosition({ x: e.clientX, y: e.clientY })]]));
    onSelect([id]);
  };

  const chooseBackground = async () => {
    const path = await dialogs.pickBoardImage();
    if (path) onBoardChange({ ...board, background: path });
  };

  return (
    <div className="board-view">
      <div className="board-devices">
        <div className="board-actions">
          <button onClick={chooseBackground} disabled={!inTauri}>
            Background…
          </button>
          {board?.background && (
            <button onClick={() => onBoardChange({ ...board, background: undefined })}>Clear</button>
          )}
        </div>
        {image.error && <p className="error">{image.error}</p>}
        <h2>Not on the board</h2>
        <p className="hint">Drag a device onto the board. Delete takes it off again.</p>
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul>
          {unplaced.slice(0, 200).map((n) => (
            <li
              key={n.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PLACE_MIME, n.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              title={n.data.compatible.join(", ")}
            >
              {title(n)}
            </li>
          ))}
          {unplaced.length > 200 && <li className="hint">{unplaced.length - 200} more; filter to find them</li>}
        </ul>
      </div>
      <div className="board-canvas" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
        <ReactFlow
          nodes={placed}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.05}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          {image.url && (
            <ViewportPortal>
              <img className="board-background" src={image.url} alt="" draggable={false} />
            </ViewportPortal>
          )}
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
