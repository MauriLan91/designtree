use std::fmt::Write;

use crate::model::{Cell, EdgeKind, Graph, Node, PropertyValue, ValueChunk};
use crate::validate::{validate, ValidationError};

/// Generates devicetree source from a design. Fails if the graph does not
/// pass [`validate`].
pub fn to_dts(graph: &Graph) -> Result<String, Vec<ValidationError>> {
    let errors = validate(graph);
    if !errors.is_empty() {
        return Err(errors);
    }
    let root = graph.root().expect("validated graph has a root");

    let mut out = String::from("/dts-v1/;\n\n");
    for reserve in &graph.memreserves {
        let _ = writeln!(
            out,
            "/memreserve/ {:#x} {:#x};",
            reserve.address, reserve.size
        );
    }
    if !graph.memreserves.is_empty() {
        out.push('\n');
    }
    write_node(graph, root, 0, &mut out);
    Ok(out)
}

fn write_node(graph: &Graph, node: &Node, depth: usize, out: &mut String) {
    let indent = "\t".repeat(depth);
    let inner = "\t".repeat(depth + 1);

    let _ = write!(out, "{indent}");
    for label in node.labels() {
        let _ = write!(out, "{label}: ");
    }
    if node.omit_if_no_ref {
        out.push_str("/omit-if-no-ref/ ");
    }
    let _ = writeln!(out, "{} {{", node.full_name());

    if !node.compatible.is_empty() {
        let _ = writeln!(out, "{inner}compatible = {};", quote_all(&node.compatible));
    }
    for prop in &node.properties {
        match &prop.value {
            PropertyValue::Empty => {
                let _ = writeln!(out, "{inner}{};", prop.name);
            }
            value => {
                let _ = writeln!(out, "{inner}{} = {};", prop.name, format_value(value));
            }
        }
    }
    // Reference edges with the same property form one phandle list.
    let mut phandle_lists: Vec<(&str, Vec<String>)> = Vec::new();
    for edge in graph.references(&node.id) {
        if let EdgeKind::Reference { property, args } = &edge.kind {
            let target = graph
                .node(&edge.to)
                .and_then(|n| n.label.as_deref())
                .unwrap_or("?");
            let mut entry = format!("<&{target}");
            for arg in args {
                let _ = write!(entry, " {}", format_cell(u64::from(*arg)));
            }
            entry.push('>');
            match phandle_lists.iter_mut().find(|(p, _)| p == property) {
                Some((_, entries)) => entries.push(entry),
                None => phandle_lists.push((property, vec![entry])),
            }
        }
    }
    for (property, entries) in phandle_lists {
        let _ = writeln!(out, "{inner}{property} = {};", entries.join(", "));
    }

    for child in graph.children(&node.id) {
        out.push('\n');
        write_node(graph, child, depth + 1, out);
    }
    let _ = writeln!(out, "{indent}}};");
}

fn quote_all(strings: &[String]) -> String {
    strings
        .iter()
        .map(|s| quote(s))
        .collect::<Vec<_>>()
        .join(", ")
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

fn format_bytes(bytes: &[u8]) -> String {
    let bytes: Vec<_> = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("[{}]", bytes.join(" "))
}

/// `&label`, or `&{/path}` for a path target.
fn format_reference(target: &str) -> String {
    if target.starts_with('/') {
        format!("&{{{target}}}")
    } else {
        format!("&{target}")
    }
}

fn format_value(value: &PropertyValue) -> String {
    match value {
        PropertyValue::Empty => String::new(),
        PropertyValue::Cells(cells) => {
            let cells: Vec<_> = cells.iter().map(|c| format_cell(u64::from(*c))).collect();
            format!("<{}>", cells.join(" "))
        }
        PropertyValue::Strings(strings) => quote_all(strings),
        PropertyValue::Bytes(bytes) => format_bytes(bytes),
        PropertyValue::Mixed(chunks) => chunks
            .iter()
            .map(format_chunk)
            .collect::<Vec<_>>()
            .join(", "),
    }
}

fn format_chunk(chunk: &ValueChunk) -> String {
    match chunk {
        ValueChunk::Cells { bits, cells } => {
            let cells: Vec<_> = cells
                .iter()
                .map(|cell| match cell {
                    Cell::Number(n) => format_cell(*n),
                    Cell::Phandle { phandle } => format_reference(phandle),
                })
                .collect();
            let prefix = if *bits == 32 {
                String::new()
            } else {
                format!("/bits/ {bits} ")
            };
            format!("{prefix}<{}>", cells.join(" "))
        }
        ValueChunk::String { value } => quote(value),
        ValueChunk::Bytes { value } => format_bytes(value),
        ValueChunk::Path { target } => format_reference(target),
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
             \n\
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
