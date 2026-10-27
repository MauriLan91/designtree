use std::collections::HashMap;
use std::fmt::Write;

use crate::model::{Cell, EdgeKind, Graph, Node, NodeId, PropertyValue, ValueChunk};
use crate::validate::{validate, ValidationError};

/// Generates devicetree source from a design. Fails if the graph does not
/// pass [`validate`].
///
/// A design imported from a board file with includes is written the same
/// way: its include directives, then only what the board adds or changes
/// on top of the included files, as `&label { ... };` overrides. Use
/// [`to_dts_flat`] for one self-contained tree.
pub fn to_dts(graph: &Graph) -> Result<String, Vec<ValidationError>> {
    if graph.includes.is_empty() && graph.trailing_includes.is_empty() {
        return to_dts_flat(graph);
    }
    check(graph)?;
    let root = graph.root().expect("validated graph has a root");

    let mut out = String::from("/dts-v1/;\n\n");
    write_memreserves(graph, false, &mut out);
    for include in &graph.includes {
        let _ = writeln!(out, "{include}");
    }
    out.push('\n');
    for target in &graph.deleted_nodes {
        let _ = writeln!(out, "/delete-node/ {};", format_reference(target));
    }
    if !graph.deleted_nodes.is_empty() {
        out.push('\n');
    }
    // Phandles in inherited values name a node by any of its labels; edges
    // use its main label.
    let primary_labels: HashMap<&str, &str> = graph
        .nodes
        .iter()
        .filter_map(|n| n.label.as_deref().map(|primary| (n, primary)))
        .flat_map(|(n, primary)| n.labels().map(move |l| (l.as_str(), primary)))
        .collect();
    write_overrides(graph, root, &primary_labels, &mut out);
    // `/omit-if-no-ref/` the board adds to inherited nodes.
    for node in &graph.nodes {
        if node.omit_if_no_ref && node.inherited.as_ref().is_some_and(|b| !b.omit_if_no_ref) {
            let target = base_label(node).map_or(node.id.0.as_str(), String::as_str);
            let _ = writeln!(out, "/omit-if-no-ref/ {};\n", format_reference(target));
        }
    }
    for include in &graph.trailing_includes {
        let _ = writeln!(out, "{include}");
    }
    Ok(out)
}

/// Generates devicetree source for the whole tree, included nodes and all.
pub fn to_dts_flat(graph: &Graph) -> Result<String, Vec<ValidationError>> {
    to_dts_flat_mapped(graph).map(|(dts, _)| dts)
}

/// Like [`to_dts_flat`], also returning which lines of the source belong to
/// which node, to attach compiler messages to nodes.
pub fn to_dts_flat_mapped(graph: &Graph) -> Result<(String, SourceMap), Vec<ValidationError>> {
    check(graph)?;
    let root = graph.root().expect("validated graph has a root");
    let mut out = String::from("/dts-v1/;\n\n");
    write_memreserves(graph, true, &mut out);
    let mut map = SourceMap::default();
    write_node(graph, root, 0, "", &mut out, &mut map);
    Ok((out, map))
}

/// The lines (1-based, inclusive) a node's block takes in generated source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeSpan {
    pub node: NodeId,
    /// Full path of the node, as dtc prints it (`/soc/serial@1000`).
    pub path: String,
    pub first_line: u32,
    pub last_line: u32,
}

/// Where each node is in a generated devicetree source.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SourceMap {
    /// In order of appearance, so a parent precedes its children.
    pub spans: Vec<NodeSpan>,
    /// Newlines in the source up to `counted_to`, for [`Self::line_at`].
    counted_to: usize,
    newlines: u32,
}

impl SourceMap {
    /// The node whose block contains `line`: the innermost one, so a
    /// property line maps to its node and not to the node's parents.
    pub fn node_at_line(&self, line: u32) -> Option<&NodeSpan> {
        self.spans
            .iter()
            .filter(|s| s.first_line <= line && line <= s.last_line)
            .min_by_key(|s| s.last_line - s.first_line)
    }

    pub fn node_at_path(&self, path: &str) -> Option<&NodeSpan> {
        self.spans.iter().find(|s| s.path == path)
    }

    /// The line `out` ends on so far; `out` only ever grows between calls.
    fn line_at(&mut self, out: &str) -> u32 {
        self.newlines += out.as_bytes()[self.counted_to..]
            .iter()
            .filter(|b| **b == b'\n')
            .count() as u32;
        self.counted_to = out.len();
        self.newlines + 1
    }
}

