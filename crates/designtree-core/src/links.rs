//! Connections between devices, for the board view (US-14.2): which
//! controller drives which peripheral.
//!
//! A link joins two nodes of the tree. The board view draws it between the
//! devices placed on the board that hold them, so a link from a GPIO bank
//! under an unplaced pin controller is drawn from the SoC when only the SoC
//! is placed.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::interrupts::interrupt_tree;
use crate::model::{EdgeKind, Graph, Node, NodeId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum LinkKind {
    /// A device on an I²C bus, from its controller (or mux channel).
    I2c,
    /// A device on an SPI bus, from its controller.
    Spi,
    /// Any other parent and child, such as a device on a `simple-bus`.
    Bus,
    /// A GPIO line used through a `*-gpios` property.
    Gpio,
    /// An interrupt, from the controller to the device that raises it,
    /// found the way the kernel does (`interrupt-parent` or the tree).
    Interrupt,
    /// Any other phandle reference: clocks, resets, DMA, `pinctrl-0`...
    Reference,
}

/// One connection: `from` drives `to`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct BoardLink {
    /// The controller or provider.
    pub from: NodeId,
    /// The peripheral or consumer.
    pub to: NodeId,
    pub kind: LinkKind,
    /// What makes the link: the properties (`reset-gpios`), or for a
    /// device on a bus its unit address (`@1a`).
    pub via: Vec<String>,
}

/// The links of `graph`, one per pair of nodes and kind, in design order.
pub fn board_links(graph: &Graph) -> Vec<BoardLink> {
    let nodes: HashMap<&NodeId, &Node> = graph.nodes.iter().map(|n| (&n.id, n)).collect();
    let mut links: Vec<BoardLink> = Vec::new();
    let mut index: HashMap<(NodeId, NodeId, LinkKind), usize> = HashMap::new();
    let mut add = |from: &NodeId, to: &NodeId, kind: LinkKind, via: String| {
        if from == to {
            return;
        }
        let key = (from.clone(), to.clone(), kind);
        let at = *index.entry(key).or_insert_with(|| {
            links.push(BoardLink {
                from: from.clone(),
                to: to.clone(),
                kind,
                via: Vec::new(),
            });
            links.len() - 1
        });
        if !via.is_empty() && !links[at].via.contains(&via) {
            links[at].via.push(via);
        }
    };

    for edge in &graph.edges {
        match &edge.kind {
            EdgeKind::Child => {
                let (Some(parent), Some(child)) = (nodes.get(&edge.from), nodes.get(&edge.to))
                else {
                    continue;
                };
                let via = child
                    .unit_address
                    .as_ref()
                    .map(|a| format!("@{a}"))
                    .unwrap_or_default();
                add(&edge.from, &edge.to, bus_kind(parent), via);
            }
            EdgeKind::Reference { property, .. } => {
                // The interrupt tree below resolves these, inherited ones too.
                if property == "interrupt-parent" || property == "interrupts-extended" {
                    continue;
                }
                let kind = if is_gpio_property(property) {
                    LinkKind::Gpio
                } else {
                    LinkKind::Reference
                };
                // References point from consumer to provider; links go the
                // other way, from what drives to what is driven.
                add(&edge.to, &edge.from, kind, property.clone());
            }
        }
    }

    let tree = interrupt_tree(graph);
    for controller in &tree.controllers {
        if let Some(parent) = &controller.parent {
            add(parent, &controller.node, LinkKind::Interrupt, String::new());
        }
        for device in &controller.devices {
            add(&controller.node, device, LinkKind::Interrupt, String::new());
        }
    }
    links
}

/// The bus a node's children sit on, from the node names the bindings
/// require (`i2c@...`, `spi@...`), else from the controller's compatible.
fn bus_kind(node: &Node) -> LinkKind {
    let numbered = |prefix: &str| {
        node.name == prefix
            || node.name.strip_prefix(prefix).is_some_and(|rest| {
                rest.strip_prefix('-')
                    .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            })
    };
    let compatible = |word: &str| node.compatible.iter().any(|c| c.contains(word));
    if numbered("i2c") || node.name == "i2c-bus" || compatible("i2c") {
        LinkKind::I2c
    } else if numbered("spi") || compatible("spi") {
        LinkKind::Spi
    } else {
        LinkKind::Bus
    }
}

