//! The address map of a design: the `reg` regions of every bus, translated
//! to CPU addresses through the `ranges` of the buses above them, with the
//! regions that overlap or fall outside their bus's windows.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{EdgeKind, Graph, Node, NodeId, PropertyValue};

/// One `reg` entry of a node.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Region {
    pub node: NodeId,
    /// Which entry of `reg` this is.
    pub index: usize,
    /// Address and size on the bus, as hex (`0x1c28000`).
    pub address: String,
    pub size: String,
    /// The CPU address range, as hex; `None` when the bus is not memory
    /// mapped (I2C, SPI) or the region is outside the bus's `ranges`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cpu_start: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cpu_end: Option<String>,
    /// Enabled nodes whose regions overlap this one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overlaps: Vec<NodeId>,
    /// The region is not (or not entirely) inside a window of the bus's
    /// `ranges`, so the CPU cannot reach (all of) it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub out_of_range: bool,
}

/// A node whose children have addresses, with their regions in address
/// order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Bus {
    pub node: NodeId,
    pub address_cells: u32,
    pub size_cells: u32,
    /// Bus addresses are CPU addresses after translation; false for buses
    /// without `ranges` (I2C, SPI, MDIO), whose addresses are local.
    pub memory_mapped: bool,
    pub regions: Vec<Region>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AddressProblem {
    pub node: NodeId,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AddressMap {
    pub buses: Vec<Bus>,
    /// Overlaps, regions outside their bus's windows and malformed `reg` or
    /// `ranges`.
    pub problems: Vec<AddressProblem>,
}

/// Where a bus address leads.
enum Translation {
    Cpu(u64),
    /// A bus on the way has no `ranges`: the address is local to it.
    NotMapped,
    /// Some `ranges` on the way does not cover it.
    OutOfRange,
}

struct Tree<'a> {
    graph: &'a Graph,
    parent: HashMap<&'a NodeId, &'a Node>,
}

impl<'a> Tree<'a> {
    fn new(graph: &'a Graph) -> Self {
        let parent = graph
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::Child)
            .filter_map(|e| Some((&e.to, graph.node(&e.from)?)))
            .collect();
        Tree { graph, parent }
    }

    /// `#address-cells` and `#size-cells` of a bus, with the defaults of the
    /// devicetree specification.
    fn cells(bus: &Node) -> (u32, u32) {
        let get = |name, default| match cells_of(bus, name) {
            Some([n, ..]) => *n,
            _ => default,
        };
        (get("#address-cells", 2), get("#size-cells", 1))
    }

    /// Translates `[address, address + size)` on `bus` to a CPU address. A
    /// malformed `ranges` is an error naming the node that has it.
    fn translate(
        &self,
        bus: &'a Node,
        address: u64,
        size: u64,
    ) -> Result<Translation, (NodeId, String)> {
        let mut bus = bus;
        let mut address = address;
        // Bounded, as child edges drawn on the canvas may form a cycle.
        for _ in 0..=self.parent.len() {
            let Some(parent) = self.parent.get(&bus.id) else {
                // A detached subtree has no CPU address.
                return Ok(if bus.is_root() {
                    Translation::Cpu(address)
                } else {
                    Translation::NotMapped
                });
            };
            let Some(ranges) = bus.properties.iter().find(|p| p.name == "ranges") else {
                return Ok(Translation::NotMapped);
            };
            let error = |message: String| Err((bus.id.clone(), message));
            match &ranges.value {
                // `ranges;` maps the bus one to one.
                PropertyValue::Empty => {}
                PropertyValue::Cells(cells) => {
                    let (child_cells, size_cells) = Self::cells(bus);
                    let (parent_cells, _) = Self::cells(parent);
                    if child_cells > 2 || parent_cells > 2 || size_cells > 2 {
                        // PCI-style addresses carry flags; not translated.
                        return Ok(Translation::NotMapped);
                    }
                    let Some(windows) = split(cells, &[child_cells, parent_cells, size_cells])
                    else {
                        return error(format!("ranges does not fit #address-cells/#size-cells ({child_cells}, {parent_cells}, {size_cells} cells per entry)"));
                    };
                    let window = windows
                        .iter()
                        .find(|w| address >= w[0] && address - w[0] < w[2]);
                    let Some(&[child, parent_address, window_size]) = window.map(Vec::as_slice)
                    else {
                        return Ok(Translation::OutOfRange);
                    };
                    let offset = address - child;
                    if size.max(1) > window_size - offset {
                        return Ok(Translation::OutOfRange);
                    }
                    address = offset + parent_address;
                }
                _ => return error("ranges is not a list of cells".into()),
            }
            bus = parent;
        }
        Ok(Translation::NotMapped)
    }

    /// `node` and its ancestors, nearest first; stops at a cycle.
    fn ancestry(&self, node: &'a NodeId) -> impl Iterator<Item = &'a NodeId> + '_ {
        let mut at = Some(node);
        std::iter::from_fn(move || {
            let current = at?;
            at = self.parent.get(current).map(|p| &p.id);
            Some(current)
        })
        .take(self.parent.len() + 1)
    }

    fn is_ancestor(&self, ancestor: &NodeId, node: &'a NodeId) -> bool {
        self.ancestry(node).skip(1).any(|a| a == ancestor)
    }

    fn is_disabled(&self, node: &'a NodeId) -> bool {
        self.ancestry(node)
            .filter_map(|id| self.graph.node(id))
            .any(|n| {
                n.properties.iter().any(|p| {
                    p.name == "status"
                        && matches!(&p.value, PropertyValue::Strings(s)
                        if s.first().is_some_and(|s| s != "okay" && s != "ok"))
                })
            })
    }

    fn in_reserved_memory(&self, node: &'a NodeId) -> bool {
        self.ancestry(node)
            .filter_map(|id| self.graph.node(id))
            .any(|n| n.name == "reserved-memory")
    }

    fn is_memory(&self, node: &NodeId) -> bool {
        self.graph.node(node).is_some_and(|n| {
            n.properties.iter().any(|p| {
                p.name == "device_type"
                    && matches!(&p.value, PropertyValue::Strings(s) if s.first().is_some_and(|s| s == "memory"))
            })
        })
    }
}

