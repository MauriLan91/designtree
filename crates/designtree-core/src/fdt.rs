//! Writes a design as a flattened devicetree blob (`.dtb`) without `dtc`,
//! for checks that work on compiled trees, such as schema validation.
//!
//! The blob holds what `dtc` would produce from [`crate::to_dts_flat`]:
//! the same nodes and properties in the same order, phandles assigned to
//! referenced nodes in the order `dtc` assigns them (a `phandle` property
//! appended to the node), path references expanded to full paths, and
//! `/omit-if-no-ref/` nodes dropped when nothing refers to them.

use std::collections::{HashMap, HashSet};

use crate::model::{Cell, EdgeKind, Graph, Node, NodeId, PropertyValue, ValueChunk};
use crate::validate::{validate, ValidationError};

/// A compiled design.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dtb {
    pub blob: Vec<u8>,
    /// Full path of every node in the blob, with its design node.
    pub nodes: Vec<(String, NodeId)>,
}

impl Dtb {
    /// The design node at a full path (`/soc/serial@1000`).
    pub fn node_at(&self, path: &str) -> Option<&NodeId> {
        self.nodes.iter().find(|(p, _)| p == path).map(|(_, id)| id)
    }
}

/// A property value with the places that need a phandle.
struct Value {
    data: Vec<u8>,
    /// Byte offsets of phandle cells, with the node they point at.
    phandles: Vec<(usize, NodeId)>,
}

struct Writer<'a> {
    graph: &'a Graph,
    /// Node for each label and full path.
    targets: HashMap<String, &'a NodeId>,
    paths: HashMap<&'a NodeId, String>,
}

impl<'a> Writer<'a> {
    fn target(&self, name: &str) -> Option<&'a NodeId> {
        self.targets.get(name).copied()
    }

    fn cells(&self, bits: u8, cells: &[Cell], value: &mut Value) {
        for cell in cells {
            match cell {
                Cell::Number(n) => {
                    let bytes = n.to_be_bytes();
                    value
                        .data
                        .extend_from_slice(&bytes[8 - usize::from(bits / 8)..]);
                }
                Cell::Phandle { phandle } => {
                    if let Some(id) = self.target(phandle) {
                        value.phandles.push((value.data.len(), id.clone()));
                    }
                    // Unresolved references are reported by `validate`;
                    // dtc writes 0xffffffff for them.
                    value.data.extend_from_slice(&u32::MAX.to_be_bytes());
                }
            }
        }
    }

    fn encode(&self, property: &PropertyValue) -> Value {
        let mut value = Value {
            data: Vec::new(),
            phandles: Vec::new(),
        };
        match property {
            PropertyValue::Empty => {}
            PropertyValue::Cells(cells) => {
                for cell in cells {
                    value.data.extend_from_slice(&cell.to_be_bytes());
                }
            }
            PropertyValue::Strings(strings) => {
                for s in strings {
                    value.data.extend_from_slice(s.as_bytes());
                    value.data.push(0);
                }
            }
            PropertyValue::Bytes(bytes) => value.data.extend_from_slice(bytes),
            PropertyValue::Mixed(chunks) => {
                for chunk in chunks {
                    match chunk {
                        ValueChunk::Cells { bits, cells } => self.cells(*bits, cells, &mut value),
                        ValueChunk::String { value: s } => {
                            value.data.extend_from_slice(s.as_bytes());
                            value.data.push(0);
                        }
                        ValueChunk::Bytes { value: bytes } => value.data.extend_from_slice(bytes),
                        ValueChunk::Path { target } => {
                            let path = self
                                .target(target)
                                .and_then(|id| self.paths.get(id))
                                .map_or(target.as_str(), String::as_str);
                            value.data.extend_from_slice(path.as_bytes());
                            value.data.push(0);
                        }
                    }
                }
            }
        }
        value
    }

    /// The properties of a node in output order (see `dts::node_properties`).
    fn properties(&self, node: &Node) -> Vec<(String, Value)> {
        let mut props = Vec::new();
        if !node.compatible.is_empty() {
            props.push((
                "compatible".to_owned(),
                self.encode(&PropertyValue::Strings(node.compatible.clone())),
            ));
        }
        for prop in &node.properties {
            props.push((prop.name.clone(), self.encode(&prop.value)));
        }
        let mut lists: Vec<(String, Value)> = Vec::new();
        for edge in self.graph.references(&node.id) {
            let EdgeKind::Reference { property, args } = &edge.kind else {
                continue;
            };
            let index = match lists.iter().position(|(p, _)| p == property) {
                Some(i) => i,
                None => {
                    let empty = Value {
                        data: Vec::new(),
                        phandles: Vec::new(),
                    };
                    lists.push((property.clone(), empty));
                    lists.len() - 1
                }
            };
            let value = &mut lists[index].1;
            value.phandles.push((value.data.len(), edge.to.clone()));
            value.data.extend_from_slice(&u32::MAX.to_be_bytes());
            for arg in args {
                value.data.extend_from_slice(&arg.to_be_bytes());
            }
        }
        props.extend(lists);
        props
    }
}