/// `gpios`, `reset-gpios`, and the deprecated `gpio` and `*-gpio`.
fn is_gpio_property(name: &str) -> bool {
    name == "gpios" || name == "gpio" || name.ends_with("-gpios") || name.ends_with("-gpio")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::import_dts;
    use crate::preprocess::ImportOptions;

    fn links(dts: &str) -> Vec<(String, String, LinkKind, Vec<String>)> {
        let graph = import_dts(
            dts,
            std::path::Path::new("board.dts"),
            &ImportOptions::default(),
        )
        .unwrap();
        let name = |id: &NodeId| graph.node(id).unwrap().full_name();
        board_links(&graph)
            .into_iter()
            .map(|l| (name(&l.from), name(&l.to), l.kind, l.via))
            .collect()
    }

    fn has(
        links: &[(String, String, LinkKind, Vec<String>)],
        from: &str,
        to: &str,
        kind: LinkKind,
    ) -> bool {
        links
            .iter()
            .any(|(f, t, k, _)| f == from && t == to && *k == kind)
    }

    const DTS: &str = "/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	interrupt-parent = <&gic>;
	soc {
		compatible = \"simple-bus\";
		#address-cells = <1>;
		#size-cells = <1>;
		gic: interrupt-controller@100 {
			reg = <0x100 0x100>;
			interrupt-controller;
			#interrupt-cells = <3>;
		};
		gpio1: gpio@1000 {
			reg = <0x1000 0x100>;
			gpio-controller;
			#gpio-cells = <2>;
			interrupt-controller;
			#interrupt-cells = <2>;
			interrupts = <0 10 4>;
		};
		clk: clock-controller@2000 {
			reg = <0x2000 0x100>;
			#clock-cells = <1>;
		};
		i2c@3000 {
			compatible = \"vendor,soc-i2c\";
			reg = <0x3000 0x100>;
			#address-cells = <1>;
			#size-cells = <0>;
			clocks = <&clk 3>;
			interrupts = <0 11 4>;
			codec@1a {
				reg = <0x1a>;
				reset-gpios = <&gpio1 3 0>;
				enable-gpios = <&gpio1 4 0>;
				interrupt-parent = <&gpio1>;
				interrupts = <5 8>;
			};
		};
		bus@4000 {
			compatible = \"vendor,spi-controller\";
			reg = <0x4000 0x100>;
			#address-cells = <1>;
			#size-cells = <0>;
			flash@0 { reg = <0>; };
		};
	};
};
";

    #[test]
    fn buses_from_the_node_name_or_the_compatible() {
        let links = links(DTS);
        assert!(has(&links, "i2c@3000", "codec@1a", LinkKind::I2c));
        assert!(has(&links, "bus@4000", "flash@0", LinkKind::Spi));
        assert!(has(&links, "soc", "i2c@3000", LinkKind::Bus));
        let codec = links
            .iter()
            .find(|(f, t, _, _)| f == "i2c@3000" && t == "codec@1a")
            .unwrap();
        assert_eq!(codec.3, ["@1a"]);
    }

    #[test]
    fn references_go_from_provider_to_consumer() {
        let links = links(DTS);
        let gpio: Vec<_> = links
            .iter()
            .filter(|(_, _, k, _)| *k == LinkKind::Gpio)
            .collect();
        // Two GPIO lines between the same pair are one link.
        assert_eq!(gpio.len(), 1);
        assert_eq!(
            (gpio[0].0.as_str(), gpio[0].1.as_str()),
            ("gpio@1000", "codec@1a")
        );
        assert_eq!(gpio[0].3, ["reset-gpios", "enable-gpios"]);
        assert!(has(
            &links,
            "clock-controller@2000",
            "i2c@3000",
            LinkKind::Reference
        ));
    }

    #[test]
    fn interrupts_follow_the_interrupt_parent() {
        let links = links(DTS);
        // Inherited from the root.
        assert!(has(
            &links,
            "interrupt-controller@100",
            "i2c@3000",
            LinkKind::Interrupt
        ));
        // Set on the device, and a cascaded controller.
        assert!(has(&links, "gpio@1000", "codec@1a", LinkKind::Interrupt));
        assert!(has(
            &links,
            "interrupt-controller@100",
            "gpio@1000",
            LinkKind::Interrupt
        ));
        assert!(!links.iter().any(|(_, _, k, via)| *k == LinkKind::Reference
            && via.iter().any(|p| p == "interrupt-parent")));
    }
}
