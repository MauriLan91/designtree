use serde::{Deserialize, Serialize};

/// Stable identifier of a node inside a [`Graph`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NodeId(pub String);

impl From<&str> for NodeId {
    fn from(s: &str) -> Self {
        NodeId(s.to_owned())
    }
}

/// Position of an element on the editor canvas. Ignored by DTS generation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

/// The value of a devicetree property.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "kebab-case")]
pub enum PropertyValue {
    /// Boolean property, present without a value (`dma-coherent;`).
    Empty,
    /// One or more 32-bit cells (`reg = <0x1000 0x100>;`).
    Cells(Vec<u32>),
    /// One or more strings (`compatible = "a", "b";`).
    Strings(Vec<String>),
    /// Raw bytes (`local-mac-address = [00 11 22 33 44 55];`).
    Bytes(Vec<u8>),
    /// Any other value, kept chunk by chunk as written in the source:
    /// strings mixed with cells, `/bits/` sizes other than 32, path
    /// references (`stdout-path = &uart0;`) and phandles that are not at
    /// the start of a cell list (`interrupt-map`).
    Mixed(Vec<ValueChunk>),
}

/// One comma-separated piece of a [`PropertyValue::Mixed`] value.
///
/// Reference targets in chunks are a label (`uart0`), or a node path when
/// they start with `/` (`/soc/serial@0`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ValueChunk {
    /// `<...>` cell list, `bits` wide (8, 16, 32 or 64).
    Cells {
        bits: u8,
        cells: Vec<Cell>,
    },
    String {
        value: String,
    },
    Bytes {
        value: Vec<u8>,
    },
    /// `&target` outside a cell list; expands to the full path of the target.
    Path {
        target: String,
    },
}

/// One element of a cell list.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Cell {
    /// A JSON number up to 2^53 - 1, a hex string (`"0x..."`) above that,
    /// so that JavaScript reads every value exactly.
    Number(#[serde(with = "json_safe_u64")] u64),
    /// `&target`, replaced by the phandle of the target node.
    Phandle { phandle: String },
}

mod json_safe_u64 {
    use serde::de::Error;
    use serde::{Deserialize, Deserializer, Serializer};

    const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        if *value <= MAX_SAFE_INTEGER {
            serializer.serialize_u64(*value)
        } else {
            serializer.serialize_str(&format!("{value:#x}"))
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Number(u64),
            Hex(String),
        }
        match Repr::deserialize(deserializer)? {
            Repr::Number(n) => Ok(n),
            Repr::Hex(text) => text
                .strip_prefix("0x")
                .and_then(|hex| u64::from_str_radix(hex, 16).ok())
                .ok_or_else(|| D::Error::custom(format!("invalid cell value `{text}`"))),
        }
    }
}

/// Size of a group frame on the editor canvas.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Size {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Property {
    pub name: String,
    pub value: PropertyValue,
}

/// A devicetree node placed on the canvas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    /// Node name without unit address, e.g. `serial`. The root node is `/`.
    pub name: String,
    /// Unit address, e.g. `10000000` for `serial@10000000`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_address: Option<String>,
    /// DTS label used as phandle target, e.g. `uart0`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// More labels for the same node (`l2: l2_cache: cache { };`).
    /// References always use `label`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra_labels: Vec<String>,
    /// `/omit-if-no-ref/`: dtc drops the node unless something references it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub omit_if_no_ref: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub compatible: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    #[serde(default)]
    pub position: Position,
}

impl Node {
    /// Full node name as it appears in DTS (`name@unit-address`).
    pub fn full_name(&self) -> String {
        match &self.unit_address {
            Some(addr) => format!("{}@{}", self.name, addr),
            None => self.name.clone(),
        }
    }

    pub fn is_root(&self) -> bool {
        self.name == "/"
    }

    /// `label` followed by `extra_labels`.
    pub fn labels(&self) -> impl Iterator<Item = &String> {
        self.label.iter().chain(&self.extra_labels)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum EdgeKind {
    /// `to` is a child of `from` in the devicetree hierarchy.
    Child,
    /// `from` references `to` through a phandle property, optionally
    /// followed by specifier cells (`clocks = <&osc 1>;`). Several edges
    /// with the same property form one phandle list, in edge order
    /// (`clocks = <&osc 1>, <&pll 0>;`).
    Reference {
        property: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        args: Vec<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub from: NodeId,
    pub to: NodeId,
    #[serde(flatten)]
    pub kind: EdgeKind,
}

/// Visual grouping of nodes (like a Simulink subsystem). Does not affect output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub title: String,
    pub members: Vec<NodeId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subgroups: Vec<Group>,
    #[serde(default)]
    pub position: Position,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
}

/// A complete design, serialized as the project file.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub groups: Vec<Group>,
    /// `/memreserve/` entries: memory regions the OS must not use.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub memreserves: Vec<MemReserve>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemReserve {
    #[serde(with = "json_safe_u64")]
    pub address: u64,
    #[serde(with = "json_safe_u64")]
    pub size: u64,
}

impl Graph {
    pub fn node(&self, id: &NodeId) -> Option<&Node> {
        self.nodes.iter().find(|n| &n.id == id)
    }

    pub fn root(&self) -> Option<&Node> {
        self.nodes.iter().find(|n| n.is_root())
    }

    pub fn children<'a>(&'a self, id: &'a NodeId) -> impl Iterator<Item = &'a Node> + 'a {
        self.edges
            .iter()
            .filter(move |e| &e.from == id && e.kind == EdgeKind::Child)
            .filter_map(|e| self.node(&e.to))
    }

    pub fn references<'a>(&'a self, id: &'a NodeId) -> impl Iterator<Item = &'a Edge> + 'a {
        self.edges
            .iter()
            .filter(move |e| &e.from == id && matches!(e.kind, EdgeKind::Reference { .. }))
    }
}
