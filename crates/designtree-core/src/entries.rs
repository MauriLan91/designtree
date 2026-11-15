//! How many cells one entry of a cell-list property takes, from the
//! devicetree around the node (US-17.4): `reg` and `ranges` from the
//! `#address-cells`/`#size-cells` above and in the node, `interrupts` from
//! the interrupt parent's `#interrupt-cells`. The DTS writer groups such a
//! list into one `<…>` per entry, as the kernel writes them; the compiled
//! value is the same either way.

use crate::interrupts::{cells_of, interrupt_parent, tree_parent};
use crate::model::{Graph, Node};

/// The cells per entry of `property` of `node`, when the devicetree fixes
/// it; `None` for any other property or when it is not known.
pub fn entry_cells(graph: &Graph, node: &Node, property: &str) -> Option<usize> {
    // The defaults dtc and the specification assume when a bus does not say.
    let address = |n: &Node| one_cell(n, "#address-cells").unwrap_or(2);
    let size = |n: &Node| one_cell(n, "#size-cells").unwrap_or(1);
    let width = match property {
        "reg" => {
            let parent = tree_parent(graph, node)?;
            address(parent) + size(parent)
        }
        "ranges" | "dma-ranges" => {
            let parent = tree_parent(graph, node)?;
            address(node) + address(parent) + size(node)
        }
        "interrupts" => one_cell(interrupt_parent(graph, node)?, "#interrupt-cells")?,
        _ => return None,
    };
    (width > 0).then_some(width)
}

fn one_cell(node: &Node, name: &str) -> Option<usize> {
    match cells_of(node, name)?.as_slice() {
        [n] => usize::try_from(*n).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::import_dts;
    use crate::preprocess::ImportOptions;
    use std::path::Path;

    fn graph(src: &str) -> Graph {
        import_dts(src, Path::new("t.dts"), &ImportOptions::default()).unwrap()
    }

    #[test]
    fn widths_follow_the_cells_properties() {
        let g = graph(
            "/dts-v1/;\n/ {\n\t#address-cells = <1>;\n\t#size-cells = <1>;\n\
             \tgic: intc { #interrupt-cells = <3>; interrupt-controller; };\n\
             \tsoc { #address-cells = <2>; #size-cells = <2>; ranges = <0 0 0x1000 0 0x1000>;\n\
             \t\tuart@0 { reg = <0 0 0 0x400>; interrupts = <0 1 4>; interrupt-parent = <&gic>; };\n\t};\n};\n",
        );
        let node = |path: &str| g.nodes.iter().find(|n| n.id.0 == path).unwrap();
        assert_eq!(entry_cells(&g, node("/soc/uart@0"), "reg"), Some(4));
        assert_eq!(entry_cells(&g, node("/soc/uart@0"), "interrupts"), Some(3));
        assert_eq!(entry_cells(&g, node("/soc"), "ranges"), Some(5));
        assert_eq!(entry_cells(&g, node("/soc/uart@0"), "clocks"), None);
    }

    #[test]
    fn entries_export_as_groups_and_round_trip() {
        let src = "/dts-v1/;\n\n/ {\n\t#address-cells = <1>;\n\t#size-cells = <1>;\n\n\
                   \tfoo@1c81000 {\n\t\treg = <0x1c81000 0x1000>, <0x1c82000 0x2000>;\n\t};\n};\n";
        let dts = crate::dts::to_dts(&graph(src)).unwrap();
        assert!(
            dts.contains("reg = <0x1c81000 0x1000>, <0x1c82000 0x2000>;"),
            "{dts}"
        );
        assert_eq!(crate::dts::to_dts(&graph(&dts)).unwrap(), dts);
        // Not a whole number of entries: left in one group.
        let odd = src.replace("<0x1c82000 0x2000>", "<0x1c82000>");
        assert!(crate::dts::to_dts(&graph(&odd))
            .unwrap()
            .contains("reg = <0x1c81000 0x1000 0x1c82000>;"));
    }
}
