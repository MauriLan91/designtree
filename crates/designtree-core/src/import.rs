//! Import of devicetree source into a design [`Graph`].
//!
//! The parsed document is merged into a single tree with dtc semantics:
//! repeated root blocks and `&label { }` overrides merge into the nodes they
//! name, later property definitions replace earlier ones, and
//! `/delete-node/` / `/delete-property/` remove what was defined before them.
//! Phandle lists (`clocks = <&osc 0>, <&pll 1>;`) become reference edges;
//! any other value that contains references is kept as a
//! [`PropertyValue::Mixed`] value.

use std::collections::HashMap;
use std::path::Path;

use crate::model::{
    Cell, Edge, EdgeKind, Graph, MemReserve, Node, NodeId, Position, Property, PropertyValue,
    ValueChunk,
};
pub use crate::parse::ImportError;
use crate::parse::{parse, BodyItem, NodeBody, ParseError, Pos, PropertyDef, Reference, TopItem};
use crate::preprocess::{confined_reader, preprocess, ImportOptions};

/// Horizontal and vertical spacing of the initial layout of imported nodes.
const LAYOUT_STEP: Position = Position { x: 280.0, y: 110.0 };

/// Imports a devicetree source file, resolving `#include` and macros.
pub fn import_dts_file(path: &Path, options: &ImportOptions) -> Result<Graph, ImportError> {
    let source = std::fs::read_to_string(path)
        .map_err(|e| ImportError::new(path.display().to_string(), 1, e.to_string()))?;
    import_dts(&source, path, options)
}

/// Imports devicetree source text read from `file`. Includes are looked up
/// next to `file`, then in the include directories of `options`.
///
/// Node ids are the node paths (`/`, `/soc/serial@10000000`). Nodes get a
/// simple indented layout: one row per node, one column per depth.
pub fn import_dts(
    source: &str,
    file: &Path,
    options: &ImportOptions,
) -> Result<Graph, ImportError> {
    let text = preprocess(source, file, options, &confined_reader(file, options))?;
    import_preprocessed(&text, &file.display().to_string())
}

/// Imports source that has already been preprocessed.
fn import_preprocessed(text: &str, file: &str) -> Result<Graph, ImportError> {
    let document = parse(text, file)?;
    let files = document.files;
    let located = |e: ParseError| e.located(&files);
    let mut tree = Tree::new();
    for item in document.items {
        match item {
            TopItem::Root(body) => tree.merge(ROOT, body),
            TopItem::Override {
                labels,
                target,
                body,
            } => tree.resolve(&target).and_then(|node| {
                for label in &labels {
                    tree.add_label(node, label, target.pos);
                }
                tree.merge(node, body)
            }),
            TopItem::DeleteNode(target) => tree.resolve(&target).and_then(|node| {
                if node == ROOT {
                    return Err(ParseError {
                        pos: target.pos,
                        message: "cannot delete the root node".into(),
                    });
                }
                tree.delete(node);
                Ok(())
            }),
            TopItem::OmitIfNoRef(target) => tree.resolve(&target).and_then(|node| {
                if node == ROOT {
                    return Err(ParseError {
                        pos: target.pos,
                        message: "the root node cannot be `/omit-if-no-ref/`".into(),
                    });
                }
                tree.nodes[node].omit_if_no_ref = true;
                Ok(())
            }),
            TopItem::MemReserve { address, size } => {
                tree.memreserves.push(MemReserve { address, size });
                Ok(())
            }
        }
        .map_err(located)?;
    }
    tree.into_graph().map_err(located)
}

const ROOT: usize = 0;

struct TreeNode {
    /// Full name with unit address; `/` for the root.
    name: String,
    labels: Vec<String>,
    omit_if_no_ref: bool,
    properties: Vec<PropertyDef>,
    children: Vec<usize>,
    deleted: bool,
}

impl TreeNode {
    fn new(name: &str) -> Self {
        TreeNode {
            name: name.to_owned(),
            labels: Vec::new(),
            omit_if_no_ref: false,
            properties: Vec::new(),
            children: Vec::new(),
            deleted: false,
        }
    }
}