fn check(graph: &Graph) -> Result<(), Vec<ValidationError>> {
    let errors = validate(graph);
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

fn write_memreserves(graph: &Graph, inherited_too: bool, out: &mut String) {
    let reserves: Vec<_> = graph
        .memreserves
        .iter()
        .filter(|r| inherited_too || !r.inherited)
        .collect();
    for reserve in &reserves {
        let _ = writeln!(
            out,
            "/memreserve/ {:#x} {:#x};",
            reserve.address, reserve.size
        );
    }
    if !reserves.is_empty() {
        out.push('\n');
    }
}

/// Width of a tab in kernel sources, used to wrap long values.
const TAB_WIDTH: usize = 8;
/// Lines are wrapped so they do not exceed this many columns.
const MAX_COLUMNS: usize = 80;

/// One comma-separated piece of a property value: `<cells>`, `"string"`,
/// `[bytes]` or `&path`. `tokens` may be split across lines.
struct Item {
    open: String,
    tokens: Vec<String>,
    close: &'static str,
}

impl Item {
    fn single(token: String) -> Self {
        Item {
            open: String::new(),
            tokens: vec![token],
            close: "",
        }
    }

    fn cells(open: String, tokens: Vec<String>) -> Self {
        Item {
            open,
            tokens,
            close: ">",
        }
    }

    fn bytes(bytes: &[u8]) -> Self {
        Item {
            open: "[".into(),
            tokens: bytes.iter().map(|b| format!("{b:02x}")).collect(),
            close: "]",
        }
    }
}

/// Writes what the board changes on the inherited `node` as an override
/// (`&label { ... };`, `/ { ... };` for the root), then the overrides of
/// its labeled inherited descendants.
fn write_overrides(
    graph: &Graph,
    node: &Node,
    primary_labels: &HashMap<&str, &str>,
    out: &mut String,
) {
    let mut deferred = Vec::new();
    let body = override_body(graph, node, 1, primary_labels, &mut deferred);
    let new_labels = new_labels(node);
    if !body.is_empty() || !new_labels.is_empty() {
        for label in &new_labels {
            let _ = write!(out, "{label}: ");
        }
        // dtc takes no label before `/ {`, so a new root label needs `&{/}`.
        match (node.is_root(), base_label(node)) {
            (true, _) if new_labels.is_empty() => out.push_str("/ {\n"),
            (true, _) => out.push_str("&{/} {\n"),
            (false, Some(target)) => {
                let _ = writeln!(out, "{} {{", format_reference(target));
            }
            (false, None) => unreachable!("only labeled nodes get an override"),
        }
        out.push_str(&body);
        out.push_str("};\n\n");
    }
    for node in deferred {
        write_overrides(graph, node, primary_labels, out);
    }
}

/// The changes to the inherited `node`, indented for `depth`: deleted and
/// changed properties, the nodes the board adds (whole), and changes to
/// unlabeled inherited children (nested). Labeled inherited children get
/// their own override and go to `deferred`.
fn override_body<'a>(
    graph: &'a Graph,
    node: &'a Node,
    depth: usize,
    primary_labels: &HashMap<&str, &str>,
    deferred: &mut Vec<&'a Node>,
) -> String {
    let indent = "\t".repeat(depth);
    let base: Vec<(&str, Option<String>)> = node
        .inherited
        .iter()
        .flat_map(|b| &b.properties)
        .map(|p| {
            let value = with_primary_labels(primary_labels, &p.value);
            (p.name.as_str(), one_line(&property_items(&value)))
        })
        .collect();

    let mut body = String::new();
    let current = node_properties(graph, node);
    for (name, _) in &base {
        if !current.iter().any(|(n, _)| n == name) {
            let _ = writeln!(body, "{indent}/delete-property/ {name};");
        }
    }
    for (name, value) in current {
        if !base.contains(&(name.as_str(), one_line(&value))) {
            write_any_property(&mut body, depth, &name, value);
        }
    }
    for child in graph.children(&node.id) {
        let mut piece = String::new();
        if child.inherited.is_none() {
            write_node(
                graph,
                child,
                depth,
                "",
                &mut piece,
                &mut SourceMap::default(),
            );
        } else if base_label(child).is_some() {
            deferred.push(child);
        } else {
            let inner = override_body(graph, child, depth + 1, primary_labels, deferred);
            let new_labels = new_labels(child);
            if !inner.is_empty() || !new_labels.is_empty() {
                piece.push_str(&indent);
                for label in new_labels {
                    let _ = write!(piece, "{label}: ");
                }
                let _ = writeln!(piece, "{} {{", child.full_name());
                piece.push_str(&inner);
                let _ = writeln!(piece, "{indent}}};");
            }
        }
        // Kernel style: a blank line before each node, but not first.
        if !piece.is_empty() {
            if !body.is_empty() {
                body.push('\n');
            }
            body.push_str(&piece);
        }
    }
    body
}

