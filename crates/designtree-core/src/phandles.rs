//! References of a decompiled devicetree (US-1.6).
//!
//! `dtc -I dtb -O dts` writes every phandle as a number (`clocks = <0x2f
//! 0x01>;`) and gives each referenced node a `phandle` property. Import
//! turns those numbers back into references wherever the property is known
//! to hold phandles, splitting phandle lists by the provider's `#*-cells`
//! as dt-schema does. Labels come from `__symbols__`, or are made up from
//! the node name; `__symbols__`, `__fixups__` and `__local_fixups__` are
//! dropped, since building with `dtc -@` writes them again. `phandle`
//! properties are dropped too, unless dtc would number the node otherwise,
//! so that the rebuilt blob equals the original one.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::Arc;

use crate::fdt;
use crate::model::{
    Cell, Edge, EdgeKind, Graph, Node, NodeId, Property, PropertyValue, ValueChunk,
};

/// What a binding schema says a property holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhandleType {
    /// One phandle (`phy-handle = <&phy0>;`).
    Phandle,
    /// Phandles, each followed by specifier cells. `entry` is the fixed
    /// size of an entry, phandle included, when the schema gives one;
    /// otherwise the provider's `#*-cells` tells.
    PhandleArray { entry: Option<usize> },
}

type Lookup = dyn Fn(&str) -> Option<PhandleType> + Send + Sync;

/// The phandle properties of the binding schemas, by property name, as
/// dt-schema types them. Without schemas, only the properties every
/// devicetree uses alike are known.
#[derive(Clone, Default)]
pub struct PhandleTypes(Option<Arc<Lookup>>);

impl PhandleTypes {
    pub fn new(lookup: impl Fn(&str) -> Option<PhandleType> + Send + Sync + 'static) -> Self {
        PhandleTypes(Some(Arc::new(lookup)))
    }

    fn get(&self, name: &str) -> Option<PhandleType> {
        self.0.as_ref().and_then(|lookup| lookup(name))
    }
}

impl fmt::Debug for PhandleTypes {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self.0 {
            Some(_) => "PhandleTypes(schemas)",
            None => "PhandleTypes(built-in)",
        })
    }
}

impl PartialEq for PhandleTypes {
    fn eq(&self, other: &Self) -> bool {
        match (&self.0, &other.0) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        }
    }
}

impl Eq for PhandleTypes {}

/// How many specifier cells follow each phandle of a list.
#[derive(Debug, Clone, PartialEq)]
enum Args {
    /// The provider's `#*-cells` property, 0 when it has none.
    Named(String),
    Fixed(usize),
    /// One entry: everything after the phandle.
    Rest,
}

#[derive(Debug, Clone, PartialEq)]
enum Spec {
    Phandle,
    /// `holes`: a 0 stands for "no provider" (`<&gpio 1 0>, <0>, ...`).
    List {
        args: Args,
        holes: bool,
    },
    InterruptMap,
}

/// Properties that hold phandles in every devicetree, after dtc's and
/// dt-schema's own lists.
fn built_in(name: &str) -> Option<Spec> {
    let named = |cells: &str| {
        Some(Spec::List {
            args: Args::Named(cells.to_owned()),
            holes: false,
        })
    };
    let plain = || {
        Some(Spec::List {
            args: Args::Fixed(0),
            holes: false,
        })
    };
    match name {
        "interrupt-parent"
        | "next-level-cache"
        | "phy-handle"
        | "remote-endpoint"
        | "operating-points-v2"
        | "cpu" => Some(Spec::Phandle),
        "memory-region" | "nvmem-cells" | "cpu-idle-states" | "sram" => plain(),
        "interrupt-map" => Some(Spec::InterruptMap),
        "clocks" => named("#clock-cells"),
        "assigned-clocks" | "assigned-clock-parents" => Some(Spec::List {
            args: Args::Named("#clock-cells".into()),
            holes: true,
        }),
        "cooling-device" => named("#cooling-cells"),
        "dmas" => named("#dma-cells"),
        "hwlocks" => named("#hwlock-cells"),
        "interrupts-extended" => named("#interrupt-cells"),
        "interconnects" => named("#interconnect-cells"),
        "io-channels" => named("#io-channel-cells"),
        "iommus" => named("#iommu-cells"),
        "mboxes" => named("#mbox-cells"),
        "msi-parent" => named("#msi-cells"),
        "mux-controls" => named("#mux-control-cells"),
        "phys" => named("#phy-cells"),
        "power-domains" => named("#power-domain-cells"),
        "pwms" => named("#pwm-cells"),
        "resets" => named("#reset-cells"),
        "sound-dai" => named("#sound-dai-cells"),
        "thermal-sensors" => named("#thermal-sensor-cells"),
        _ if name.ends_with("-supply") => Some(Spec::Phandle),
        _ if is_pinctrl_state(name) => plain(),
        _ if is_gpio(name) => Some(Spec::List {
            args: Args::Named("#gpio-cells".into()),
            holes: true,
        }),
        _ => None,
    }
}

