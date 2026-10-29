//! The interrupt tree of a design: which controller each device interrupts,
//! found the way the kernel does it (`of_irq_find_parent`), and what is
//! missing along the way.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::model::{Cell, EdgeKind, Graph, Node, NodeId, PropertyValue, ValueChunk};

/// An interrupt controller (or nexus) and what interrupts it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct InterruptController {
    pub node: NodeId,
    /// The controller this one cascades into; `None` for a top-level
    /// controller such as the GIC.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub parent: Option<NodeId>,
    /// Devices wired to this controller, in design order.
    pub devices: Vec<NodeId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct InterruptProblem {
    pub node: NodeId,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct InterruptTree {
    pub controllers: Vec<InterruptController>,
    /// Devices that cannot be placed under a controller, and malformed
    /// specifiers.
    pub problems: Vec<InterruptProblem>,
}

/// Builds the interrupt tree of `graph`.
pub fn interrupt_tree(graph: &Graph) -> InterruptTree {
    let mut tree = InterruptTree::default();
    let is_controller =
        |n: &Node| has_property(n, "interrupt-controller") || has_property(n, "interrupt-map");

    // Controllers first, so a device list can be filled in as devices are
    // found; every node that is a controller gets an entry, wired or not.
    for node in graph.nodes.iter().filter(|n| is_controller(n)) {
        // Only a controller that itself raises interrupts cascades into
        // another one; for the others, `interrupt-parent` inherited from
        // the root would point back at themselves.
        let cascades = has_property(node, "interrupts")
            || graph.edges.iter().any(|e| {
                e.from == node.id
                    && matches!(&e.kind, EdgeKind::Reference { property, .. } if property == "interrupts-extended")
            });
        let parent = interrupt_parent(graph, node).filter(|p| cascades && p.id != node.id);
        tree.controllers.push(InterruptController {
            node: node.id.clone(),
            parent: parent.filter(|p| is_controller(p)).map(|p| p.id.clone()),
            devices: Vec::new(),
        });
    }

    for node in &graph.nodes {
        let extended: Vec<&Node> = graph
            .edges
            .iter()
            .filter(|e| e.from == node.id)
            .filter(|e| matches!(&e.kind, EdgeKind::Reference { property, .. } if property == "interrupts-extended"))
            .filter_map(|e| graph.node(&e.to))
            .collect();
        let has_interrupts = has_property(node, "interrupts");
        if !has_interrupts && extended.is_empty() {
            continue;
        }

        let parents: Vec<&Node> = if extended.is_empty() {
            match interrupt_parent(graph, node) {
                Some(parent) => vec![parent],
                None => {
                    tree.problems.push(InterruptProblem {
                        node: node.id.clone(),
                        message: "no interrupt parent: set interrupt-parent or place the node under an interrupt controller".into(),
                    });
                    continue;
                }
            }
        } else {
            extended
        };

        for parent in parents {
            let Some(controller) = tree.controllers.iter_mut().find(|c| c.node == parent.id) else {
                tree.problems.push(InterruptProblem {
                    node: node.id.clone(),
                    message: format!(
                        "interrupt parent `{}` is not an interrupt controller (no interrupt-controller or interrupt-map)",
                        parent.full_name()
                    ),
                });
                continue;
            };
            if !controller.devices.contains(&node.id) {
                controller.devices.push(node.id.clone());
            }
            if has_interrupts {
                if let Some(message) = specifier_problem(node, parent) {
                    tree.problems.push(InterruptProblem {
                        node: node.id.clone(),
                        message,
                    });
                }
            }
        }
    }
    tree
}

fn has_property(node: &Node, name: &str) -> bool {
    node.properties.iter().any(|p| p.name == name)
}

fn cells_of(node: &Node, name: &str) -> Option<Vec<u64>> {
    node.properties
        .iter()
        .find(|p| p.name == name)
        .and_then(|p| match &p.value {
            PropertyValue::Cells(cells) => Some(cells.iter().map(|c| u64::from(*c)).collect()),
            _ => None,
        })
}

/// `interrupts` is a list of specifiers, `#interrupt-cells` cells each.
fn specifier_problem(node: &Node, parent: &Node) -> Option<String> {
    let per = usize::try_from(cells_of(parent, "#interrupt-cells")?.first().copied()?).ok()?;
    let count = cells_of(node, "interrupts")?.len();
    (per > 0 && count % per != 0).then(|| {
        format!(
            "interrupts has {count} cells, not a multiple of {per} (#interrupt-cells of `{}`)",
            parent.full_name()
        )
    })
}

/// The target of a phandle property: a reference edge, or a lone phandle
/// kept in the property value.
fn phandle_target<'a>(graph: &'a Graph, node: &Node, property: &str) -> Option<&'a Node> {
    for edge in graph.edges.iter().filter(|e| e.from == node.id) {
        if matches!(&edge.kind, EdgeKind::Reference { property: p, .. } if p == property) {
            return graph.node(&edge.to);
        }
    }
    let value = node.properties.iter().find(|p| p.name == property)?;
    let PropertyValue::Mixed(chunks) = &value.value else {
        return None;
    };
    chunks.iter().find_map(|chunk| match chunk {
        ValueChunk::Cells { cells, .. } => cells.iter().find_map(|cell| match cell {
            Cell::Phandle { phandle } => graph
                .nodes
                .iter()
                .find(|n| n.labels().any(|l| l == phandle)),
            Cell::Number(_) => None,
        }),
        _ => None,
    })
}

fn tree_parent<'a>(graph: &'a Graph, node: &Node) -> Option<&'a Node> {
    graph
        .edges
        .iter()
        .find(|e| e.to == node.id && e.kind == EdgeKind::Child)
        .and_then(|e| graph.node(&e.from))
}