/// A label the included files give `node` and that it still has.
fn base_label(node: &Node) -> Option<&String> {
    node.inherited
        .as_ref()?
        .labels
        .iter()
        .find(|l| node.labels().any(|own| own == *l))
}

/// Labels of `node` that the included files do not give it.
fn new_labels(node: &Node) -> Vec<&String> {
    let base = node
        .inherited
        .as_ref()
        .map(|b| b.labels.as_slice())
        .unwrap_or_default();
    node.labels().filter(|l| !base.contains(l)).collect()
}

/// `value` with phandles to labeled nodes written with the node's main
/// label, as reference edges are, so that equal values compare equal.
fn with_primary_labels(
    primary_labels: &HashMap<&str, &str>,
    value: &PropertyValue,
) -> PropertyValue {
    let mut value = value.clone();
    if let PropertyValue::Mixed(chunks) = &mut value {
        for chunk in chunks {
            if let ValueChunk::Cells { cells, .. } = chunk {
                for cell in cells {
                    if let Cell::Phandle { phandle } = cell {
                        if let Some(primary) = primary_labels.get(phandle.as_str()) {
                            *phandle = (*primary).to_owned();
                        }
                    }
                }
            }
        }
    }
    value
}

/// Properties of `node` in output order: `compatible`, the others, then
/// phandle lists from reference edges. `None` is a boolean property.
fn node_properties(graph: &Graph, node: &Node) -> Vec<(String, Option<Vec<Item>>)> {
    let mut props = Vec::new();
    if !node.compatible.is_empty() {
        let items = node.compatible.iter().map(|s| Item::single(quote(s)));
        props.push(("compatible".to_owned(), Some(items.collect())));
    }
    for prop in &node.properties {
        props.push((prop.name.clone(), property_items(&prop.value)));
    }
    // Reference edges with the same property form one phandle list.
    let mut phandle_lists: Vec<(&str, Vec<Item>)> = Vec::new();
    for edge in graph.references(&node.id) {
        if let EdgeKind::Reference { property, args } = &edge.kind {
            let target = graph
                .node(&edge.to)
                .and_then(|n| n.label.as_deref())
                .unwrap_or("?");
            let mut cells = vec![format!("&{target}")];
            cells.extend(args.iter().map(|a| format_cell(u64::from(*a))));
            let item = Item::cells("<".into(), cells);
            match phandle_lists.iter_mut().find(|(p, _)| p == property) {
                Some((_, items)) => items.push(item),
                None => phandle_lists.push((property, vec![item])),
            }
        }
    }
    for (property, items) in phandle_lists {
        props.push((property.to_owned(), Some(items)));
    }
    props
}

fn property_items(value: &PropertyValue) -> Option<Vec<Item>> {
    match value {
        PropertyValue::Empty => None,
        value => Some(value_items(value)),
    }
}

/// A value on one line, to compare values.
fn one_line(value: &Option<Vec<Item>>) -> Option<String> {
    value.as_ref().map(|items| {
        items
            .iter()
            .map(|i| format!("{}{}{}", i.open, i.tokens.join(" "), i.close))
            .collect::<Vec<_>>()
            .join(", ")
    })
}

fn write_any_property(out: &mut String, depth: usize, name: &str, value: Option<Vec<Item>>) {
    match value {
        None => {
            let _ = writeln!(out, "{}{name};", "\t".repeat(depth));
        }
        Some(items) => write_property(out, depth, name, items),
    }
}