fn is_pinctrl_state(name: &str) -> bool {
    name.strip_prefix("pinctrl-")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// `gpios`, `reset-gpios` and the deprecated `gpio`, `*-gpio`; not the
/// `nr-gpios` count.
fn is_gpio(name: &str) -> bool {
    (name == "gpios" || name == "gpio" || name.ends_with("-gpios") || name.ends_with("-gpio"))
        && !name.ends_with("nr-gpios")
}

/// What a schema type means for the cells of `name`, following dt-schema's
/// `fixup_phandles`: a fixed entry size, a provider property named after
/// the property (`foos` and `#foo-cells`), or one entry.
fn from_schema(name: &str, ty: PhandleType) -> Spec {
    match ty {
        PhandleType::Phandle => Spec::Phandle,
        PhandleType::PhandleArray { entry: Some(n) } => Spec::List {
            args: Args::Fixed(n.saturating_sub(1)),
            holes: false,
        },
        PhandleType::PhandleArray { entry: None } => {
            let args = match name.strip_suffix('s') {
                Some(base) => Args::Named(format!("#{base}-cells")),
                None => Args::Rest,
            };
            Spec::List { args, holes: false }
        }
    }
}

/// One entry of a phandle list.
enum Entry {
    Reference(NodeId, Vec<u32>),
    /// A 0 in place of a phandle.
    Hole,
}

/// A property value that names nodes by phandle.
enum Restored {
    /// Becomes reference edges.
    Entries(Vec<Entry>),
    /// Stays a value, with references in its cells, one `<...>` per row.
    Rows(Vec<Vec<RowCell>>),
}

enum RowCell {
    Number(u32),
    Reference(NodeId),
}

/// The tree being restored, indexed.
struct Index<'a> {
    graph: &'a Graph,
    /// Node of each phandle.
    by_phandle: HashMap<u32, usize>,
}

