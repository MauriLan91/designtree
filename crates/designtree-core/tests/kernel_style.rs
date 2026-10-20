//! A file already in kernel style survives import and export unchanged:
//! same node and property order, tabs, blank lines between nodes.

use designtree_core::{import_dts, to_dts};

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
    let graph = import_dts(KERNEL_STYLE, "board.dts").unwrap();
    assert_eq!(to_dts(&graph).unwrap(), KERNEL_STYLE);
}

#[test]
fn import_arranges_nodes_without_overlap() {
    let graph = import_dts(KERNEL_STYLE, "board.dts").unwrap();
    let positions: Vec<_> = graph.nodes.iter().map(|n| n.position).collect();
    for (i, a) in positions.iter().enumerate() {
        for b in &positions[i + 1..] {
            assert!((a.x, a.y) != (b.x, b.y), "two nodes share a position");
        }
    }
    // The `soc` bus is framed.
    assert!(graph.groups.iter().any(|g| g.id == "bus:/soc"));
}