fn write_node(
    graph: &Graph,
    node: &Node,
    depth: usize,
    parent_path: &str,
    out: &mut String,
    map: &mut SourceMap,
) {
    let indent = "\t".repeat(depth);
    let path = match (node.is_root(), parent_path) {
        (true, _) => "/".to_owned(),
        (false, "/") | (false, "") => format!("/{}", node.full_name()),
        (false, parent) => format!("{parent}/{}", node.full_name()),
    };
    let first_line = map.line_at(out);
    let span = map.spans.len();
    map.spans.push(NodeSpan {
        node: node.id.clone(),
        path: path.clone(),
        first_line,
        last_line: first_line,
    });

    let _ = write!(out, "{indent}");
    for label in node.labels() {
        let _ = write!(out, "{label}: ");
    }
    if node.omit_if_no_ref {
        out.push_str("/omit-if-no-ref/ ");
    }
    let _ = writeln!(out, "{} {{", node.full_name());

    let properties = node_properties(graph, node);
    let has_properties = !properties.is_empty();
    for (name, value) in properties {
        write_any_property(out, depth + 1, &name, value);
    }

    // Kernel style: a blank line separates properties from subnodes and
    // subnodes from each other, but never follows the opening brace.
    for (i, child) in graph.children(&node.id).enumerate() {
        if has_properties || i > 0 {
            out.push('\n');
        }
        write_node(graph, child, depth + 1, &path, out, map);
    }
    let _ = writeln!(out, "{indent}}};");
    map.spans[span].last_line = map.line_at(out) - 1;
}

/// Writes `name = item, item;`, wrapping at [`MAX_COLUMNS`] and aligning
/// continuation lines under the start of the value, as the kernel does
/// (tabs first, then spaces).
fn write_property(out: &mut String, depth: usize, name: &str, items: Vec<Item>) {
    // Flatten to tokens: an item's opening goes on its first token, its
    // closing and the separating comma on its last.
    let mut tokens = Vec::new();
    let last_item = items.len().saturating_sub(1);
    for (i, item) in items.into_iter().enumerate() {
        let last_token = item.tokens.len().saturating_sub(1);
        let mut empty = item.tokens.is_empty();
        for (j, token) in item.tokens.into_iter().enumerate() {
            let mut piece = String::new();
            if j == 0 {
                piece.push_str(&item.open);
            }
            piece.push_str(&token);
            if j == last_token {
                piece.push_str(item.close);
                if i < last_item {
                    piece.push(',');
                }
            }
            tokens.push(piece);
            empty = false;
        }
        if empty {
            // `<>` and `[]` carry no tokens.
            let mut piece = format!("{}{}", item.open, item.close);
            if i < last_item {
                piece.push(',');
            }
            tokens.push(piece);
        }
    }

    let prefix = format!("{name} = ");
    let align = depth * TAB_WIDTH + prefix.len();
    let mut line = format!("{}{prefix}", "\t".repeat(depth));
    let mut col = align;
    let last = tokens.len().saturating_sub(1);
    for (i, token) in tokens.iter().enumerate() {
        let piece = if i == last {
            format!("{token};")
        } else {
            token.clone()
        };
        if i > 0 {
            if col + 1 + piece.len() > MAX_COLUMNS {
                out.push_str(&line);
                out.push('\n');
                line = format!(
                    "{}{}",
                    "\t".repeat(align / TAB_WIDTH),
                    " ".repeat(align % TAB_WIDTH)
                );
                col = align;
            } else {
                line.push(' ');
                col += 1;
            }
        }
        line.push_str(&piece);
        col += piece.len();
    }
    out.push_str(&line);
    out.push('\n');
}

fn value_items(value: &PropertyValue) -> Vec<Item> {
    match value {
        PropertyValue::Empty => vec![],
        PropertyValue::Cells(cells) => {
            let cells = cells.iter().map(|c| format_cell(u64::from(*c))).collect();
            vec![Item::cells("<".into(), cells)]
        }
        PropertyValue::Strings(strings) => strings.iter().map(|s| Item::single(quote(s))).collect(),
        PropertyValue::Bytes(bytes) => vec![Item::bytes(bytes)],
        PropertyValue::Mixed(chunks) => chunks.iter().map(chunk_item).collect(),
    }
}

fn chunk_item(chunk: &ValueChunk) -> Item {
    match chunk {
        ValueChunk::Cells { bits, cells } => {
            let cells = cells
                .iter()
                .map(|cell| match cell {
                    Cell::Number(n) => format_cell(*n),
                    Cell::Phandle { phandle } => format_reference(phandle),
                })
                .collect();
            let open = if *bits == 32 {
                "<".to_string()
            } else {
                format!("/bits/ {bits} <")
            };
            Item::cells(open, cells)
        }
        ValueChunk::String { value } => Item::single(quote(value)),
        ValueChunk::Bytes { value } => Item::bytes(value),
        ValueChunk::Path { target } => Item::single(format_reference(target)),
    }
}