/// The node `node`'s interrupts go to: its `interrupt-parent`, else its
/// parent in the tree, and on up until a node with `#interrupt-cells`.
fn interrupt_parent<'a>(graph: &'a Graph, node: &Node) -> Option<&'a Node> {
    let mut seen = HashSet::new();
    let mut child = node;
    loop {
        let parent = phandle_target(graph, child, "interrupt-parent")
            .or_else(|| tree_parent(graph, child))?;
        if has_property(parent, "#interrupt-cells") {
            return Some(parent);
        }
        // A parent chain that loops back ends the search.
        if !seen.insert(&parent.id) {
            return None;
        }
        child = parent;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(json: &str) -> Graph {
        serde_json::from_str(json).unwrap()
    }

    /// root -> soc -> {gic (controller, 3 cells), uart (interrupts), gpio
    /// (controller, 2 cells, cascades into gic), button (interrupts via gpio)}.
    fn soc() -> Graph {
        graph(
            r##"{
            "nodes": [
                {"id": "root", "name": "/", "properties": [
                    {"name": "interrupt-parent", "value": {"type": "mixed", "value": [
                        {"type": "cells", "bits": 32, "cells": [{"phandle": "gic"}]}]}}]},
                {"id": "gic", "name": "interrupt-controller", "label": "gic", "properties": [
                    {"name": "interrupt-controller", "value": {"type": "empty"}},
                    {"name": "#interrupt-cells", "value": {"type": "cells", "value": [3]}}]},
                {"id": "uart", "name": "serial", "properties": [
                    {"name": "interrupts", "value": {"type": "cells", "value": [0, 5, 4]}}]},
                {"id": "gpio", "name": "gpio", "label": "gpio", "properties": [
                    {"name": "interrupt-controller", "value": {"type": "empty"}},
                    {"name": "#interrupt-cells", "value": {"type": "cells", "value": [2]}},
                    {"name": "interrupts", "value": {"type": "cells", "value": [0, 9, 4]}}]},
                {"id": "button", "name": "button", "properties": [
                    {"name": "interrupts", "value": {"type": "cells", "value": [3, 2]}}]}
            ],
            "edges": [
                {"from": "root", "to": "gic", "kind": "child"},
                {"from": "root", "to": "uart", "kind": "child"},
                {"from": "root", "to": "gpio", "kind": "child"},
                {"from": "root", "to": "button", "kind": "child"},
                {"from": "button", "to": "gpio", "kind": "reference", "property": "interrupt-parent"}
            ]
        }"##,
        )
    }

    #[test]
    fn devices_are_placed_under_their_controllers() {
        let tree = interrupt_tree(&soc());
        assert_eq!(tree.problems, vec![]);
        let find = |id: &str| {
            tree.controllers
                .iter()
                .find(|c| c.node == id.into())
                .unwrap()
        };
        // The root's interrupt-parent (a lone phandle value) reaches the GIC.
        assert_eq!(find("gic").devices, vec!["uart".into(), "gpio".into()]);
        assert_eq!(find("gic").parent, None);
        assert_eq!(find("gpio").devices, vec!["button".into()]);
        assert_eq!(find("gpio").parent, Some("gic".into()));
    }

    #[test]
    fn missing_parent_is_flagged() {
        let mut g = soc();
        g.nodes[0].properties.clear(); // the root no longer names a parent
        let tree = interrupt_tree(&g);
        let flagged: Vec<_> = tree.problems.iter().map(|p| p.node.0.as_str()).collect();
        assert!(flagged.contains(&"uart"), "{:?}", tree.problems);
        assert!(tree.problems[0].message.contains("no interrupt parent"));
    }

    #[test]
    fn parent_that_is_not_a_controller_is_flagged() {
        let mut g = soc();
        // `button` takes interrupt cells but is no controller.
        g.nodes[4].properties.push(crate::model::Property {
            name: "#interrupt-cells".into(),
            value: PropertyValue::Cells(vec![1]),
        });
        g.edges.push(crate::model::Edge {
            from: "uart".into(),
            to: "button".into(),
            kind: EdgeKind::Reference {
                property: "interrupt-parent".into(),
                args: vec![],
            },
        });
        let tree = interrupt_tree(&g);
        assert_eq!(tree.problems.len(), 1, "{:?}", tree.problems);
        assert_eq!(tree.problems[0].node, "uart".into());
        assert!(tree.problems[0]
            .message
            .contains("not an interrupt controller"));
    }

    #[test]
    fn wrong_cell_count_is_flagged() {
        let mut g = soc();
        g.nodes[2].properties[0].value = PropertyValue::Cells(vec![0, 5]);
        let tree = interrupt_tree(&g);
        assert_eq!(tree.problems.len(), 1);
        assert!(tree.problems[0].message.contains("not a multiple of 3"));
    }

    #[test]
    fn interrupts_extended_names_each_parent() {
        let mut g = soc();
        g.nodes[2].properties.clear();
        g.edges.push(crate::model::Edge {
            from: "uart".into(),
            to: "gic".into(),
            kind: EdgeKind::Reference {
                property: "interrupts-extended".into(),
                args: vec![0, 5, 4],
            },
        });
        g.edges.push(crate::model::Edge {
            from: "uart".into(),
            to: "gpio".into(),
            kind: EdgeKind::Reference {
                property: "interrupts-extended".into(),
                args: vec![1, 2],
            },
        });
        let tree = interrupt_tree(&g);
        let find = |id: &str| {
            tree.controllers
                .iter()
                .find(|c| c.node == id.into())
                .unwrap()
        };
        assert!(find("gic").devices.contains(&"uart".into()));
        assert!(find("gpio").devices.contains(&"uart".into()));
    }
}