impl Index<'_> {
    fn cells(&self, node: usize, name: &str) -> Option<u32> {
        single_cell(&self.graph.nodes[node], name)
    }

    fn provider(&self, phandle: u32) -> Option<usize> {
        self.by_phandle.get(&phandle).copied()
    }

    fn list(&self, cells: &[u32], args: &Args, holes: bool) -> Option<Vec<Entry>> {
        let mut entries = Vec::new();
        let mut at = 0;
        while at < cells.len() {
            let phandle = cells[at];
            if phandle == 0 && holes {
                entries.push(Entry::Hole);
                at += 1;
                continue;
            }
            let provider = self.provider(phandle)?;
            let n = match args {
                Args::Named(name) => self.cells(provider, name).unwrap_or(0) as usize,
                Args::Fixed(n) => *n,
                Args::Rest => cells.len() - at - 1,
            };
            let end = at + 1 + n;
            if end > cells.len() {
                return None;
            }
            let id = self.graph.nodes[provider].id.clone();
            entries.push(Entry::Reference(id, cells[at + 1..end].to_vec()));
            at = end;
        }
        (!entries.is_empty()).then_some(entries)
    }

    /// Rows of child address, child interrupt, parent phandle, parent
    /// address and parent interrupt, each sized by its node.
    fn interrupt_map(&self, node: usize, cells: &[u32]) -> Option<Vec<Vec<RowCell>>> {
        let child = self.cells(node, "#address-cells").unwrap_or(0) as usize
            + self.cells(node, "#interrupt-cells").unwrap_or(0) as usize;
        let mut rows = Vec::new();
        let mut at = 0;
        while at < cells.len() {
            let phandle = *cells.get(at + child)?;
            let parent = self.provider(phandle)?;
            let parent_cells = self.cells(parent, "#address-cells").unwrap_or(0) as usize
                + self.cells(parent, "#interrupt-cells")? as usize;
            let end = at + child + 1 + parent_cells;
            if end > cells.len() {
                return None;
            }
            let mut row: Vec<RowCell> = cells[at..at + child]
                .iter()
                .map(|&c| RowCell::Number(c))
                .collect();
            row.push(RowCell::Reference(self.graph.nodes[parent].id.clone()));
            row.extend(
                cells[at + child + 1..end]
                    .iter()
                    .map(|&c| RowCell::Number(c)),
            );
            rows.push(row);
            at = end;
        }
        (!rows.is_empty()).then_some(rows)
    }

    fn restore(&self, node: usize, property: &Property, types: &PhandleTypes) -> Option<Restored> {
        let PropertyValue::Cells(cells) = &property.value else {
            return None;
        };
        let name = property.name.as_str();
        let spec = built_in(name).or_else(|| types.get(name).map(|ty| from_schema(name, ty)))?;
        // A hog's `gpios` are line numbers on its own controller.
        if is_gpio(name)
            && self.graph.nodes[node]
                .properties
                .iter()
                .any(|p| p.name == "gpio-hog")
        {
            return None;
        }
        match spec {
            Spec::Phandle => match cells.as_slice() {
                [phandle] => self.provider(*phandle).map(|p| {
                    Restored::Entries(vec![Entry::Reference(
                        self.graph.nodes[p].id.clone(),
                        Vec::new(),
                    )])
                }),
                _ => None,
            },
            Spec::List { args, holes } => self.list(cells, &args, holes).map(Restored::Entries),
            Spec::InterruptMap => self.interrupt_map(node, cells).map(Restored::Rows),
        }
    }
}

fn single_cell(node: &Node, name: &str) -> Option<u32> {
    node.properties
        .iter()
        .find(|p| p.name == name)
        .and_then(|p| match &p.value {
            PropertyValue::Cells(cells) if cells.len() == 1 => Some(cells[0]),
            _ => None,
        })
}

/// The nodes `dtc` writes for overlays and that `dtc -@` writes again.
const GENERATED: [&str; 3] = ["/__symbols__", "/__fixups__", "/__local_fixups__"];

