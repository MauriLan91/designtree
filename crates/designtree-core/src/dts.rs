use std::fmt::Write;

use crate::model::{EdgeKind, Graph, Node, PropertyValue};
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
    write_node(graph, root, 0, &mut out);
    Ok(out)
}

fn write_node(graph: &Graph, node: &Node, depth: usize, out: &mut String) {
    let indent = "\t".repeat(depth);
    let inner = "\t".repeat(depth + 1);

    let _ = write!(out, "{indent}");
    if let Some(label) = &node.label {
        let _ = write!(out, "{label}: ");
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
    for edge in graph.references(&node.id) {
        if let EdgeKind::Reference { property, args } = &edge.kind {
            let target = graph
                .node(&edge.to)
                .and_then(|n| n.label.as_deref())
                .unwrap_or("?");
            let mut cells = format!("&{target}");
            for arg in args {
                let _ = write!(cells, " {}", format_cell(*arg));
            }
            let _ = writeln!(out, "{inner}{property} = <{cells}>;");
        }
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
        .map(|s| format!("\"{s}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_cell(cell: u32) -> String {
    if cell < 10 {
        cell.to_string()
    } else {
        format!("{cell:#x}")
    }
}

fn format_value(value: &PropertyValue) -> String {
    match value {
        PropertyValue::Empty => String::new(),
        PropertyValue::Cells(cells) => {
            let cells: Vec<_> = cells.iter().map(|c| format_cell(*c)).collect();
            format!("<{}>", cells.join(" "))
        }
        PropertyValue::Strings(strings) => quote_all(strings),
        PropertyValue::Bytes(bytes) => {
            let bytes: Vec<_> = bytes.iter().map(|b| format!("{b:02x}")).collect();
            format!("[{}]", bytes.join(" "))
        }
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
        };
        let errors = to_dts(&graph).unwrap_err();
        assert!(errors.contains(&ValidationError::Detached("b".into())));
        assert!(errors.contains(&ValidationError::UnlabeledTarget("b".into())));
    }

    #[test]
    fn rejects_hierarchy_cycles() {
        let graph = Graph {
            nodes: vec![node("root", "/"), node("a", "a"), node("b", "b")],
            edges: vec![child("a", "b"), child("b", "a")],
            groups: vec![],
        };
        let errors = validate(&graph);
        assert!(errors.contains(&ValidationError::Detached("a".into())));
        assert!(errors.contains(&ValidationError::Detached("b".into())));
    }
}
