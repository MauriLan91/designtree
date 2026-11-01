// The board view (US-14.1): the devices placed where they sit on the PCB,
// over a photo or schematic of the board. It is a second canvas over the
// same nodes as the graph: positions live on the nodes (`boardPosition`),
// and selecting a device here selects it in the graph.
//
// Connectors (US-14.3) sit on the same canvas. Each pin names the SoC pad
// behind it, and the backend's pin check tells which devices claim it.
import { memo, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { backend, dialogs, inTauri } from "../backend";
import { pinRows, templatePins, TEMPLATES } from "../connectorTemplates";
import {
  isDtNode,
  REF_HANDLE,
  type Board,
  type Connector,
  type ConnectorPin,
  type DtFlowNode,
  type FlowNode,
  type PinCheck,
  type PinKind,
  type RefData,
} from "../model";

const PLACE_MIME = "application/x-designtree-node";
/** Connectors share the canvas with devices, whose ids are node ids. */
const CONNECTOR = "connector:";

interface DeviceData extends Record<string, unknown> {
  title: string;
  compatible?: string;
}
type DeviceNode = Node<DeviceData, "device">;

type PinStatus = "power" | "ground" | "conflict" | "claimed" | "free" | "unmapped";

interface ConnectorData extends Record<string, unknown> {
  connector: Connector;
  status: Map<number, PinStatus>;
  selectedPin: number | null;
  onPin: (connector: string, number: number) => void;
}
type ConnectorNode = Node<ConnectorData, "connector">;
type BoardNode = DeviceNode | ConnectorNode;

const Device = memo(function Device({ data, selected }: NodeProps<DeviceNode>) {
  return (
    <div className={`board-device${selected ? " selected" : ""}`}>
      <div className="board-device-title">{data.title}</div>
      {data.compatible && <div className="board-device-compatible">{data.compatible}</div>}
    </div>
  );
});

const ConnectorBlock = memo(function ConnectorBlock({ data, selected }: NodeProps<ConnectorNode>) {
  const { connector, status, selectedPin, onPin } = data;
  const byNumber = new Map(connector.pins.map((p) => [p.number, p]));
  const rows = pinRows(connector.template, connector.pins.map((p) => p.number));
  const cell = (number: number | null, side: "left" | "right") => {
    const pin = number === null ? undefined : byNumber.get(number);
    if (!pin) return <span className="pin-empty" />;
    return (
      <button
        className={`pin pin-${status.get(pin.number) ?? "unmapped"} pin-${side}${selectedPin === pin.number ? " selected" : ""}`}
        title={`${pin.number} ${pin.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onPin(connector.id, pin.number);
        }}
      >
        <span className="pin-number">{pin.number}</span>
        <span className="pin-name">{pin.name}</span>
      </button>
    );
  };
  return (
    <div className={`board-connector${selected ? " selected" : ""}`}>
      <div className="board-device-title">{connector.title}</div>
      <div className={`pin-grid cols-${rows[0]?.length ?? 1}`}>
        {rows.map((row, i) => (
          <div className="pin-row" key={i}>
            {cell(row[0], "left")}
            {row.length > 1 && cell(row[1], "right")}
          </div>
        ))}
      </div>
    </div>
  );
});

const nodeTypes = { device: Device, connector: ConnectorBlock };

const title = (n: DtFlowNode) => {
  const name = n.data.unitAddress ? `${n.data.name}@${n.data.unitAddress}` : n.data.name;
  return n.data.label ? `${n.data.label}: ${name}` : name;
};

const hasProperty = (n: DtFlowNode, name: string) => n.data.properties.some((p) => p.name === name);
const isPinctrlState = (e: Edge) =>
  e.sourceHandle === REF_HANDLE && /^pinctrl-\d+$/.test((e.data as RefData).property);
/** What the group field takes: labels are unique, names are not. */
const groupKey = (n: DtFlowNode) => n.data.label ?? n.id;
const pinKey = (connector: string, number: number) => `${connector}#${number}`;
const NO_CONNECTORS: Connector[] = [];

interface Props {
  nodes: FlowNode[];
  edges: Edge[];
  board: Board | undefined;
  /** What claims each connector pin; null until checked. */
  pinCheck: PinCheck | null;
  /** The design file, against which a relative background path resolves. */
  designPath: string | null;
  /** Moves devices onto the board (a position) or off it (null). */
  onPlace: (positions: Map<string, XYPosition | null>) => void;
  onSelect: (ids: string[]) => void;
  onBoardChange: (board: Board) => void;
}

export function BoardView(props: Props) {
  return (
    <ReactFlowProvider>
      <BoardCanvas {...props} />
    </ReactFlowProvider>
  );
}

function BoardCanvas({ nodes, edges, board, pinCheck, designPath, onPlace, onSelect, onBoardChange }: Props) {
  const { screenToFlowPosition, getViewport } = useReactFlow();
  const devices = useMemo(() => nodes.filter(isDtNode), [nodes]);
  const connectors = board?.connectors ?? NO_CONNECTORS;
  // React Flow draws a node once it knows its size, which only the canvas
  // measures: sizes are kept here, as the nodes come from the design.
  const [measured, setMeasured] = useState(new Map<string, { width: number; height: number }>());
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [selectedPin, setSelectedPin] = useState<{ connector: string; number: number } | null>(null);

  const status = useMemo(() => {
    const conflicts = new Set(pinCheck?.problems.map((p) => pinKey(p.connector, p.number)));
    const claimed = new Map(pinCheck?.pins.map((p) => [pinKey(p.connector, p.number), p.claimed_by.length > 0]));
    const byConnector = new Map<string, Map<number, PinStatus>>();
    for (const c of connectors) {
      const pins = new Map<number, PinStatus>();
      for (const p of c.pins) {
        const key = pinKey(c.id, p.number);
        pins.set(
          p.number,
          p.kind !== "signal"
            ? p.kind
            : conflicts.has(key)
              ? "conflict"
              : claimed.get(key)
                ? "claimed"
                : p.gpio || p.pinctrl?.length
                  ? "free"
                  : "unmapped",
        );
      }
      byConnector.set(c.id, pins);
    }
    return byConnector;
  }, [connectors, pinCheck]);

  const flowNodes: BoardNode[] = useMemo(() => {
    const onPin = (connector: string, number: number) => {
      setSelectedConnector(connector);
      setSelectedPin({ connector, number });
    };
    const placed: BoardNode[] = devices
      .filter((n) => n.data.boardPosition)
      .map((n) => ({
        id: n.id,
        type: "device",
        position: n.data.boardPosition!,
        selected: n.selected,
        measured: measured.get(n.id),
        data: { title: title(n), compatible: n.data.compatible[0] },
      }));
    const blocks: BoardNode[] = connectors.map((c) => ({
      id: CONNECTOR + c.id,
      type: "connector",
      position: c.position,
      selected: c.id === selectedConnector,
      measured: measured.get(CONNECTOR + c.id),
      data: {
        connector: c,
        status: status.get(c.id) ?? new Map(),
        selectedPin: selectedPin?.connector === c.id ? selectedPin.number : null,
        onPin,
      },
    }));
    return [...placed, ...blocks];
  }, [devices, connectors, status, measured, selectedConnector, selectedPin]);

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

  const setConnectors = (update: (cs: Connector[]) => Connector[]) =>
    onBoardChange({ ...board, connectors: update(connectors) });
  const updateConnector = (id: string, patch: Partial<Connector>) =>
    setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updatePin = (connector: string, number: number, patch: Partial<ConnectorPin>) =>
    setConnectors((cs) =>
      cs.map((c) =>
        c.id === connector ? { ...c, pins: c.pins.map((p) => (p.number === number ? { ...p, ...patch } : p)) } : c,
      ),
    );

  const onNodesChange = (changes: NodeChange<BoardNode>[]) => {
    const positions = new Map<string, XYPosition | null>();
    const moved = new Map<string, XYPosition>();
    const removed = new Set<string>();
    const sizes: [string, { width: number; height: number }][] = [];
    let selection: Set<string> | null = null;
    for (const c of changes) {
      if (c.type === "dimensions") {
        if (c.dimensions) sizes.push([c.id, c.dimensions]);
        continue;
      }
      if (c.type === "add" || c.type === "replace") continue;
      if (c.id.startsWith(CONNECTOR)) {
        const id = c.id.slice(CONNECTOR.length);
        if (c.type === "position" && c.position) moved.set(id, c.position);
        else if (c.type === "remove") removed.add(id);
        else if (c.type === "select") {
          setSelectedConnector((s) => (c.selected ? id : s === id ? null : s));
          if (!c.selected) setSelectedPin((p) => (p?.connector === id ? null : p));
        }
        continue;
      }
      if (c.type === "position" && c.position) positions.set(c.id, c.position);
      // Deleting on the board takes the device off the board, not out of the design.
      else if (c.type === "remove") positions.set(c.id, null);
      else if (c.type === "select") {
        selection ??= new Set(devices.filter((n) => n.selected && n.data.boardPosition).map((n) => n.id));
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    }
    if (positions.size) onPlace(positions);
    if (selection) onSelect([...selection]);
    if (moved.size || removed.size) {
      setConnectors((cs) =>
        cs.filter((c) => !removed.has(c.id)).map((c) => (moved.has(c.id) ? { ...c, position: moved.get(c.id)! } : c)),
      );
    }
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
    if (path) onBoardChange({ ...board, connectors, background: path });
  };

  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [pinCount, setPinCount] = useState(10);
  const addConnector = () => {
    const template = TEMPLATES.find((t) => t.id === templateId)!;
    const count = template.generic?.rows === 2 ? pinCount + (pinCount % 2) : pinCount;
    let n = connectors.length + 1;
    while (connectors.some((c) => c.id === `j${n}`)) n++;
    // Near the top left of what the canvas shows, a step from the last one.
    const { x, y, zoom } = getViewport();
    const step = 30 * (connectors.length % 10);
    const connector: Connector = {
      id: `j${n}`,
      title: `J${n}`,
      template: template.id,
      position: { x: (200 + step - x) / zoom, y: (100 + step - y) / zoom },
      pins: templatePins(template, Math.max(1, Math.min(count, 200))),
    };
    setConnectors((cs) => [...cs, connector]);
    setSelectedConnector(connector.id);
    setSelectedPin(null);
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
        <h2>Connectors</h2>
        <div className="board-actions">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Connector template">
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {TEMPLATES.find((t) => t.id === templateId)?.generic && (
            <input
              type="number"
              min={1}
              max={200}
              value={pinCount}
              onChange={(e) => setPinCount(Number(e.target.value) || 1)}
              aria-label="Pins"
              className="pin-count"
            />
          )}
          <button onClick={addConnector}>Add</button>
        </div>
        {pinCheck && pinCheck.problems.length > 0 && (
          <ul className="pin-problems">
            {pinCheck.problems.map((p, i) => (
              <li
                key={i}
                className="error"
                onClick={() => {
                  setSelectedConnector(p.connector);
                  setSelectedPin({ connector: p.connector, number: p.number });
                  if (p.nodes.length) onSelect(p.nodes);
                }}
              >
                {connectors.find((c) => c.id === p.connector)?.title ?? p.connector} pin {p.number}: {p.message}
              </li>
            ))}
          </ul>
        )}
        {selectedConnector && (
          <ConnectorEditor
            key={selectedConnector}
            connector={connectors.find((c) => c.id === selectedConnector)}
            pin={selectedPin?.connector === selectedConnector ? selectedPin.number : null}
            devices={devices}
            edges={edges}
            pinCheck={pinCheck}
            onConnector={(patch) => updateConnector(selectedConnector, patch)}
            onPin={(number, patch) => updatePin(selectedConnector, number, patch)}
            onSelect={onSelect}
          />
        )}
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
          nodes={flowNodes}
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

interface EditorProps {
  connector: Connector | undefined;
  pin: number | null;
  devices: DtFlowNode[];
  edges: Edge[];
  pinCheck: PinCheck | null;
  onConnector: (patch: Partial<Connector>) => void;
  onPin: (number: number, patch: Partial<ConnectorPin>) => void;
  onSelect: (ids: string[]) => void;
}

function ConnectorEditor({ connector, pin: number, devices, edges, pinCheck, onConnector, onPin, onSelect }: EditorProps) {
  const byId = useMemo(() => new Map(devices.map((n) => [n.id, n])), [devices]);
  const controllers = useMemo(() => devices.filter((n) => hasProperty(n, "gpio-controller")), [devices]);
  // Groups some device selects, and every node under a pin controller:
  // the groups no device selects yet are the ones a new device would use.
  // A pin controller is named or made one (`pinctrl`, `iomuxc`), or holds a
  // selected group, directly or under a function node without
  // `compatible` (Rockchip's `pinctrl { i2c1 { i2c1m2-xfer } }`).
  const groups = useMemo(() => {
    const byId = new Map(devices.map((n) => [n.id, n]));
    const ids = new Set(edges.filter(isPinctrlState).map((e) => e.target));
    const parent = new Map(edges.filter((e) => e.sourceHandle !== REF_HANDLE).map((e) => [e.target, e.source]));
    const muxLike = /pinctrl|pinmux|iomux/;
    const muxes = new Set(
      devices
        .filter((n) => muxLike.test(n.data.name) || n.data.compatible.some((c) => muxLike.test(c)))
        .map((n) => n.id),
    );
    for (const id of ids) {
      const up = parent.get(id);
      if (!up) continue;
      const above = parent.get(up);
      const mux = byId.get(up)?.data.compatible.length || !above ? up : above;
      // Groups at the top level would make every node a group.
      if (byId.get(mux)?.data.name !== "/") muxes.add(mux);
    }
    for (const n of devices) {
      for (let at = parent.get(n.id), depth = 0; at && depth < 64; at = parent.get(at), depth++) {
        if (muxes.has(at)) {
          ids.add(n.id);
          break;
        }
      }
    }
    return devices.filter((n) => ids.has(n.id));
  }, [devices, edges]);
  const [group, setGroup] = useState("");

  if (!connector) return null;
  const found = connector.pins.find((p) => p.number === number);
  const pin = found && { ...found, pinctrl: found.pinctrl ?? [] };
  const claimedBy = pin
    ? (pinCheck?.pins.find((p) => p.connector === connector.id && p.number === pin.number)?.claimed_by ?? [])
    : [];
  const name = (id: string) => {
    const n = byId.get(id);
    return n ? title(n) : `${id} (missing)`;
  };

  const addGroup = () => {
    const found = groups.find((n) => groupKey(n) === group.trim());
    if (!pin || !found || pin.pinctrl.includes(found.id)) return;
    onPin(pin.number, { pinctrl: [...pin.pinctrl, found.id] });
    setGroup("");
  };

  return (
    <div className="connector-editor">
      <label>
        Title
        <input value={connector.title} onChange={(e) => onConnector({ title: e.target.value })} />
      </label>
      {!pin ? (
        <p className="hint">Click a pin to map it to an SoC pad.</p>
      ) : (
        <>
          <h3>Pin {pin.number}</h3>
          <label>
            Name
            <input value={pin.name} onChange={(e) => onPin(pin.number, { name: e.target.value })} />
          </label>
          <label>
            Kind
            <select value={pin.kind} onChange={(e) => onPin(pin.number, { kind: e.target.value as PinKind })}>
              <option value="signal">Signal</option>
              <option value="power">Power</option>
              <option value="ground">Ground</option>
            </select>
          </label>
          {pin.kind === "signal" && (
            <>
              <label>
                GPIO controller
                <select
                  value={pin.gpio?.controller ?? ""}
                  onChange={(e) =>
                    onPin(pin.number, {
                      gpio: e.target.value ? { controller: e.target.value, cells: pin.gpio?.cells ?? [0] } : undefined,
                    })
                  }
                >
                  <option value="">None</option>
                  {pin.gpio && !byId.has(pin.gpio.controller) && (
                    <option value={pin.gpio.controller}>{name(pin.gpio.controller)}</option>
                  )}
                  {controllers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {title(n)}
                    </option>
                  ))}
                </select>
              </label>
              {pin.gpio && (
                <label title="The specifier cells without the flags, e.g. 5 for <&gpio1 5 GPIO_ACTIVE_HIGH>">
                  GPIO line
                  <LineInput
                    key={`${pin.number}`}
                    cells={pin.gpio.cells}
                    onChange={(cells) => onPin(pin.number, { gpio: { ...pin.gpio!, cells } })}
                  />
                </label>
              )}
              <div className="pin-groups">
                Pinctrl groups
                <ul>
                  {pin.pinctrl.map((id) => (
                    <li key={id}>
                      <span>{name(id)}</span>
                      <button
                        aria-label="Remove group"
                        onClick={() => onPin(pin.number, { pinctrl: pin.pinctrl.filter((g) => g !== id) })}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="board-actions">
                  <input
                    list="pinctrl-groups"
                    placeholder="Group"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addGroup()}
                  />
                  <button onClick={addGroup}>Add</button>
                </div>
                <datalist id="pinctrl-groups">
                  {groups.map((n) => (
                    <option key={n.id} value={groupKey(n)}>
                      {title(n)}
                    </option>
                  ))}
                </datalist>
              </div>
              <div>
                Claimed by
                {claimedBy.length === 0 ? (
                  <p className="hint">No enabled device.</p>
                ) : (
                  <ul>
                    {claimedBy.map((id) => (
                      <li key={id} onClick={() => onSelect([id])} title="Select">
                        {name(id)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Cells as typed (`1 5`), applied when they parse. */
function LineInput({ cells, onChange }: { cells: number[]; onChange: (cells: number[]) => void }) {
  const [text, setText] = useState(cells.join(" "));
  const parse = (t: string) => {
    const parts = t.trim().split(/[\s,]+/).filter(Boolean);
    const values = parts.map((p) => Number(p));
    return parts.length && values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff) ? values : null;
  };
  return (
    <input
      value={text}
      aria-invalid={parse(text) === null}
      onChange={(e) => {
        setText(e.target.value);
        const values = parse(e.target.value);
        if (values) onChange(values);
      }}
    />
  );
}