/// Restores the references of a decompiled tree: a tree whose nodes carry
/// `phandle` properties. Returns false, changing nothing, for any other.
pub fn restore_references(graph: &mut Graph, types: &PhandleTypes) -> bool {
    let original: HashMap<NodeId, u32> = graph
        .nodes
        .iter()
        .filter_map(|n| {
            let phandle = single_cell(n, "phandle").or_else(|| single_cell(n, "linux,phandle"))?;
            (phandle != 0 && phandle != u32::MAX).then(|| (n.id.clone(), phandle))
        })
        .collect();
    if original.is_empty() {
        return false;
    }
    // Export follows the order properties are in now.
    let lists = reference_lists(&graph.edges);
    let before: HashMap<NodeId, Vec<String>> = graph
        .nodes
        .iter()
        .map(|n| {
            let names = default_names(n, &lists).into_iter().map(|n| (n, ()));
            let ordered = n.in_order(names.collect()).into_iter().map(|(n, ())| n);
            (n.id.clone(), ordered.collect())
        })
        .collect();

    labels_from_symbols(graph);
    remove_generated(graph);

    let restored: Vec<(usize, usize, Restored)> = {
        let index = Index {
            graph,
            by_phandle: graph
                .nodes
                .iter()
                .enumerate()
                .filter_map(|(i, n)| Some((*original.get(&n.id)?, i)))
                .collect(),
        };
        graph
            .nodes
            .iter()
            .enumerate()
            .flat_map(|(n, node)| {
                let index = &index;
                node.properties
                    .iter()
                    .enumerate()
                    .filter_map(move |(p, property)| {
                        Some((n, p, index.restore(n, property, types)?))
                    })
            })
            .collect()
    };

    let targets: HashSet<NodeId> = restored
        .iter()
        .flat_map(|(_, _, r)| -> Vec<NodeId> {
            match r {
                Restored::Entries(entries) => entries
                    .iter()
                    .filter_map(|e| match e {
                        Entry::Reference(id, _) => Some(id.clone()),
                        Entry::Hole => None,
                    })
                    .collect(),
                Restored::Rows(rows) => rows
                    .iter()
                    .flatten()
                    .filter_map(|c| match c {
                        RowCell::Reference(id) => Some(id.clone()),
                        RowCell::Number(_) => None,
                    })
                    .collect(),
            }
        })
        .collect();
    make_labels(graph, &targets);
    let label_of: HashMap<NodeId, String> = graph
        .nodes
        .iter()
        .filter_map(|n| Some((n.id.clone(), n.label.clone()?)))
        .collect();

    // Back to front, so that property positions stay valid.
    let mut edges: Vec<Vec<Edge>> = vec![Vec::new(); graph.nodes.len()];
    for (n, p, restored) in restored.into_iter().rev() {
        let node = &mut graph.nodes[n];
        match restored {
            Restored::Entries(entries)
                if entries.iter().all(|e| matches!(e, Entry::Reference(..))) =>
            {
                let property = node.properties.remove(p);
                let list = entries.into_iter().filter_map(|e| match e {
                    Entry::Reference(to, args) => Some(Edge {
                        from: node.id.clone(),
                        to,
                        kind: EdgeKind::Reference {
                            property: property.name.clone(),
                            args,
                        },
                        route: None,
                    }),
                    Entry::Hole => None,
                });
                edges[n].splice(0..0, list);
            }
            Restored::Entries(entries) => {
                let cells = entries
                    .into_iter()
                    .flat_map(|e| match e {
                        Entry::Reference(to, args) => std::iter::once(Cell::Phandle {
                            phandle: label_of[&to].clone(),
                        })
                        .chain(args.into_iter().map(|a| Cell::Number(a.into())))
                        .collect::<Vec<_>>(),
                        Entry::Hole => vec![Cell::Number(0)],
                    })
                    .collect();
                node.properties[p].value =
                    PropertyValue::Mixed(vec![ValueChunk::Cells { bits: 32, cells }]);
            }
            Restored::Rows(rows) => {
                let chunks = rows
                    .into_iter()
                    .map(|row| ValueChunk::Cells {
                        bits: 32,
                        cells: row
                            .into_iter()
                            .map(|c| match c {
                                RowCell::Number(n) => Cell::Number(n.into()),
                                RowCell::Reference(to) => Cell::Phandle {
                                    phandle: label_of[&to].clone(),
                                },
                            })
                            .collect(),
                    })
                    .collect();
                node.properties[p].value = PropertyValue::Mixed(chunks);
            }
        }
    }
    graph.edges.extend(edges.into_iter().flatten());

    for node in &mut graph.nodes {
        if let Some(names) = before.get(&node.id) {
            node.order.clone_from(names);
        }
    }
    keep_phandles(graph, &original);

    // Keep the order only where export would not write it anyway.
    let lists = reference_lists(&graph.edges);
    for node in &mut graph.nodes {
        let names = std::mem::take(&mut node.order);
        let default = default_names(node, &lists);
        let present: HashSet<&String> = default.iter().collect();
        let order: Vec<String> = names
            .iter()
            .filter(|n| present.contains(n))
            .cloned()
            .collect();
        if order != default {
            node.order = order;
        }
    }
    true
}

