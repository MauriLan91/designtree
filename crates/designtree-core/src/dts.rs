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

/// Width of a tab in kernel sources, used to wrap long values.
const TAB_WIDTH: usize = 8;
/// Lines are wrapped so they do not exceed this many columns.
const MAX_COLUMNS: usize = 80;

fn write_node(graph: &Graph, node: &Node, depth: usize, out: &mut String) {
    let indent = "\t".repeat(depth);
    let inner = "\t".repeat(depth + 1);

    let _ = write!(out, "{indent}");
    if let Some(label) = &node.label {
        let _ = write!(out, "{label}: ");
    }
    let _ = writeln!(out, "{} {{", node.full_name());

    let mut has_properties = false;
    if !node.compatible.is_empty() {
        has_properties = true;
        let strings = node.compatible.iter().map(|s| quote(s)).collect();
        write_list(out, depth + 1, "compatible", "", strings, "");
    }
    for prop in &node.properties {
        has_properties = true;
        match &prop.value {
            PropertyValue::Empty => {
                let _ = writeln!(out, "{inner}{};", prop.name);
            }
            PropertyValue::Cells(cells) => {
                let cells = cells.iter().map(|c| format_cell(*c)).collect();
                write_list(out, depth + 1, &prop.name, "<", cells, ">");
            }
            PropertyValue::Strings(strings) => {
                let strings = strings.iter().map(|s| quote(s)).collect();
                write_list(out, depth + 1, &prop.name, "", strings, "");
            }
            PropertyValue::Bytes(bytes) => {
                let bytes = bytes.iter().map(|b| format!("{b:02x}")).collect();
                write_list(out, depth + 1, &prop.name, "[", bytes, "]");
            }
        }
    }
    for edge in graph.references(&node.id) {
        if let EdgeKind::Reference { property, args } = &edge.kind {
            has_properties = true;
            let target = graph
                .node(&edge.to)
                .and_then(|n| n.label.as_deref())
                .unwrap_or("?");
            let mut cells = vec![format!("&{target}")];
            cells.extend(args.iter().map(|a| format_cell(*a)));
            write_list(out, depth + 1, property, "<", cells, ">");
        }
    }

    // Kernel style: a blank line separates properties from subnodes and
    // subnodes from each other, but never follows the opening brace.
    for (i, child) in graph.children(&node.id).enumerate() {
        if has_properties || i > 0 {
            out.push('\n');
        }
        write_node(graph, child, depth + 1, out);
    }
    let _ = writeln!(out, "{indent}}};");
}

/// Writes `name = <open>tokens<close>;`, wrapping at [`MAX_COLUMNS`] and
/// aligning continuation lines under the first token, as the kernel does
/// (tabs first, then spaces).
fn write_list(
    out: &mut String,
    depth: usize,
    name: &str,
    open: &str,
    mut tokens: Vec<String>,
    close: &str,
) {
    let indent = "\t".repeat(depth);
    let prefix = format!("{name} = {open}");
    let align = depth * TAB_WIDTH + prefix.len();

    // Strings are separated by commas, which stay at the end of the line.
    let comma = open.is_empty();
    let last = tokens.len().saturating_sub(1);
    for (i, token) in tokens.iter_mut().enumerate() {
        if comma && i < last {
            token.push(',');
        }
    }

    let mut line = format!("{indent}{prefix}");
    let mut col = align;
    for (i, token) in tokens.iter().enumerate() {
        let mut piece = token.clone();
        if i == last {
            piece.push_str(close);
            piece.push(';');
        }
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
    if tokens.is_empty() {
        line.push_str(close);
        line.push(';');
    }
    out.push_str(&line);
    out.push('\n');
}

fn quote(s: &str) -> String {
    let mut quoted = String::with_capacity(s.len() + 2);
    quoted.push('"');
    for c in s.chars() {
        match c {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\t' => quoted.push_str("\\t"),
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

fn format_cell(cell: u32) -> String {
    if cell < 10 {
        cell.to_string()
    } else {
        format!("{cell:#x}")
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
        }
    }

    #[test]
    fn keeps_property_and_child_order() {
        let graph = Graph {
            nodes: vec![node("root", "/"), node("z", "zeta"), node("a", "alpha")],
            edges: vec![child("root", "z"), child("root", "a")],
            groups: vec![],
        };
        assert_eq!(
            to_dts(&graph).unwrap(),
            "/dts-v1/;\n\n/ {\n\tzeta {\n\t};\n\n\talpha {\n\t};\n};\n"
        );
    }

    #[test]
    fn wraps_long_values_aligned_with_the_first_cell() {
        let cells: Vec<u32> = (0..16).map(|i| 0x1000_0000 + i).collect();
        let dts = to_dts(&graph_with(vec![Property {
            name: "ranges".into(),
            value: PropertyValue::Cells(cells),
        }]))
        .unwrap();
        let lines: Vec<_> = dts.lines().filter(|l| l.contains("0x1000")).collect();
        assert!(lines.len() > 1);
        assert!(lines[0].starts_with("\t\tranges = <0x10000000"));
        // Continuation lines align under the first cell: two tabs + 10 columns.
        assert!(lines[1].starts_with("\t\t\t  0x"), "{:?}", lines[1]);
        for line in &lines {
            let width = line.replace('\t', "        ").len();
            assert!(width <= 80, "{line:?} is {width} columns");
        }
        assert!(dts.contains(">;\n"));
    }

    #[test]
    fn escapes_strings() {
        let dts = to_dts(&graph_with(vec![Property {
            name: "label".into(),
            value: PropertyValue::Strings(vec!["say \"hi\"\\".into()]),
        }]))
        .unwrap();
        assert!(dts.contains("label = \"say \\\"hi\\\"\\\\\";"), "{dts}");
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