/// Nodes some property or edge refers to, by phandle or by path.
fn referenced(graph: &Graph, targets: &HashMap<String, &NodeId>) -> HashSet<NodeId> {
    let mut out: HashSet<NodeId> = graph
        .edges
        .iter()
        .filter(|e| matches!(e.kind, EdgeKind::Reference { .. }))
        .map(|e| e.to.clone())
        .collect();
    for node in &graph.nodes {
        for property in &node.properties {
            let PropertyValue::Mixed(chunks) = &property.value else {
                continue;
            };
            for chunk in chunks {
                let names: Vec<&String> = match chunk {
                    ValueChunk::Path { target } => vec![target],
                    ValueChunk::Cells { cells, .. } => cells
                        .iter()
                        .filter_map(|c| match c {
                            Cell::Phandle { phandle } => Some(phandle),
                            Cell::Number(_) => None,
                        })
                        .collect(),
                    _ => vec![],
                };
                out.extend(
                    names
                        .into_iter()
                        .filter_map(|n| targets.get(n))
                        .map(|id| (*id).clone()),
                );
            }
        }
    }
    out
}

/// One node of the tree being written.
struct Flat {
    id: NodeId,
    name: String,
    props: Vec<(String, Value)>,
    children: Vec<Flat>,
    /// An `/omit-if-no-ref/` node nothing refers to.
    omitted: bool,
}

/// Compiles a design to a devicetree blob. Fails if the graph does not
/// pass [`validate`].
pub fn to_dtb(graph: &Graph) -> Result<Dtb, Vec<ValidationError>> {
    let errors = validate(graph);
    if !errors.is_empty() {
        return Err(errors);
    }
    let root = graph.root().expect("validated graph has a root");

    let mut paths = HashMap::new();
    let mut stack = vec![(root, "/".to_owned())];
    while let Some((node, path)) = stack.pop() {
        for child in graph.children(&node.id) {
            let child_path = if path == "/" {
                format!("/{}", child.full_name())
            } else {
                format!("{path}/{}", child.full_name())
            };
            stack.push((child, child_path));
        }
        paths.insert(&node.id, path);
    }
    let mut targets: HashMap<String, &NodeId> = HashMap::new();
    for node in &graph.nodes {
        for label in node.labels() {
            targets.insert(label.clone(), &node.id);
        }
    }
    for (id, path) in &paths {
        targets.insert(path.clone(), id);
    }
    let used = referenced(graph, &targets);
    let writer = Writer {
        graph,
        targets,
        paths,
    };

    fn build(writer: &Writer, node: &Node, used: &HashSet<NodeId>) -> Flat {
        Flat {
            id: node.id.clone(),
            name: if node.is_root() {
                String::new()
            } else {
                node.full_name()
            },
            props: writer.properties(node),
            children: writer
                .graph
                .children(&node.id)
                .map(|c| build(writer, c, used))
                .collect(),
            omitted: node.omit_if_no_ref && !used.contains(&node.id),
        }
    }
    let mut tree = build(&writer, root, &used);

    // Phandles, in dtc's order: nodes in tree order, then properties and
    // references in order. Explicit `phandle` properties keep their value.
    // dtc assigns them before dropping unreferenced `/omit-if-no-ref/`
    // nodes, so references from those still take a number.
    let mut taken: HashSet<u32> = HashSet::new();
    let mut assigned: HashMap<NodeId, u32> = HashMap::new();
    fn explicit(flat: &Flat, taken: &mut HashSet<u32>, assigned: &mut HashMap<NodeId, u32>) {
        for (name, value) in &flat.props {
            if (name == "phandle" || name == "linux,phandle") && value.data.len() == 4 {
                let phandle = u32::from_be_bytes(value.data[..4].try_into().unwrap());
                taken.insert(phandle);
                assigned.insert(flat.id.clone(), phandle);
            }
        }
        flat.children
            .iter()
            .for_each(|c| explicit(c, taken, assigned));
    }
    explicit(&tree, &mut taken, &mut assigned);
    let mut order = Vec::new();
    fn wanted(flat: &Flat, order: &mut Vec<NodeId>) {
        for (_, value) in &flat.props {
            order.extend(value.phandles.iter().map(|(_, id)| id.clone()));
        }
        flat.children.iter().for_each(|c| wanted(c, order));
    }
    wanted(&tree, &mut order);
    let mut next = 1u32;
    let mut fresh = Vec::new();
    for id in order {
        if assigned.contains_key(&id) {
            continue;
        }
        while taken.contains(&next) {
            next += 1;
        }
        taken.insert(next);
        assigned.insert(id.clone(), next);
        fresh.push(id);
    }
    fn patch(flat: &mut Flat, assigned: &HashMap<NodeId, u32>, fresh: &HashSet<NodeId>) {
        for (_, value) in flat.props.iter_mut() {
            for (offset, id) in &value.phandles {
                if let Some(phandle) = assigned.get(id) {
                    value.data[*offset..*offset + 4].copy_from_slice(&phandle.to_be_bytes());
                }
            }
        }
        if fresh.contains(&flat.id) {
            let data = assigned[&flat.id].to_be_bytes().to_vec();
            flat.props.push((
                "phandle".to_owned(),
                Value {
                    data,
                    phandles: Vec::new(),
                },
            ));
        }
        flat.children
            .iter_mut()
            .for_each(|c| patch(c, assigned, fresh));
    }
    patch(&mut tree, &assigned, &fresh.into_iter().collect());
    fn prune(flat: &mut Flat) {
        flat.children.retain(|c| !c.omitted);
        flat.children.iter_mut().for_each(prune);
    }
    prune(&mut tree);

    let mut nodes = Vec::new();
    fn list(flat: &Flat, path: &str, nodes: &mut Vec<(String, NodeId)>) {
        nodes.push((path.to_owned(), flat.id.clone()));
        for child in &flat.children {
            let child_path = if path == "/" {
                format!("/{}", child.name)
            } else {
                format!("{path}/{}", child.name)
            };
            list(child, &child_path, nodes);
        }
    }
    list(&tree, "/", &mut nodes);

    let reserves: Vec<(u64, u64)> = graph
        .memreserves
        .iter()
        .map(|r| (r.address, r.size))
        .collect();
    Ok(Dtb {
        blob: serialize(&tree, &reserves),
        nodes,
    })
}