/// The phandle lists each node writes, from its reference edges.
fn reference_lists(edges: &[Edge]) -> HashMap<NodeId, Vec<String>> {
    let mut lists: HashMap<NodeId, Vec<String>> = HashMap::new();
    for edge in edges {
        if let EdgeKind::Reference { property, .. } = &edge.kind {
            let list = lists.entry(edge.from.clone()).or_default();
            if !list.contains(property) {
                list.push(property.clone());
            }
        }
    }
    lists
}

/// Names of the properties of `node` in the order export writes them
/// before [`Node::order`] applies: properties with `compatible` in its
/// place, then phandle lists, then a kept phandle.
fn default_names(node: &Node, lists: &HashMap<NodeId, Vec<String>>) -> Vec<String> {
    let mut names: Vec<String> = node.properties.iter().map(|p| p.name.clone()).collect();
    if !node.compatible.is_empty() {
        names.insert(node.compatible_index(), "compatible".into());
    }
    names.extend(lists.get(&node.id).into_iter().flatten().cloned());
    if node.phandle.is_some() {
        names.push("phandle".into());
    }
    names
}

/// Labels `__symbols__` gives nodes that do not carry them yet.
fn labels_from_symbols(graph: &mut Graph) {
    let Some(symbols) = graph.nodes.iter().find(|n| n.id.0 == GENERATED[0]) else {
        return;
    };
    let symbols: Vec<(String, String)> = symbols
        .properties
        .iter()
        .filter_map(|p| match &p.value {
            PropertyValue::Strings(path) if path.len() == 1 && is_label(&p.name) => {
                Some((p.name.clone(), path[0].clone()))
            }
            _ => None,
        })
        .collect();
    let mut taken: HashSet<String> = graph
        .nodes
        .iter()
        .flat_map(|n| n.labels().cloned())
        .collect();
    for (label, path) in symbols {
        if taken.contains(&label) {
            continue;
        }
        if let Some(node) = graph.nodes.iter_mut().find(|n| n.id.0 == path) {
            match node.label {
                None => node.label = Some(label.clone()),
                Some(_) => node.extra_labels.push(label.clone()),
            }
            taken.insert(label);
        }
    }
}