/// Arena of nodes; deleted nodes stay in place, marked, so indices are stable.
struct Tree {
    nodes: Vec<TreeNode>,
    /// Nodes that define each label, in definition order. dtc lets a label
    /// appear twice as long as one of the two nodes is deleted.
    labels: HashMap<String, Vec<(usize, Pos)>>,
    memreserves: Vec<MemReserve>,
}

impl Tree {
    fn new() -> Self {
        Tree {
            nodes: vec![TreeNode::new("/")],
            labels: HashMap::new(),
            memreserves: Vec::new(),
        }
    }

    fn live_children(&self, node: usize) -> impl Iterator<Item = usize> + '_ {
        self.nodes[node]
            .children
            .iter()
            .copied()
            .filter(|&c| !self.nodes[c].deleted)
    }

    fn child(&self, node: usize, name: &str) -> Option<usize> {
        self.live_children(node)
            .find(|&c| self.nodes[c].name == name)
    }

    fn merge(&mut self, node: usize, body: NodeBody) -> Result<(), ParseError> {
        for item in body.items {
            match item {
                BodyItem::Property(def) => {
                    let properties = &mut self.nodes[node].properties;
                    match properties.iter_mut().find(|p| p.name == def.name) {
                        Some(existing) => *existing = def,
                        None => properties.push(def),
                    }
                }
                BodyItem::DeleteProperty { name, .. } => {
                    self.nodes[node].properties.retain(|p| p.name != name);
                }
                BodyItem::Node(def) => {
                    let child = match self.child(node, &def.name) {
                        Some(child) => child,
                        None => {
                            self.nodes.push(TreeNode::new(&def.name));
                            let child = self.nodes.len() - 1;
                            self.nodes[node].children.push(child);
                            child
                        }
                    };
                    for label in &def.labels {
                        self.add_label(child, label, def.pos);
                    }
                    self.nodes[child].omit_if_no_ref |= def.omit_if_no_ref;
                    self.merge(child, def.body)?;
                }
                BodyItem::DeleteNode { name, .. } => {
                    if let Some(child) = self.child(node, &name) {
                        self.delete(child);
                    }
                }
            }
        }
        Ok(())
    }

    /// Labels may repeat until the end, see [`Tree::check_labels`].
    fn add_label(&mut self, node: usize, label: &str, pos: Pos) {
        if !self.nodes[node].labels.iter().any(|l| l == label) {
            self.nodes[node].labels.push(label.to_owned());
            self.labels
                .entry(label.to_owned())
                .or_default()
                .push((node, pos));
        }
    }

    fn delete(&mut self, node: usize) {
        self.nodes[node].deleted = true;
        for child in self.nodes[node].children.clone() {
            self.delete(child);
        }
    }

    /// The live node that defines `label`.
    fn labeled(&self, label: &str) -> Option<usize> {
        self.labels
            .get(label)?
            .iter()
            .map(|&(node, _)| node)
            .find(|&node| !self.nodes[node].deleted)
    }

    /// The live node a reference points to: a label, a path (`/soc/uart`)
    /// or a path below a label (`soc/uart`, from `&{soc/uart}`).
    fn resolve(&self, reference: &Reference) -> Result<usize, ParseError> {
        self.find(&reference.target).ok_or_else(|| ParseError {
            pos: reference.pos,
            message: format!("reference to unknown node `{}`", reference.target),
        })
    }

    fn find(&self, target: &str) -> Option<usize> {
        match target.split_once('/') {
            Some(("", path)) => self.find_path(ROOT, path),
            Some((label, path)) => self
                .labeled(label)
                .and_then(|node| self.find_path(node, path)),
            None => self.labeled(target),
        }
    }

    /// Fails on a label defined by two live nodes.
    fn check_labels(&self) -> Result<(), ParseError> {
        for (label, owners) in &self.labels {
            let mut live = owners.iter().filter(|(node, _)| !self.nodes[*node].deleted);
            if let (Some(_), Some(&(_, pos))) = (live.next(), live.next()) {
                return Err(ParseError {
                    pos,
                    message: format!("duplicate label `{label}`"),
                });
            }
        }
        Ok(())
    }

    /// Like dtc, a path component without unit address also matches a node
    /// that has one (`/soc/serial` finds `/soc/serial@1000`).
    fn find_path(&self, from: usize, path: &str) -> Option<usize> {
        path.split('/')
            .filter(|c| !c.is_empty())
            .try_fold(from, |node, component| {
                self.child(node, component).or_else(|| {
                    self.live_children(node).find(|&c| {
                        self.nodes[c]
                            .name
                            .split_once('@')
                            .is_some_and(|(base, _)| base == component)
                    })
                })
            })
    }

    fn into_graph(mut self) -> Result<Graph, ParseError> {
        self.check_labels()?;
        let mut graph = Graph {
            memreserves: std::mem::take(&mut self.memreserves),
            ..Graph::default()
        };
        let mut index = vec![None; self.nodes.len()];
        self.visit(ROOT, "/".into(), 0, &mut graph, &mut index);

        for (node, graph_index) in index.iter().enumerate() {
            let Some(graph_index) = *graph_index else {
                continue;
            };
            for def in &self.nodes[node].properties {
                // Resolve every reference up front to report unknown ones
                // at their position.
                for reference in &def.references {
                    self.resolve(reference)?;
                }
                match classify(def) {
                    Classified::Value(PropertyValue::Strings(strings))
                        if def.name == "compatible" =>
                    {
                        graph.nodes[graph_index].compatible = strings
                    }
                    Classified::Value(mut value) => {
                        // Path references are looked up like dtc does
                        // (`/soc/serial` finds `serial@1000`); store the
                        // full path, which is the target's node id.
                        if let PropertyValue::Mixed(chunks) = &mut value {
                            for target in chunk_targets(chunks) {
                                if let Some(node) = target
                                    .contains('/')
                                    .then(|| self.find(target))
                                    .flatten()
                                    .and_then(|node| index[node])
                                {
                                    target.clone_from(&graph.nodes[node].id.0);
                                }
                            }
                        }
                        graph.nodes[graph_index].properties.push(Property {
                            name: def.name.clone(),
                            value,
                        })
                    }
                    Classified::Phandles(entries) => {
                        for (label, args) in entries {
                            let target = index
                                [self.labeled(label).expect("references are resolved")]
                            .expect("live nodes are in the graph");
                            graph.edges.push(Edge {
                                from: graph.nodes[graph_index].id.clone(),
                                to: graph.nodes[target].id.clone(),
                                kind: EdgeKind::Reference {
                                    property: def.name.clone(),
                                    args,
                                },
                            });
                        }
                    }
                }
            }
        }
        Ok(graph)
    }

    /// Adds `node` and its subtree to the graph in source order, with child
    /// edges, and records the graph index of each visited tree node.
    fn visit(
        &self,
        node: usize,
        path: String,
        depth: usize,
        graph: &mut Graph,
        index: &mut [Option<usize>],
    ) {
        let tree_node = &self.nodes[node];
        let (name, unit_address) = match tree_node.name.split_once('@') {
            Some((name, address)) => (name.to_owned(), Some(address.to_owned())),
            None => (tree_node.name.clone(), None),
        };
        let row = graph.nodes.len();
        index[node] = Some(row);
        graph.nodes.push(Node {
            id: NodeId(path.clone()),
            name,
            unit_address,
            label: tree_node.labels.first().cloned(),
            extra_labels: tree_node.labels.iter().skip(1).cloned().collect(),
            omit_if_no_ref: tree_node.omit_if_no_ref,
            compatible: Vec::new(),
            properties: Vec::new(),
            position: Position {
                x: depth as f32 * LAYOUT_STEP.x,
                y: row as f32 * LAYOUT_STEP.y,
            },
        });

        for child in self.live_children(node) {
            let child_path = match path.as_str() {
                "/" => format!("/{}", self.nodes[child].name),
                _ => format!("{path}/{}", self.nodes[child].name),
            };
            graph.edges.push(Edge {
                from: NodeId(path.clone()),
                to: NodeId(child_path.clone()),
                kind: EdgeKind::Child,
            });
            self.visit(child, child_path, depth + 1, graph, index);
        }
    }
}