const BEGIN_NODE: u32 = 1;
const END_NODE: u32 = 2;
const PROP: u32 = 3;
const END: u32 = 9;

fn pad(out: &mut Vec<u8>) {
    while out.len() % 4 != 0 {
        out.push(0);
    }
}

fn serialize(tree: &Flat, reserves: &[(u64, u64)]) -> Vec<u8> {
    let mut structs = Vec::new();
    let mut strings: Vec<u8> = Vec::new();
    let mut offsets: HashMap<String, u32> = HashMap::new();

    fn node(
        flat: &Flat,
        structs: &mut Vec<u8>,
        strings: &mut Vec<u8>,
        offsets: &mut HashMap<String, u32>,
    ) {
        structs.extend_from_slice(&BEGIN_NODE.to_be_bytes());
        structs.extend_from_slice(flat.name.as_bytes());
        structs.push(0);
        pad(structs);
        for (name, value) in &flat.props {
            let offset = *offsets.entry(name.clone()).or_insert_with(|| {
                let offset = strings.len() as u32;
                strings.extend_from_slice(name.as_bytes());
                strings.push(0);
                offset
            });
            structs.extend_from_slice(&PROP.to_be_bytes());
            structs.extend_from_slice(&(value.data.len() as u32).to_be_bytes());
            structs.extend_from_slice(&offset.to_be_bytes());
            structs.extend_from_slice(&value.data);
            pad(structs);
        }
        for child in &flat.children {
            node(child, structs, strings, offsets);
        }
        structs.extend_from_slice(&END_NODE.to_be_bytes());
    }
    node(tree, &mut structs, &mut strings, &mut offsets);
    structs.extend_from_slice(&END.to_be_bytes());

    const HEADER: usize = 40;
    let rsvmap_offset = HEADER;
    let rsvmap_size = (reserves.len() + 1) * 16;
    let struct_offset = rsvmap_offset + rsvmap_size;
    let strings_offset = struct_offset + structs.len();
    let total = strings_offset + strings.len();

    let mut out = Vec::with_capacity(total);
    for word in [
        0xd00d_feed,
        total as u32,
        struct_offset as u32,
        strings_offset as u32,
        rsvmap_offset as u32,
        17,
        16,
        0,
        strings.len() as u32,
        structs.len() as u32,
    ] {
        out.extend_from_slice(&u32::to_be_bytes(word));
    }
    for (address, size) in reserves.iter().chain(&[(0, 0)]) {
        out.extend_from_slice(&address.to_be_bytes());
        out.extend_from_slice(&size.to_be_bytes());
    }
    out.extend_from_slice(&structs);
    out.extend_from_slice(&strings);
    out
}