pub(crate) fn quote(s: &str) -> String {
    let mut quoted = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\t' => quoted.push_str("\\t"),
            '\r' => quoted.push_str("\\r"),
            c if c.is_control() => {
                let mut buf = [0; 4];
                for b in c.encode_utf8(&mut buf).bytes() {
                    let _ = write!(quoted, "\\x{b:02x}");
                }
            }
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

fn format_cell(cell: u64) -> String {
    if cell < 10 {
        cell.to_string()
    } else {
        format!("{cell:#x}")
    }
}

/// `&label`, or `&{/path}` for a path target.
fn format_reference(target: &str) -> String {
    if target.starts_with('/') {
        format!("&{{{target}}}")
    } else {
        format!("&{target}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn node(id: &str, name: &str) -> Node {
        Node {
            id: id.into(),
            name: name.into(),
            unit_address: None,
            label: None,
            extra_labels: vec![],
            omit_if_no_ref: false,
            compatible: vec![],
            properties: vec![],
            inherited: None,
            position: Position::default(),
        }
    }

    fn child(from: &str, to: &str) -> Edge {
        Edge {
            from: from.into(),
            to: to.into(),
            kind: EdgeKind::Child,
        }
    }

    #[test]
    fn emits_hierarchy_and_phandles() {
        let mut osc = node("osc", "oscillator");
        osc.label = Some("osc".into());
        osc.compatible = vec!["fixed-clock".into()];
        osc.properties = vec![
            Property {
                name: "#clock-cells".into(),
                value: PropertyValue::Cells(vec![0]),
            },
            Property {
                name: "clock-frequency".into(),
                value: PropertyValue::Cells(vec![24_000_000]),
            },
        ];
        let mut uart = node("uart", "serial");
        uart.unit_address = Some("10000000".into());
        uart.compatible = vec!["ns16550a".into()];
        uart.properties = vec![Property {
            name: "reg".into(),
            value: PropertyValue::Cells(vec![0x1000_0000, 0x100]),
        }];

        let graph = Graph {
            nodes: vec![node("root", "/"), osc, uart],
            edges: vec![
                child("root", "osc"),
                child("root", "uart"),
                Edge {
                    from: "uart".into(),
                    to: "osc".into(),
                    kind: EdgeKind::Reference {
                        property: "clocks".into(),
                        args: vec![],
                    },
                },
            ],
            groups: vec![],
            ..Default::default()
        };

        let dts = to_dts(&graph).unwrap();
        assert_eq!(
            dts,
            "/dts-v1/;\n\n\
             / {\n\
             \tosc: oscillator {\n\
             \t\tcompatible = \"fixed-clock\";\n\
             \t\t#clock-cells = <0>;\n\
             \t\tclock-frequency = <0x16e3600>;\n\
             \t};\n\
             \n\
             \tserial@10000000 {\n\
             \t\tcompatible = \"ns16550a\";\n\
             \t\treg = <0x10000000 0x100>;\n\
             \t\tclocks = <&osc>;\n\
             \t};\n\
             };\n"
        );
    }

    fn graph_with(properties: Vec<Property>) -> Graph {
        let mut soc = node("soc", "soc");
        soc.properties = properties;
        Graph {
            nodes: vec![node("root", "/"), soc],
            edges: vec![child("root", "soc")],
            groups: vec![],
            ..Default::default()
        }
    }

    #[test]
    fn keeps_child_order() {
        let graph = Graph {
            nodes: vec![node("root", "/"), node("z", "zeta"), node("a", "alpha")],
            edges: vec![child("root", "z"), child("root", "a")],
            groups: vec![],
            ..Default::default()
        };
        assert_eq!(
            to_dts(&graph).unwrap(),
            "/dts-v1/;\n\n/ {\n\tzeta {\n\t};\n\n\talpha {\n\t};\n};\n"
        );
    }

    #[test]
    fn wraps_long_values_aligned_with_the_value() {
        let cells: Vec<u32> = (0..16).map(|i| 0x1000_0000 + i).collect();
        let dts = to_dts(&graph_with(vec![Property {
            name: "ranges".into(),
            value: PropertyValue::Cells(cells),
        }]))
        .unwrap();
        let lines: Vec<_> = dts.lines().filter(|l| l.contains("0x1000")).collect();
        assert!(lines.len() > 1);
        assert!(lines[0].starts_with("\t\tranges = <0x10000000"));
        // Continuation lines align under the value: two tabs + 9 columns.
        assert!(lines[1].starts_with("\t\t\t 0x"));
        for line in &lines {
            let width = line.replace('\t', "        ").len();
            assert!(width <= 80, "{line:?} is {width} columns");
        }
        assert!(dts.contains(">;\n"));
    }

    #[test]
    fn wraps_comma_separated_chunks_after_the_comma() {
        let strings: Vec<String> = (0..8)
            .map(|i| format!("vendor,device-number-{i}"))
            .collect();
        let dts = to_dts(&graph_with(vec![Property {
            name: "names".into(),
            value: PropertyValue::Strings(strings),
        }]))
        .unwrap();
        let lines: Vec<_> = dts.lines().filter(|l| l.contains("vendor")).collect();
        assert!(lines.len() > 1);
        assert!(lines[0].ends_with(','));
        assert!(lines[1].starts_with("\t\t\t\"vendor"), "{:?}", lines[1]);
        assert!(lines.last().unwrap().ends_with("\";"));
    }

    #[test]
    fn rejects_detached_and_unlabeled() {
        let graph = Graph {
            nodes: vec![node("root", "/"), node("a", "a"), node("b", "b")],
            edges: vec![
                child("root", "a"),
                Edge {
                    from: "a".into(),
                    to: "b".into(),
                    kind: EdgeKind::Reference {
                        property: "clocks".into(),
                        args: vec![],
                    },
                },
            ],
            groups: vec![],
            ..Default::default()
        };
        let errors = to_dts(&graph).unwrap_err();
        assert!(errors.contains(&ValidationError::Detached("b".into())));
        assert!(errors.contains(&ValidationError::UnlabeledTarget("b".into())));
    }

    #[test]
    fn emits_mixed_values_and_escaped_strings() {
        let mut root = node("root", "/");
        root.properties = vec![
            Property {
                name: "model".into(),
                value: PropertyValue::Strings(vec!["a \"b\"\n".into()]),
            },
            Property {
                name: "mixed".into(),
                value: PropertyValue::Mixed(vec![
                    ValueChunk::Cells {
                        bits: 64,
                        cells: vec![Cell::Number(0x1_0000_0000)],
                    },
                    ValueChunk::Path { target: "/".into() },
                    ValueChunk::Cells {
                        bits: 32,
                        cells: vec![
                            Cell::Number(1),
                            Cell::Phandle {
                                phandle: "missing".into(),
                            },
                        ],
                    },
                ]),
            },
        ];
        let mut graph = Graph {
            nodes: vec![root],
            edges: vec![],
            groups: vec![],
            ..Default::default()
        };
        assert_eq!(
            to_dts(&graph).unwrap_err(),
            [ValidationError::UnknownReference {
                node: "root".into(),
                property: "mixed".into(),
                target: "missing".into(),
            }]
        );

        graph.nodes[0].label = Some("missing".into());
        assert_eq!(
            to_dts(&graph).unwrap(),
            "/dts-v1/;\n\n\
             missing: / {\n\
             \tmodel = \"a \\\"b\\\"\\n\";\n\
             \tmixed = /bits/ 64 <0x100000000>, &{/}, <1 &missing>;\n\
             };\n"
        );
    }

    #[test]
    fn large_cells_survive_json_in_javascript() {
        let chunk = ValueChunk::Cells {
            bits: 64,
            cells: vec![Cell::Number(7), Cell::Number(0xffff_ffff_ffff_fff1)],
        };
        let json = serde_json::to_string(&chunk).unwrap();
        assert_eq!(
            json,
            r#"{"type":"cells","bits":64,"cells":[7,"0xfffffffffffffff1"]}"#
        );
        assert_eq!(serde_json::from_str::<ValueChunk>(&json).unwrap(), chunk);
    }

    #[test]
    fn rejects_hierarchy_cycles() {
        let graph = Graph {
            nodes: vec![node("root", "/"), node("a", "a"), node("b", "b")],
            edges: vec![child("a", "b"), child("b", "a")],
            groups: vec![],
            ..Default::default()
        };
        let errors = validate(&graph);
        assert!(errors.contains(&ValidationError::Detached("a".into())));
        assert!(errors.contains(&ValidationError::Detached("b".into())));
    }
}