/// The reference targets in a mixed value, in order.
fn chunk_targets(chunks: &mut [ValueChunk]) -> impl Iterator<Item = &mut String> {
    chunks.iter_mut().flat_map(|chunk| -> Vec<&mut String> {
        match chunk {
            ValueChunk::Path { target } => vec![target],
            ValueChunk::Cells { cells, .. } => cells
                .iter_mut()
                .filter_map(|cell| match cell {
                    Cell::Phandle { phandle } => Some(phandle),
                    Cell::Number(_) => None,
                })
                .collect(),
            ValueChunk::String { .. } | ValueChunk::Bytes { .. } => Vec::new(),
        }
    })
}

enum Classified<'a> {
    Value(PropertyValue),
    /// Phandle list: one entry per `&label` with the cells that follow it.
    Phandles(Vec<(&'a str, Vec<u32>)>),
}

/// Picks the simplest model representation that keeps the value exact.
fn classify(def: &PropertyDef) -> Classified<'_> {
    let chunks = &def.value;
    if chunks.is_empty() {
        return Classified::Value(PropertyValue::Empty);
    }

    let strings: Option<Vec<String>> = chunks
        .iter()
        .map(|c| match c {
            ValueChunk::String { value } => Some(value.clone()),
            _ => None,
        })
        .collect();
    if let Some(strings) = strings {
        return Classified::Value(PropertyValue::Strings(strings));
    }

    if let [ValueChunk::Bytes { value }] = chunks.as_slice() {
        return Classified::Value(PropertyValue::Bytes(value.clone()));
    }

    // Only 32-bit cell lists are left to simplify; the grouping into `<...>`
    // does not change the compiled value.
    let cells: Option<Vec<&Cell>> = chunks
        .iter()
        .map(|c| match c {
            ValueChunk::Cells { bits: 32, cells } => Some(cells),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()
        .map(|lists| lists.into_iter().flatten().collect());
    let mixed = || Classified::Value(PropertyValue::Mixed(chunks.clone()));
    let Some(cells) = cells else {
        return mixed();
    };

    let numbers: Option<Vec<u32>> = cells
        .iter()
        .map(|c| match c {
            Cell::Number(n) => Some(u32::try_from(*n).expect("32-bit cells are range checked")),
            Cell::Phandle { .. } => None,
        })
        .collect();
    if let Some(numbers) = numbers {
        return Classified::Value(PropertyValue::Cells(numbers));
    }

    // A phandle list starts with a label reference; each reference opens a
    // new entry. Path references stay mixed since edges target labels.
    let mut entries: Vec<(&str, Vec<u32>)> = Vec::new();
    for cell in cells {
        match cell {
            Cell::Phandle { phandle } if !phandle.contains('/') => {
                entries.push((phandle, Vec::new()));
            }
            Cell::Number(n) => match entries.last_mut() {
                Some((_, args)) => args.push(*n as u32),
                None => return mixed(),
            },
            Cell::Phandle { .. } => return mixed(),
        }
    }
    Classified::Phandles(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import(source: &str) -> Graph {
        import_dts(source, Path::new("test.dts"), &ImportOptions::default())
            .unwrap_or_else(|e| panic!("{e}"))
    }

    fn error(source: &str) -> String {
        import_dts(source, Path::new("test.dts"), &ImportOptions::default())
            .unwrap_err()
            .to_string()
    }

    fn node<'a>(graph: &'a Graph, id: &str) -> &'a Node {
        graph
            .node(&id.into())
            .unwrap_or_else(|| panic!("no node {id}"))
    }

    fn prop<'a>(graph: &'a Graph, id: &str, name: &str) -> &'a PropertyValue {
        &node(graph, id)
            .properties
            .iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("no property {name} in {id}"))
            .value
    }

    fn references(graph: &Graph, id: &str) -> Vec<(String, String, Vec<u32>)> {
        graph
            .references(&id.into())
            .map(|e| match &e.kind {
                EdgeKind::Reference { property, args } => {
                    (property.clone(), e.to.0.clone(), args.clone())
                }
                EdgeKind::Child => unreachable!(),
            })
            .collect()
    }

    fn child_names(graph: &Graph, id: &str) -> Vec<String> {
        let id = NodeId::from(id);
        graph.children(&id).map(Node::full_name).collect()
    }

    #[test]
    fn imports_nodes_labels_and_every_value_type() {
        let graph = import(
            r#"
            /dts-v1/;
            /memreserve/ 0x80000000 (64 << 20);
            // board
            / {
                #address-cells = <1>;
                model = "Test \"board\"\n";
                compatible = "acme,board", "acme,soc";
                /* a block
                   comment */
                uart0: serial@10000000 {
                    compatible = "ns16550a";
                    reg = <0x10000000 0x100>, <0x20000000 0x10>;
                    local-mac-address = [00 11 2233 44 55];
                    big = /bits/ 64 <0x100000000>;
                    small = /bits/ 8 <0xff (-1)>;
                    expr = <(1 << 4 | 2) ((3 + 4) * 2) 'A' 017 10U (5 > 3 ? 7 : 9)>;
                    mixed = "a", <1>;
                    dma-coherent;
                };
            };
            "#,
        );
        assert_eq!(child_names(&graph, "/"), ["serial@10000000"]);
        assert_eq!(
            graph.memreserves,
            [MemReserve {
                address: 0x8000_0000,
                size: 64 << 20
            }]
        );
        let root = node(&graph, "/");
        assert_eq!(root.compatible, ["acme,board", "acme,soc"]);
        assert_eq!(
            prop(&graph, "/", "model"),
            &PropertyValue::Strings(vec!["Test \"board\"\n".into()])
        );

        let uart = node(&graph, "/serial@10000000");
        assert_eq!(uart.name, "serial");
        assert_eq!(uart.unit_address.as_deref(), Some("10000000"));
        assert_eq!(uart.label.as_deref(), Some("uart0"));
        assert_eq!(uart.compatible, ["ns16550a"]);
        let id = "/serial@10000000";
        assert_eq!(
            prop(&graph, id, "reg"),
            &PropertyValue::Cells(vec![0x1000_0000, 0x100, 0x2000_0000, 0x10])
        );
        assert_eq!(
            prop(&graph, id, "local-mac-address"),
            &PropertyValue::Bytes(vec![0, 0x11, 0x22, 0x33, 0x44, 0x55])
        );
        assert_eq!(
            prop(&graph, id, "big"),
            &PropertyValue::Mixed(vec![ValueChunk::Cells {
                bits: 64,
                cells: vec![Cell::Number(0x1_0000_0000)],
            }])
        );
        assert_eq!(
            prop(&graph, id, "small"),
            &PropertyValue::Mixed(vec![ValueChunk::Cells {
                bits: 8,
                cells: vec![Cell::Number(0xff), Cell::Number(0xff)],
            }])
        );
        assert_eq!(
            prop(&graph, id, "expr"),
            &PropertyValue::Cells(vec![18, 14, 65, 15, 10, 7])
        );
        assert_eq!(
            prop(&graph, id, "mixed"),
            &PropertyValue::Mixed(vec![
                ValueChunk::String { value: "a".into() },
                ValueChunk::Cells {
                    bits: 32,
                    cells: vec![Cell::Number(1)],
                },
            ])
        );
        assert_eq!(prop(&graph, id, "dma-coherent"), &PropertyValue::Empty);
    }

    #[test]
    fn phandle_lists_become_reference_edges() {
        let graph = import(
            r#"
            /dts-v1/;
            / {
                osc: oscillator { #clock-cells = <0>; };
                pll: pll { #clock-cells = <1>; clocks = <&osc>; };
                dev {
                    clocks = <&pll 1 &osc>, <&pll 2>;
                    stdout-path = &pll;
                    map = <0 &osc 1>;
                    by-path = <&{/pll} 3>;
                };
            };
            "#,
        );
        assert_eq!(
            references(&graph, "/dev"),
            [
                ("clocks".into(), "/pll".into(), vec![1]),
                ("clocks".into(), "/oscillator".into(), vec![]),
                ("clocks".into(), "/pll".into(), vec![2]),
            ]
        );
        assert_eq!(
            references(&graph, "/pll"),
            [("clocks".into(), "/oscillator".into(), vec![])]
        );
        assert_eq!(
            prop(&graph, "/dev", "stdout-path"),
            &PropertyValue::Mixed(vec![ValueChunk::Path {
                target: "pll".into()
            }])
        );
        assert_eq!(
            prop(&graph, "/dev", "map"),
            &PropertyValue::Mixed(vec![ValueChunk::Cells {
                bits: 32,
                cells: vec![
                    Cell::Number(0),
                    Cell::Phandle {
                        phandle: "osc".into()
                    },
                    Cell::Number(1),
                ],
            }])
        );
        assert_eq!(
            prop(&graph, "/dev", "by-path"),
            &PropertyValue::Mixed(vec![ValueChunk::Cells {
                bits: 32,
                cells: vec![
                    Cell::Phandle {
                        phandle: "/pll".into()
                    },
                    Cell::Number(3),
                ],
            }])
        );
    }

    #[test]
    fn merges_overrides_and_applies_deletions() {
        let graph = import(
            r#"
            /dts-v1/;
            / {
                soc {
                    uart0: serial@1000 { status = "disabled"; clock-frequency = <1>; };
                    serial@2000 { };
                    gone: serial@3000 { };
                };
            };
            / {
                soc { i2c@4000 { }; /delete-node/ serial@2000; };
            };
            &uart0 {
                status = "okay";
                /delete-property/ clock-frequency;
            };
            &{/soc/serial} { extra; };
            / { chosen { stdout-path = &{/soc/serial/}; }; };
            /delete-node/ &gone;
            "#,
        );
        assert_eq!(child_names(&graph, "/soc"), ["serial@1000", "i2c@4000"]);
        assert_eq!(
            prop(&graph, "/chosen", "stdout-path"),
            &PropertyValue::Mixed(vec![ValueChunk::Path {
                target: "/soc/serial@1000".into()
            }])
        );
        let uart = node(&graph, "/soc/serial@1000");
        assert_eq!(
            uart.properties,
            [
                Property {
                    name: "status".into(),
                    value: PropertyValue::Strings(vec!["okay".into()]),
                },
                Property {
                    name: "extra".into(),
                    value: PropertyValue::Empty,
                },
            ]
        );
        assert!(crate::validate(&graph).is_empty());
    }

    #[test]
    fn reports_errors_with_file_line_and_column() {
        assert_eq!(
            error("/dts-v1/;\n/ {\n\tfoo = <1 2;\n};\n"),
            "test.dts:3:12: expected a number, found `;`"
        );
        assert_eq!(
            error("/dts-v1/;\n/ {\n\tclocks = <&missing>;\n};\n"),
            "test.dts:3:12: reference to unknown node `missing`"
        );
        assert_eq!(
            error("/dts-v1/;\n&nope { };\n"),
            "test.dts:2:1: reference to unknown node `nope`"
        );
        assert_eq!(
            error("/dts-v1/;\n/ { a: x { }; a: y { }; };\n"),
            "test.dts:2:18: duplicate label `a`"
        );
        assert_eq!(
            error("/dts-v1/;\n/ { x = <0x100000000>; };"),
            "test.dts:2:10: value 0x100000000 does not fit in 32 bits"
        );
        assert_eq!(
            error("/ { };"),
            "test.dts:1:1: missing `/dts-v1/;` before the root node"
        );
        assert_eq!(
            error("/dts-v1/;\n#define F(a) <a>\n/ { a = F((1 +\n 2));\n b = ; };\n"),
            "test.dts:5:6: expected a value, found `;`"
        );
        assert_eq!(
            error("/dts-v1/;\n/ { };\n/omit-if-no-ref/ &{/};\n"),
            "test.dts:3:18: the root node cannot be `/omit-if-no-ref/`"
        );
        assert_eq!(
            error("/dts-v1/;\n#include \"no-such-file.dtsi\"\n"),
            "test.dts:2:1: cannot find include file `no-such-file.dtsi`"
        );
        assert_eq!(
            error("/dts-v1/;\n/ { s = \"abc; };"),
            "test.dts:2:9: unterminated string"
        );
        assert_eq!(
            error("/dts-v1/;\n/ {\n\tx { };\n"),
            "test.dts:4:1: expected `}`, found end of file"
        );
    }

    #[test]
    fn accepts_negative_cells_like_dtc() {
        let graph = import("/dts-v1/;\n/ { a = <(-3000000000) (-1)>; };");
        assert_eq!(
            prop(&graph, "/", "a"),
            &PropertyValue::Cells(vec![0x4d2f_a200, 0xffff_ffff])
        );
    }

    #[test]
    fn skips_cpp_line_markers() {
        let graph = import("# 1 \"board.dts\"\n/dts-v1/;\n# 3 \"board.dts\" 2\n/ { a; };");
        assert_eq!(prop(&graph, "/", "a"), &PropertyValue::Empty);
    }

    #[test]
    fn label_paths_and_labels_freed_by_deletion() {
        let graph = import(
            "/dts-v1/;\n\
             / { a: x { k: kid { }; }; b { k: kid { }; }; m: multi: n { }; };\n\
             /delete-node/ &{a/kid};\n\
             &k { here; };\n\
             l: &multi { };\n\
             /omit-if-no-ref/ &multi;\n\
             / { p: /omit-if-no-ref/ pins { }; };\n",
        );
        assert!(node(&graph, "/n").omit_if_no_ref);
        assert!(node(&graph, "/pins").omit_if_no_ref);
        assert!(node(&graph, "/b/kid")
            .properties
            .iter()
            .any(|p| p.name == "here"));
        assert_eq!(child_names(&graph, "/x"), Vec::<String>::new());
        let n = node(&graph, "/n");
        assert_eq!(n.label.as_deref(), Some("m"));
        assert_eq!(n.extra_labels, ["multi", "l"]);
        assert_eq!(
            error("/dts-v1/;\n/ { a: x { }; a: y { }; };\n"),
            "test.dts:2:18: duplicate label `a`"
        );
    }

    #[test]
    fn deleted_labels_cannot_be_referenced() {
        assert_eq!(
            error("/dts-v1/;\n/ { a: x { }; };\n/delete-node/ &a;\n/ { y = <&a>; };"),
            "test.dts:4:10: reference to unknown node `a`"
        );
    }

    #[test]
    fn hash_properties_are_not_preprocessor_directives() {
        let graph = import("/dts-v1/;\n/ {\n#address-cells = <2>;\n#size-cells = <1>;\n};");
        assert_eq!(
            prop(&graph, "/", "#address-cells"),
            &PropertyValue::Cells(vec![2])
        );
    }

    #[test]
    fn rejects_deep_nesting_without_overflowing_the_stack() {
        let deep = 100_000;
        for source in [
            format!(
                "/dts-v1/;\n/ {{ a = <{}1{}>; }};",
                "(".repeat(deep),
                ")".repeat(deep)
            ),
            format!("/dts-v1/;\n/ {{ a = <({}1)>; }};", "-".repeat(deep)),
            format!("/dts-v1/;\n/ {{ {} }};", "n { ".repeat(deep)),
            format!(
                "/dts-v1/;\n#if {}1{}\n#endif\n",
                "(".repeat(deep),
                ")".repeat(deep)
            ),
        ] {
            assert!(
                error(&source).ends_with("nested too deeply"),
                "{source:.40}"
            );
        }
    }

    #[test]
    fn includes_stay_inside_the_imported_tree() {
        let dir = std::env::temp_dir().join(format!("designtree-confine-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("board")).unwrap();
        std::fs::write(dir.join("secret.dtsi"), "/ { };\n").unwrap();
        std::fs::write(dir.join("board/ok.dtsi"), "/ { };\n").unwrap();
        let import = |include: &str| {
            let source = format!("/dts-v1/;\n#include \"{include}\"\n");
            import_dts(&source, &dir.join("board/b.dts"), &ImportOptions::default())
        };
        let inside = import("ok.dtsi");
        let outside = import("../secret.dtsi");
        let absolute = import(&dir.join("secret.dtsi").display().to_string());
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(inside.is_ok(), "{inside:?}");
        for result in [outside, absolute] {
            let message = result.unwrap_err().message;
            assert!(message.contains("outside the directory"), "{message}");
        }
    }
}