fn is_label(name: &str) -> bool {
    let mut chars = name.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Drops `__symbols__`, `__fixups__` and `__local_fixups__` with their
/// subtrees.
fn remove_generated(graph: &mut Graph) {
    let gone = |id: &NodeId| {
        GENERATED.iter().any(|g| {
            id.0 == *g
                || id
                    .0
                    .strip_prefix(g)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
    };
    graph.nodes.retain(|n| !gone(&n.id));
    graph.edges.retain(|e| !gone(&e.from) && !gone(&e.to));
}

/// Gives every node in `targets` a label, made from its name.
fn make_labels(graph: &mut Graph, targets: &HashSet<NodeId>) {
    let mut taken: HashSet<String> = graph
        .nodes
        .iter()
        .flat_map(|n| n.labels().cloned())
        .collect();
    for node in graph
        .nodes
        .iter_mut()
        .filter(|n| n.label.is_none() && targets.contains(&n.id))
    {
        let mut base: String = node
            .full_name()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect();
        if !base.starts_with(|c: char| c.is_ascii_alphabetic()) {
            base.insert(0, 'n');
        }
        let mut label = base.clone();
        let mut n = 1;
        while taken.contains(&label) {
            n += 1;
            label = format!("{base}_{n}");
        }
        taken.insert(label.clone());
        node.label = Some(label);
    }
}

/// Moves `phandle` properties to [`Node::phandle`] where dtc would number
/// the node otherwise, and drops the others, so that the blob keeps its
/// numbers. A node with an old `linux,phandle` keeps both properties.
fn keep_phandles(graph: &mut Graph, original: &HashMap<NodeId, u32>) {
    let mut left: HashSet<NodeId> = HashSet::new();
    for node in &mut graph.nodes {
        if node.properties.iter().any(|p| p.name == "linux,phandle") {
            continue;
        }
        let before = node.properties.len();
        node.properties.retain(|p| p.name != "phandle");
        if node.properties.len() != before {
            left.insert(node.id.clone());
        }
    }
    // Each round pins the nodes dtc numbers otherwise, which can move the
    // numbers of the others.
    loop {
        let assigned = fdt::phandles(graph);
        let wrong: HashSet<NodeId> = left
            .iter()
            .filter(|id| assigned.get(*id) != original.get(*id))
            .cloned()
            .collect();
        if wrong.is_empty() {
            break;
        }
        for node in graph.nodes.iter_mut().filter(|n| wrong.contains(&n.id)) {
            node.phandle = original.get(&node.id).copied();
            left.remove(&node.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::import_dts;
    use crate::preprocess::ImportOptions;
    use crate::to_dts_flat;

    fn import(dts: &str, phandle_types: PhandleTypes) -> Graph {
        let options = ImportOptions {
            phandle_types,
            ..ImportOptions::default()
        };
        import_dts(dts, std::path::Path::new("board.dts"), &options).unwrap()
    }

    fn node<'a>(graph: &'a Graph, path: &str) -> &'a Node {
        graph.node(&NodeId(path.into())).unwrap()
    }

    fn references(graph: &Graph, from: &str) -> Vec<(String, String, Vec<u32>)> {
        graph
            .references(&NodeId(from.into()))
            .map(|e| match &e.kind {
                EdgeKind::Reference { property, args } => {
                    (property.clone(), e.to.0.clone(), args.clone())
                }
                EdgeKind::Child => unreachable!(),
            })
            .collect()
    }

    /// As `dtc -I dtb -O dts` writes a blob built with `-@`.
    const DECOMPILED: &str = "/dts-v1/;

/ {
	interrupt-parent = <0x01>;

	gic@100 {
		interrupt-controller;
		#interrupt-cells = <0x03>;
		phandle = <0x01>;
	};

	clock-controller@200 {
		#clock-cells = <0x01>;
		phandle = <0x02>;
	};

	gpio@300 {
		gpio-controller;
		#gpio-cells = <0x02>;
		phandle = <0x03>;

		hog {
			gpio-hog;
			gpios = <0x01 0x00>;
		};
	};

	serial@400 {
		clocks = <0x02 0x05 0x02 0x06>;
		status = \"okay\";
		cts-gpios = <0x03 0x07 0x00 0x00>;
	};

	__symbols__ {
		gic = \"/gic@100\";
		ccu = \"/clock-controller@200\";
		clk = \"/clock-controller@200\";
		pio = \"/gpio@300\";
		gone = \"/nowhere\";
	};
};
";

    #[test]
    fn numeric_phandles_become_references() {
        let graph = import(DECOMPILED, PhandleTypes::default());
        assert_eq!(
            references(&graph, "/serial@400"),
            [
                ("clocks".into(), "/clock-controller@200".into(), vec![5]),
                ("clocks".into(), "/clock-controller@200".into(), vec![6]),
            ]
        );
        assert_eq!(
            references(&graph, "/"),
            [("interrupt-parent".into(), "/gic@100".into(), vec![])]
        );
        // A 0 in a GPIO list keeps the list a value, with its references.
        let serial = node(&graph, "/serial@400");
        let cts = serial.properties.iter().find(|p| p.name == "cts-gpios");
        assert!(matches!(
            &cts.unwrap().value,
            PropertyValue::Mixed(chunks) if matches!(&chunks[0], ValueChunk::Cells { cells, .. }
                if cells[0] == Cell::Phandle { phandle: "pio".into() } && cells[3] == Cell::Number(0))
        ));
        // A hog's `gpios` are line numbers.
        let hog = node(&graph, "/gpio@300/hog");
        assert!(hog
            .properties
            .iter()
            .any(|p| p.name == "gpios" && p.value == PropertyValue::Cells(vec![1, 0])));
    }

    #[test]
    fn labels_come_from_the_symbols_and_the_symbols_go() {
        let graph = import(DECOMPILED, PhandleTypes::default());
        let ccu = node(&graph, "/clock-controller@200");
        assert_eq!(ccu.label.as_deref(), Some("ccu"));
        assert_eq!(ccu.extra_labels, ["clk"]);
        assert!(graph.nodes.iter().all(|n| !n.name.starts_with("__")));
        assert!(graph
            .nodes
            .iter()
            .all(|n| n.properties.iter().all(|p| p.name != "phandle")));
        // dtc numbers the nodes the same way again: nothing to keep.
        assert!(graph.nodes.iter().all(|n| n.phandle.is_none()));
        // The order the source had, with `clocks` first.
        assert_eq!(
            node(&graph, "/serial@400").order,
            ["clocks", "status", "cts-gpios"]
        );
        let dts = to_dts_flat(&graph).unwrap();
        assert!(
            dts.contains("clocks = <&ccu 5>, <&ccu 6>;\n\t\tstatus"),
            "{dts}"
        );
    }

    #[test]
    fn nodes_without_symbols_get_labels_from_their_names() {
        let source = DECOMPILED.replace("\tgic = \"/gic@100\";\n", "");
        let graph = import(&source, PhandleTypes::default());
        assert_eq!(node(&graph, "/gic@100").label.as_deref(), Some("gic_100"));
    }

    #[test]
    fn phandles_dtc_would_number_otherwise_are_kept() {
        // dtc would number the clock controller 1, before the GIC.
        let source = "/dts-v1/;
/ {
	clk: clock-controller@200 { #clock-cells = <0>; phandle = <0x07>; };
	serial@400 { clocks = <0x07>; vendor,thing = <0x09>; };
	unused@500 { phandle = <0x09>; };
};
";
        let graph = import(source, PhandleTypes::default());
        assert_eq!(node(&graph, "/clock-controller@200").phandle, Some(7));
        // Nothing known refers to it, so only its number keeps the value right.
        assert_eq!(node(&graph, "/unused@500").phandle, Some(9));
        let dts = to_dts_flat(&graph).unwrap();
        assert!(
            dts.contains("#clock-cells = <0>;\n\t\tphandle = <7>;"),
            "{dts}"
        );
    }

    #[test]
    fn schema_types_restore_vendor_properties() {
        let source = "/dts-v1/;
/ {
	syscon@100 { phandle = <0x01>; };
	mailbox@200 { #vendor,mbox-cells = <0x01>; phandle = <0x02>; };
	dev@300 { vendor,syscon = <0x01 0x10 0x04>; vendor,mboxs = <0x02 0x03 0x02 0x04>; };
};
";
        assert!(references(&import(source, PhandleTypes::default()), "/dev@300").is_empty());
        let types = PhandleTypes::new(|name| match name {
            "vendor,syscon" => Some(PhandleType::PhandleArray { entry: Some(3) }),
            "vendor,mboxs" => Some(PhandleType::PhandleArray { entry: None }),
            _ => None,
        });
        assert_eq!(
            references(&import(source, types), "/dev@300"),
            [
                ("vendor,syscon".into(), "/syscon@100".into(), vec![0x10, 4]),
                ("vendor,mboxs".into(), "/mailbox@200".into(), vec![3]),
                ("vendor,mboxs".into(), "/mailbox@200".into(), vec![4]),
            ]
        );
    }

    #[test]
    fn a_value_that_does_not_fit_stays_numbers() {
        // Two cells for a provider with one argument cell: not a clock list.
        let source = "/dts-v1/;
/ {
	clock-controller@200 { #clock-cells = <0x01>; phandle = <0x01>; };
	serial@400 { clocks = <0x01 0x05 0x01>; interrupts = <0x01 0x02>; };
};
";
        let graph = import(source, PhandleTypes::default());
        assert!(references(&graph, "/serial@400").is_empty());
        assert!(node(&graph, "/serial@400")
            .properties
            .iter()
            .any(|p| p.name == "clocks" && p.value == PropertyValue::Cells(vec![1, 5, 1])));
    }

    #[test]
    fn sources_without_phandles_are_left_alone() {
        let graph = import(
            "/dts-v1/;\n/ { a { #clock-cells = <0>; }; b { clocks = <1>; }; };\n",
            PhandleTypes::default(),
        );
        assert!(graph.edges.iter().all(|e| e.kind == EdgeKind::Child));
    }
}