fn cells_of<'n>(node: &'n Node, name: &str) -> Option<&'n [u32]> {
    node.properties
        .iter()
        .find(|p| p.name == name)
        .and_then(|p| match &p.value {
            PropertyValue::Cells(cells) => Some(cells.as_slice()),
            _ => None,
        })
}

/// Splits a cell list into entries of numbers `widths` cells wide each;
/// `None` when it does not divide or a number is wider than 64 bits.
fn split(cells: &[u32], widths: &[u32]) -> Option<Vec<Vec<u64>>> {
    let per: u32 = widths.iter().sum();
    if per == 0 || widths.iter().any(|&w| w > 2) || cells.len() % per as usize != 0 {
        return None;
    }
    Some(
        cells
            .chunks(per as usize)
            .map(|entry| {
                let mut at = 0;
                widths
                    .iter()
                    .map(|&w| {
                        let n = entry[at..at + w as usize]
                            .iter()
                            .fold(0u64, |acc, &c| (acc << 32) | u64::from(c));
                        at += w as usize;
                        n
                    })
                    .collect()
            })
            .collect(),
    )
}

fn hex(n: u64) -> String {
    format!("{n:#x}")
}

/// Builds the address map of `graph`.
pub fn address_map(graph: &Graph) -> AddressMap {
    let tree = Tree::new(graph);
    let mut map = AddressMap::default();
    // CPU ranges of every enabled region, for the overlap check.
    let mut placed: Vec<(usize, usize, u64, u64)> = Vec::new();

    for bus in &graph.nodes {
        let children: Vec<&Node> = graph
            .children(&bus.id)
            .filter(|c| c.properties.iter().any(|p| p.name == "reg"))
            .collect();
        if children.is_empty() {
            continue;
        }
        let (address_cells, size_cells) = Tree::cells(bus);
        if address_cells > 2 || size_cells > 2 {
            // PCI and similar buses encode flags in the address.
            continue;
        }
        let mut regions = Vec::new();
        let mut memory_mapped = true;
        for child in children {
            let Some(reg) = cells_of(child, "reg") else {
                map.problems.push(AddressProblem {
                    node: child.id.clone(),
                    message: "reg is not a list of cells".into(),
                });
                continue;
            };
            let Some(entries) = split(reg, &[address_cells, size_cells]) else {
                map.problems.push(AddressProblem {
                    node: child.id.clone(),
                    message: format!(
                        "reg has {} cells, not a multiple of {address_cells} address and {size_cells} size cells",
                        reg.len()
                    ),
                });
                continue;
            };
            for (index, entry) in entries.iter().enumerate() {
                let address = entry[0];
                let size = entry.get(1).copied().unwrap_or(0);
                let mut region = Region {
                    node: child.id.clone(),
                    index,
                    address: hex(address),
                    size: hex(size),
                    cpu_start: None,
                    cpu_end: None,
                    overlaps: Vec::new(),
                    out_of_range: false,
                };
                match tree.translate(bus, address, size) {
                    Ok(Translation::Cpu(start)) => {
                        let end = start.saturating_add(size.max(1) - 1);
                        region.cpu_start = Some(hex(start));
                        region.cpu_end = Some(hex(end));
                        if size_cells > 0 && !tree.is_disabled(&child.id) {
                            placed.push((map.buses.len(), regions.len(), start, end));
                        }
                    }
                    Ok(Translation::NotMapped) => memory_mapped = false,
                    Ok(Translation::OutOfRange) => {
                        region.out_of_range = true;
                        map.problems.push(AddressProblem {
                            node: child.id.clone(),
                            message: format!(
                                "reg entry {index} ({} + {}) is outside the ranges of its bus",
                                hex(address),
                                hex(size)
                            ),
                        });
                    }
                    Err((node, message)) => {
                        let problem = AddressProblem { node, message };
                        if !map.problems.contains(&problem) {
                            map.problems.push(problem);
                        }
                    }
                }
                regions.push(region);
            }
        }
        // Without a size, as on I2C, only equal addresses clash.
        if !memory_mapped || size_cells == 0 {
            for i in 0..regions.len() {
                for j in i + 1..regions.len() {
                    let (a, b) = (&regions[i], &regions[j]);
                    let clash = if size_cells == 0 {
                        a.address == b.address
                    } else {
                        let range = |r: &Region| {
                            let start = u64::from_str_radix(&r.address[2..], 16).unwrap_or(0);
                            let size = u64::from_str_radix(&r.size[2..], 16).unwrap_or(0);
                            (start, start.saturating_add(size.max(1) - 1))
                        };
                        let ((s1, e1), (s2, e2)) = (range(a), range(b));
                        s1 <= e2 && s2 <= e1
                    };
                    let enabled = |r: &Region| !tree.is_disabled(&r.node);
                    if clash && a.node != b.node && enabled(a) && enabled(b) {
                        let (na, nb) = (a.node.clone(), b.node.clone());
                        if !regions[i].overlaps.contains(&nb) {
                            regions[i].overlaps.push(nb);
                        }
                        if !regions[j].overlaps.contains(&na) {
                            regions[j].overlaps.push(na);
                        }
                    }
                }
            }
        }
        map.buses.push(Bus {
            node: bus.id.clone(),
            address_cells,
            size_cells,
            memory_mapped,
            regions,
        });
    }

    // Overlaps in CPU address space, across buses too. A node's regions may
    // contain those of its own children (a syscon and its sub-devices), and
    // the registers of a bridge with `ranges` often span devices placed
    // elsewhere in the tree (i.MX AIPS), so bridges are left out.
    placed.retain(|&(b, r, ..)| {
        graph
            .node(&map.buses[b].regions[r].node)
            .is_some_and(|n| !n.properties.iter().any(|p| p.name == "ranges"))
    });
    placed.sort_by_key(|p| p.2);
    for i in 0..placed.len() {
        let (bi, ri, _, end) = placed[i];
        for &(bj, rj, start_j, _) in &placed[i + 1..] {
            if start_j > end {
                break;
            }
            let a = map.buses[bi].regions[ri].node.clone();
            let b = map.buses[bj].regions[rj].node.clone();
            if a == b
                || tree.is_ancestor(&a, &b)
                || tree.is_ancestor(&b, &a)
                // Reserved memory is carved out of `/memory` on purpose.
                || (tree.in_reserved_memory(&a) && tree.is_memory(&b))
                || (tree.in_reserved_memory(&b) && tree.is_memory(&a))
            {
                continue;
            }
            if !map.buses[bi].regions[ri].overlaps.contains(&b) {
                map.buses[bi].regions[ri].overlaps.push(b.clone());
            }
            if !map.buses[bj].regions[rj].overlaps.contains(&a) {
                map.buses[bj].regions[rj].overlaps.push(a);
            }
        }
    }

    for bus in &mut map.buses {
        for region in &bus.regions {
            for other in &region.overlaps {
                // One problem per pair, from the node that comes first.
                if region.node < *other {
                    map.problems.push(AddressProblem {
                        node: region.node.clone(),
                        message: format!(
                            "reg entry {} ({} + {}) overlaps {}",
                            region.index,
                            region.address,
                            region.size,
                            graph.node(other).map_or(other.0.clone(), Node::full_name)
                        ),
                    });
                }
            }
        }
        // On a memory-mapped bus, unreachable regions have no CPU address
        // and go last.
        let memory_mapped = bus.memory_mapped;
        bus.regions.sort_by_key(|r| {
            let key = r.cpu_start.as_deref().unwrap_or(&r.address);
            let n = u64::from_str_radix(&key[2..], 16).unwrap_or(0);
            (memory_mapped && r.cpu_start.is_none(), n)
        });
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::import_dts;
    use crate::preprocess::ImportOptions;

    fn map_of(dts: &str) -> AddressMap {
        let graph = import_dts(
            dts,
            std::path::Path::new("board.dts"),
            &ImportOptions::default(),
        )
        .expect("valid DTS");
        address_map(&graph)
    }

    const BOARD: &str = r#"/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;

	memory@40000000 { device_type = "memory"; reg = <0x40000000 0x40000000>; };

	soc {
		compatible = "simple-bus";
		#address-cells = <1>;
		#size-cells = <1>;
		ranges = <0x0 0x01000000 0x00100000>;

		uart@1000 { reg = <0x1000 0x400>; };
		timer@1400 { reg = <0x1400 0x100>; };
		spi@2000 { reg = <0x2000 0x400>; status = "disabled"; };
		gpio@2000 { reg = <0x2000 0x400>; };
		far@200000 { reg = <0x200000 0x100>; };
		edge@ff000 { reg = <0xff000 0x2000>; };

		i2c@3000 {
			reg = <0x3000 0x400>;
			#address-cells = <1>;
			#size-cells = <0>;
			eeprom@50 { reg = <0x50>; };
			rtc@50 { reg = <0x50>; };
			sensor@48 { reg = <0x48>; };
		};
	};
};
"#;

    fn region<'m>(map: &'m AddressMap, node: &str) -> &'m Region {
        map.buses
            .iter()
            .flat_map(|b| &b.regions)
            .find(|r| r.node.0.ends_with(node))
            .unwrap_or_else(|| panic!("no region for {node}"))
    }

    #[test]
    fn regions_are_translated_through_ranges() {
        let map = map_of(BOARD);
        let uart = region(&map, "uart@1000");
        assert_eq!(uart.cpu_start.as_deref(), Some("0x1001000"));
        assert_eq!(uart.cpu_end.as_deref(), Some("0x10013ff"));
        let memory = region(&map, "memory@40000000");
        assert_eq!(memory.cpu_start.as_deref(), Some("0x40000000"));
    }

    #[test]
    fn overlapping_regions_are_flagged_unless_disabled() {
        let map = map_of(BOARD);
        assert!(
            region(&map, "uart@1000").overlaps.is_empty(),
            "{:?}",
            region(&map, "uart@1000")
        );
        let gpio = region(&map, "gpio@2000");
        assert!(gpio.overlaps.is_empty(), "the overlapping spi is disabled");
        let eeprom = region(&map, "eeprom@50");
        assert_eq!(eeprom.overlaps.len(), 1);
        assert!(eeprom.overlaps[0].0.ends_with("rtc@50"));
        assert!(region(&map, "sensor@48").overlaps.is_empty());
        assert!(map
            .problems
            .iter()
            .any(|p| p.message.contains("overlaps rtc@50")));
    }

    #[test]
    fn regions_outside_the_ranges_are_flagged() {
        let map = map_of(BOARD);
        let far = region(&map, "far@200000");
        assert!(far.out_of_range);
        assert_eq!(far.cpu_start, None);
        // Starts inside the window but runs past its end.
        assert!(region(&map, "edge@ff000").out_of_range);
        assert!(!region(&map, "uart@1000").out_of_range);
    }

    #[test]
    fn buses_without_ranges_are_local() {
        let map = map_of(BOARD);
        let i2c = map
            .buses
            .iter()
            .find(|b| b.node.0.ends_with("i2c@3000"))
            .unwrap();
        assert!(!i2c.memory_mapped);
        assert_eq!(i2c.size_cells, 0);
        assert_eq!(i2c.regions[0].address, "0x48", "sorted by address");
        assert!(i2c.regions.iter().all(|r| r.cpu_start.is_none()));
    }

    #[test]
    fn a_node_may_contain_its_children() {
        let map = map_of(
            r#"/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	syscon@1000 {
		reg = <0x1000 0x1000>;
		#address-cells = <1>;
		#size-cells = <1>;
		ranges;
		phy@1100 { reg = <0x1100 0x10>; };
	};
};
"#,
        );
        assert!(map.problems.is_empty(), "{:?}", map.problems);
        assert_eq!(
            region(&map, "phy@1100").cpu_start.as_deref(),
            Some("0x1100")
        );
    }

    #[test]
    fn malformed_reg_is_reported() {
        let map = map_of(
            r#"/dts-v1/;
/ {
	#address-cells = <2>;
	#size-cells = <2>;
	dev@0 { reg = <0 0x1000 0x100>; };
};
"#,
        );
        assert!(map.problems[0].message.contains("not a multiple"));
    }

    #[test]
    fn a_region_larger_than_its_window_is_out_of_range() {
        let map = map_of(
            r#"/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	soc {
		#address-cells = <1>;
		#size-cells = <1>;
		ranges = <0x0 0x1000000 0x1000>;
		dev@0 { reg = <0x0 0x2000>; };
	};
};
"#,
        );
        assert!(region(&map, "dev@0").out_of_range);
    }

    #[test]
    fn controllers_with_addressed_children_are_checked() {
        let map = map_of(
            r#"/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	i2c@1000 {
		reg = <0x1000 0x100>;
		#address-cells = <1>;
		#size-cells = <0>;
		eeprom@50 { reg = <0x50>; };
	};
	i2c@1080 {
		reg = <0x1080 0x100>;
		#address-cells = <1>;
		#size-cells = <0>;
		rtc@51 { reg = <0x51>; };
	};
};
"#,
        );
        assert_eq!(region(&map, "i2c@1000").overlaps.len(), 1);
    }

    #[test]
    fn a_malformed_ranges_is_reported_once_on_its_node() {
        let map = map_of(
            r#"/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	soc {
		#address-cells = <1>;
		#size-cells = <1>;
		ranges = <0x0 0x1000>;
		bus {
			#address-cells = <1>;
			#size-cells = <1>;
			ranges;
			a@0 { reg = <0x0 0x10>; };
			b@10 { reg = <0x10 0x10>; };
		};
	};
};
"#,
        );
        assert_eq!(map.problems.len(), 1, "{:?}", map.problems);
        assert!(map.problems[0].node.0.ends_with("soc"));
        let bus = map
            .buses
            .iter()
            .find(|b| b.node.0.ends_with("bus"))
            .unwrap();
        assert_eq!(bus.regions.len(), 2);
    }

    #[test]
    fn reserved_memory_may_only_overlap_memory() {
        let map = map_of(
            r#"/dts-v1/;
/ {
	#address-cells = <1>;
	#size-cells = <1>;
	memory@0 { device_type = "memory"; reg = <0x0 0x10000>; };
	reserved-memory {
		#address-cells = <1>;
		#size-cells = <1>;
		ranges;
		buf@1000 { reg = <0x1000 0x1000>; };
	};
	uart@1000 { reg = <0x1000 0x100>; };
};
"#,
        );
        let buf = region(&map, "buf@1000");
        assert_eq!(buf.overlaps.len(), 1, "{:?}", buf.overlaps);
        assert!(buf.overlaps[0].0.ends_with("uart@1000"));
    }

    #[test]
    fn a_cycle_of_child_edges_terminates() {
        let mut graph = import_dts(
            BOARD,
            std::path::Path::new("board.dts"),
            &ImportOptions::default(),
        )
        .unwrap();
        let id = |name: &str| {
            graph
                .nodes
                .iter()
                .find(|n| n.full_name() == name)
                .unwrap()
                .id
                .clone()
        };
        let (soc, i2c) = (id("soc"), id("i2c@3000"));
        graph.edges.push(crate::model::Edge {
            from: i2c,
            to: soc,
            kind: EdgeKind::Child,
        });
        address_map(&graph);
    }
}
