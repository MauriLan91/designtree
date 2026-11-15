//! A file already in kernel style survives import and export unchanged:
//! same node and property order, tabs, blank lines between nodes.

use std::path::Path;

use designtree_core::{import_dts, to_dts, ImportOptions};

const KERNEL_STYLE: &str = "/dts-v1/;

/ {
\tcompatible = \"acme,demo-board\";
\t#address-cells = <1>;
\t#size-cells = <1>;

\tosc24m: oscillator {
\t\tcompatible = \"fixed-clock\";
\t\t#clock-cells = <0>;
\t\tclock-frequency = <0x16e3600>;
\t};

\tsoc {
\t\tcompatible = \"simple-bus\";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tuart0: serial@10000000 {
\t\t\tcompatible = \"ns16550a\";
\t\t\treg = <0x10000000 0x100>;
\t\t\tclocks = <&osc24m>;
\t\t};

\t\tserial@10001000 {
\t\t\tcompatible = \"ns16550a\";
\t\t\treg = <0x10001000 0x100>;
\t\t\tstatus = \"disabled\";
\t\t};
\t};

\tchosen {
\t\tstdout-path = &uart0;
\t};
};
";

#[test]
fn kernel_style_source_round_trips_textually() {
    let graph = import_dts(
        KERNEL_STYLE,
        Path::new("board.dts"),
        &ImportOptions::default(),
    )
    .unwrap();
    assert_eq!(to_dts(&graph).unwrap(), KERNEL_STYLE);
}

#[test]
fn import_arranges_nodes_without_overlap() {
    let graph = import_dts(
        KERNEL_STYLE,
        Path::new("board.dts"),
        &ImportOptions::default(),
    )
    .unwrap();
    // The canvas shows one node's children at a time, so siblings must not
    // share a place.
    for parent in &graph.nodes {
        let positions: Vec<_> = graph.children(&parent.id).map(|n| n.position).collect();
        for (i, a) in positions.iter().enumerate() {
            for b in &positions[i + 1..] {
                assert!((a.x, a.y) != (b.x, b.y), "two siblings share a position");
            }
        }
    }
    // The `soc` bus is its own scope, not a frame.
    assert!(graph.groups.is_empty());
}

#[test]
fn compatible_keeps_its_place_among_the_properties() {
    // As in decompiled vendor trees (#187).
    let source = "/dts-v1/;

/ {
\tmodel = \"Acme board\";
\tcompatible = \"acme,board\";
\t#address-cells = <1>;
\t#size-cells = <1>;

\tclock {
\t\t#clock-cells = <0>;
\t\tclock-frequency = <0x16e3600>;
\t\tcompatible = \"fixed-clock\";
\t};
};
";
    let mut graph = import_dts(source, Path::new("board.dts"), &ImportOptions::default()).unwrap();
    assert_eq!(to_dts(&graph).unwrap(), source);

    // A property removed before it does not push it out of range, and a
    // node that never had a place gets it first.
    let clock = graph.nodes.iter_mut().find(|n| n.name == "clock").unwrap();
    clock.properties.truncate(1);
    let root = graph.nodes.iter_mut().find(|n| n.name == "/").unwrap();
    root.compatible_at = None;
    let dts = to_dts(&graph).unwrap();
    assert!(
        dts.contains("/ {\n\tcompatible = \"acme,board\";\n\tmodel"),
        "{dts}"
    );
    assert!(
        dts.contains("\t\t#clock-cells = <0>;\n\t\tcompatible = \"fixed-clock\";"),
        "{dts}"
    );
}
