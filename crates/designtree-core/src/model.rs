use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Stable identifier of a node inside a [`Graph`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(transparent)]
pub struct NodeId(pub String);

impl From<&str> for NodeId {
    fn from(s: &str) -> Self {
        NodeId(s.to_owned())
    }
}

/// Position of an element on the editor canvas. Ignored by DTS generation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct Position {
    pub x: f32,
    pub y: f32,
}

/// The value of a devicetree property.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(untagged)]
pub enum Cell {
    /// A JSON number up to 2^53 - 1, a hex string (`"0x..."`) above that,
    /// so that JavaScript reads every value exactly.
    Number(
        #[serde(with = "json_safe_u64")]
        #[ts(type = "number | string")]
        u64,
    ),
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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
pub struct Size {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Property {
    pub name: String,
    pub value: PropertyValue,
}

/// A devicetree node placed on the canvas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
    /// Set when the node comes from an included file (an SoC `.dtsi`).
    /// Export then writes only what differs from that definition, as an
    /// override (`&label { ... };`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherited: Option<Inherited>,
    #[serde(default)]
    pub position: Position,
}

/// The definition of a node in the included files, before the board file
/// changed it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct Inherited {
    /// File that first defines the node, as written in the import.
    pub file: String,
    /// Labels the included files give the node.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
    /// Properties as the included files define them, `compatible` and
    /// phandle lists included (as [`PropertyValue::Mixed`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    /// The included files mark the node `/omit-if-no-ref/`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub omit_if_no_ref: bool,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct Edge {
    pub from: NodeId,
    pub to: NodeId,
    #[serde(flatten)]
    pub kind: EdgeKind,
}

/// Visual grouping of nodes (like a Simulink subsystem). Does not affect output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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
    /// Shown as one block whose ports are the edges that cross its border.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub collapsed: bool,
}

/// A complete design, serialized as the project file.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
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
    /// Include directives of the board file, in order (`#include
    /// "imx8mp.dtsi"`), with its `#define`s and `#undef`s. Export writes
    /// them, then only the board's own content; nodes from the included
    /// files are marked [`Node::inherited`].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub includes: Vec<String>,
    /// Directives like [`Graph::includes`] that come after the board's
    /// first node, written at the end (an included PMIC `.dtsi` that fills
    /// in a node the board declares).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trailing_includes: Vec<String>,
    /// Inherited nodes the board deletes, as reference targets (a label,
    /// or a path starting with `/`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_nodes: Vec<String>,
    /// Set when the design is an overlay (`.dtso`) for another design: its
    /// nodes are then marked [`Node::inherited`] and export writes only
    /// what the overlay adds or changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub overlay: Option<Overlay>,
    /// Version of the kernel whose binding schemas the design was edited
    /// against (`7.3`); the editor warns when it opens the design with
    /// another one. Not part of the exported devicetree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kernel: Option<String>,
}

/// What an overlay design applies to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Overlay {
    /// The base design or board file, as it was opened.
    pub base: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct MemReserve {
    #[serde(with = "json_safe_u64")]
    #[ts(type = "number | string")]
    pub address: u64,
    #[serde(with = "json_safe_u64")]
    #[ts(type = "number | string")]
    pub size: u64,
    /// Comes from an included file.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inherited: bool,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_group_is_expanded_unless_the_file_says_otherwise() {
        let group = |extra: &str| -> Group {
            serde_json::from_str(&format!(
                r#"{{"id":"g","title":"SoC","members":[],"position":{{"x":0,"y":0}}{extra}}}"#
            ))
            .unwrap()
        };
        assert!(!group("").collapsed);
        assert!(group(r#","collapsed":true"#).collapsed);

        // Expanded groups do not write the field, so older files stay as they were.
        let text = serde_json::to_string(&group("")).unwrap();
        assert!(!text.contains("collapsed"));
        let text = serde_json::to_string(&group(r#","collapsed":true"#)).unwrap();
        assert!(text.contains(r#""collapsed":true"#));
    }
}
