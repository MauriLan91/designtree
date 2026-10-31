//! Schema validation of devicetree nodes against a fixture binding.

use std::path::Path;

use designtree_bindings::{index_dir, Checker, FdtNode, SchemaProblem};

fn checker() -> Checker {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/check");
    let catalog = index_dir(&root).unwrap();
    assert!(catalog.skipped.is_empty(), "{:?}", catalog.skipped);
    Checker::new(catalog.schemas)
}

fn cells(values: &[u32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_be_bytes()).collect()
}

fn string(s: &str) -> Vec<u8> {
    let mut bytes = s.as_bytes().to_vec();
    bytes.push(0);
    bytes
}

fn node(name: &str, properties: Vec<(&str, Vec<u8>)>, children: Vec<FdtNode>) -> FdtNode {
    FdtNode {
        name: name.to_owned(),
        properties: properties
            .into_iter()
            .map(|(n, v)| (n.to_owned(), v))
            .collect(),
        children,
    }
}

/// A root with one widget node.
fn tree(widget: FdtNode) -> FdtNode {
    node(
        "",
        vec![
            ("#address-cells", cells(&[1])),
            ("#size-cells", cells(&[1])),
        ],
        vec![widget],
    )
}

fn problems(widget: FdtNode) -> Vec<SchemaProblem> {
    checker()
        .check_tree(&tree(widget))
        .into_iter()
        .filter(|p| p.schema == "misc/acme,widget.yaml")
        .collect()
}

fn widget(extra: Vec<(&str, Vec<u8>)>) -> FdtNode {
    let mut properties = vec![
        ("compatible", string("acme,widget")),
        ("reg", cells(&[0x1000, 0x100])),
    ];
    properties.extend(extra);
    node("widget@1000", properties, vec![])
}

#[test]
fn a_valid_node_has_no_problems() {
    assert_eq!(problems(widget(vec![("acme,gain", cells(&[3]))])), []);
}

#[test]
fn reports_missing_required_properties() {
    let found = problems(node(
        "widget@1000",
        vec![("compatible", string("acme,widget"))],
        vec![],
    ));
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].node, "/widget@1000");
    assert_eq!(found[0].property, None);
    assert!(found[0].message.contains("\"reg\" is a required property"));
}

#[test]
fn reports_values_outside_the_schema() {
    let found = problems(widget(vec![
        ("acme,mode", string("medium")),
        ("acme,gain", cells(&[9])),
    ]));
    let properties: Vec<_> = found.iter().filter_map(|p| p.property.as_deref()).collect();
    assert_eq!(properties, ["acme,gain", "acme,mode"], "{found:?}");
}

#[test]
fn reports_too_many_entries() {
    let found = problems(widget(vec![("interrupts", cells(&[1, 2]))]));
    // Without an interrupt parent, each cell is one interrupt.
    assert!(
        found
            .iter()
            .any(|p| p.property.as_deref() == Some("interrupts")),
        "{found:?}"
    );
}

#[test]
fn reports_undocumented_properties() {
    let found = problems(widget(vec![("acme,unknown", cells(&[1]))]));
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].message.contains("acme,unknown"), "{found:?}");
}

#[test]
fn applies_conditions_on_the_compatible() {
    let v2 = node(
        "widget@1000",
        vec![
            ("compatible", string("acme,widget-v2")),
            ("reg", cells(&[0x1000, 0x100])),
        ],
        vec![],
    );
    let found = problems(v2);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].message.contains("acme,mode"));
}

#[test]
fn locates_errors_in_child_nodes() {
    let port = node(
        "port@0",
        vec![("reg", cells(&[0])), ("acme,lanes", cells(&[3]))],
        vec![],
    );
    let mut w = widget(vec![
        ("#address-cells", cells(&[1])),
        ("#size-cells", cells(&[0])),
    ]);
    w.children.push(port);
    let found = problems(w);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].node, "/widget@1000/port@0");
    assert_eq!(found[0].property.as_deref(), Some("acme,lanes"));
}

#[test]
fn disabled_nodes_may_be_incomplete() {
    let found = problems(node(
        "widget@1000",
        vec![
            ("compatible", string("acme,widget")),
            ("status", string("disabled")),
        ],
        vec![],
    ));
    assert_eq!(found, []);
}

#[test]
fn integer_width_selects_the_type() {
    // A 64-bit value matches only the uint64 alternative.
    let wide = problems(widget(vec![("acme,window", cells(&[0, 0x1000]))]));
    assert_eq!(wide, []);
    let narrow = problems(widget(vec![("acme,window", cells(&[0x1000]))]));
    assert_eq!(narrow, []);
}

#[test]
fn reads_blobs() {
    let checker = checker();
    assert!(checker.check_dtb(b"not a blob").is_err());
}
