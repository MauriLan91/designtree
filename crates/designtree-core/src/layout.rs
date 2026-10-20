//! Automatic placement of nodes on the editor canvas.
//!
//! The devicetree hierarchy is drawn top down, matching the editor's handles
//! (parent at the bottom of a card, children at the top): depth selects the
//! row, leaves are placed left to right in child order and every parent is
//! centered above its children. Each bus (a non-root node with addressable
//! children) is wrapped in a group frame named `bus:<node id>`. Groups created
//! by the user are left alone. Positions are the only thing that changes, so
//! the generated DTS is unaffected.

use std::collections::{HashMap, HashSet};

use crate::model::{EdgeKind, Graph, Group, Node, NodeId, Position, Size};

/// Space reserved for one node; actual cards are a bit smaller.
const NODE_WIDTH: f32 = 220.0;
const NODE_HEIGHT: f32 = 100.0;
/// Horizontal gap between neighbouring leaves.
const SIBLING_GAP: f32 = 40.0;
/// Vertical gap between a parent and its children.
const LEVEL_GAP: f32 = 80.0;
/// Padding between a bus frame and the nodes inside it.
const GROUP_PADDING: f32 = 40.0;
const BUS_GROUP_PREFIX: &str = "bus:";

/// Places every node and regenerates the bus groups of `graph`.
pub fn auto_layout(graph: &mut Graph) {
    graph.groups.retain(|g| !g.id.starts_with(BUS_GROUP_PREFIX));

    let children = child_map(graph);
    let buses: HashSet<NodeId> = graph
        .nodes
        .iter()
        .filter(|n| !n.is_root() && is_bus(graph, n, &children))
        .map(|n| n.id.clone())
        .collect();

    let mut positions: HashMap<NodeId, Position> = HashMap::new();
    let mut cursor = 0.0;
    // The hierarchy actually drawn: a spanning forest of the child edges.
    let mut tree: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    if let Some(root) = graph.root() {
        place(
            &root.id,
            0,
            &children,
            &buses,
            &mut cursor,
            &mut positions,
            &mut tree,
        );
    }
    // Nodes unreachable from the root (invalid designs) go below the tree.
    for node in &graph.nodes {
        if !positions.contains_key(&node.id) {
            place(
                &node.id,
                0,
                &children,
                &buses,
                &mut cursor,
                &mut positions,
                &mut tree,
            );
        }
    }
    for node in &mut graph.nodes {
        node.position = positions[&node.id];
    }

    for group in &mut graph.groups {
        refit_group(group, &positions);
    }

    let grouped: HashSet<NodeId> = graph.groups.iter().flat_map(members_recursive).collect();
    let mut bus_groups = Vec::new();
    if let Some(root) = graph.root() {
        for child in tree.get(&root.id).into_iter().flatten() {
            collect_bus_groups(
                graph,
                child,
                &tree,
                &buses,
                &positions,
                &grouped,
                &mut bus_groups,
            );
        }
    }
    graph.groups.extend(bus_groups);
}

/// Resizes a user group to enclose its (moved) members and subgroups.
fn refit_group(
    group: &mut Group,
    positions: &HashMap<NodeId, Position>,
) -> Option<(f32, f32, f32, f32)> {
    let mut bounds: Option<(f32, f32, f32, f32)> = None;
    let mut extend = |b: (f32, f32, f32, f32)| {
        bounds = Some(match bounds {
            Some(o) => (o.0.min(b.0), o.1.min(b.1), o.2.max(b.2), o.3.max(b.3)),
            None => b,
        });
    };
    for id in &group.members {
        if let Some(p) = positions.get(id) {
            extend((p.x, p.y, p.x + NODE_WIDTH, p.y + NODE_HEIGHT));
        }
    }
    for sub in &mut group.subgroups {
        if let Some(b) = refit_group(sub, positions) {
            extend(b);
        }
    }
    let (x0, y0, x1, y1) = bounds?;
    let (x0, y0, x1, y1) = (
        x0 - GROUP_PADDING,
        y0 - GROUP_PADDING,
        x1 + GROUP_PADDING,
        y1 + GROUP_PADDING,
    );
    group.position = Position { x: x0, y: y0 };
    group.size = Some(Size {
        width: x1 - x0,
        height: y1 - y0,
    });
    Some((x0, y0, x1, y1))
}

fn members_recursive(group: &Group) -> Vec<NodeId> {
    let mut ids = group.members.clone();
    for sub in &group.subgroups {
        ids.extend(members_recursive(sub));
    }
    ids
}

fn child_map(graph: &Graph) -> HashMap<NodeId, Vec<NodeId>> {
    let mut map: HashMap<NodeId, Vec<NodeId>> = HashMap::new();
    for edge in &graph.edges {
        if edge.kind == EdgeKind::Child {
            map.entry(edge.from.clone())
                .or_default()
                .push(edge.to.clone());
        }
    }
    map
}

fn is_bus(graph: &Graph, node: &Node, children: &HashMap<NodeId, Vec<NodeId>>) -> bool {
    children.get(&node.id).is_some_and(|ids| {
        ids.iter()
            .any(|id| graph.node(id).is_some_and(|c| c.unit_address.is_some()))
    })
}

/// Lays out the subtree of `id` and returns the horizontal center of its node.
fn place(
    id: &NodeId,
    depth: usize,
    children: &HashMap<NodeId, Vec<NodeId>>,
    buses: &HashSet<NodeId>,
    cursor: &mut f32,
    positions: &mut HashMap<NodeId, Position>,
    tree: &mut HashMap<NodeId, Vec<NodeId>>,
) -> f32 {
    // Reserve the slot first so malformed hierarchies (cycles, several
    // parents) cannot recurse forever.
    positions.insert(id.clone(), Position::default());
    let bus = buses.contains(id);
    let start = *cursor;
    if bus {
        *cursor += GROUP_PADDING;
    }
    let mut first = None;
    let mut last = 0.0;
    for kid in children.get(id).into_iter().flatten() {
        // Already placed through another parent or an earlier sibling.
        if positions.contains_key(kid) {
            continue;
        }
        tree.entry(id.clone()).or_default().push(kid.clone());
        last = place(kid, depth + 1, children, buses, cursor, positions, tree);
        first.get_or_insert(last);
    }

    let center = match first {
        Some(first) => {
            if bus {
                *cursor += GROUP_PADDING;
            }
            (first + last) / 2.0
        }
        None => {
            *cursor = start;
            let center = *cursor + NODE_WIDTH / 2.0;
            *cursor += NODE_WIDTH + SIBLING_GAP;
            center
        }
    };

    positions.insert(
        id.clone(),
        Position {
            x: center - NODE_WIDTH / 2.0,
            y: depth as f32 * (NODE_HEIGHT + LEVEL_GAP),
        },
    );
    center
}

/// Builds the frame of every outermost bus below `id`, with nested buses as
/// subgroups. Walks through non-bus nodes to find buses deeper in the tree.
fn collect_bus_groups(
    graph: &Graph,
    id: &NodeId,
    children: &HashMap<NodeId, Vec<NodeId>>,
    buses: &HashSet<NodeId>,
    positions: &HashMap<NodeId, Position>,
    grouped: &HashSet<NodeId>,
    out: &mut Vec<Group>,
) {
    if buses.contains(id) {
        out.push(bus_group(graph, id, children, buses, positions, grouped).0);
        return;
    }
    for child in children.get(id).into_iter().flatten() {
        collect_bus_groups(graph, child, children, buses, positions, grouped, out);
    }
}

/// Returns the group of the bus `id` and its bounding box `(x0, y0, x1, y1)`.
fn bus_group(
    graph: &Graph,
    id: &NodeId,
    children: &HashMap<NodeId, Vec<NodeId>>,
    buses: &HashSet<NodeId>,
    positions: &HashMap<NodeId, Position>,
    grouped: &HashSet<NodeId>,
) -> (Group, (f32, f32, f32, f32)) {
    let mut members = Vec::new();
    let mut subgroups = Vec::new();
    let mut bounds = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    let mut extend = |b: (f32, f32, f32, f32)| {
        bounds = (
            bounds.0.min(b.0),
            bounds.1.min(b.1),
            bounds.2.max(b.2),
            bounds.3.max(b.3),
        );
    };

    for child in children.get(id).into_iter().flatten() {
        let p = positions[child];
        if !grouped.contains(child) {
            members.push(child.clone());
            extend((p.x, p.y, p.x + NODE_WIDTH, p.y + NODE_HEIGHT));
        }
        if buses.contains(child) {
            let (sub, b) = bus_group(graph, child, children, buses, positions, grouped);
            subgroups.push(sub);
            extend(b);
        }
    }
    let (x0, y0) = (bounds.0 - GROUP_PADDING, bounds.1 - GROUP_PADDING);
    let (x1, y1) = (bounds.2 + GROUP_PADDING, bounds.3 + GROUP_PADDING);
    let node = graph.node(id).expect("bus is a graph node");
    let group = Group {
        id: format!("{BUS_GROUP_PREFIX}{}", id.0),
        title: node.label.clone().unwrap_or_else(|| node.full_name()),
        members,
        subgroups,
        position: Position { x: x0, y: y0 },
        size: Some(Size {
            width: x1 - x0,
            height: y1 - y0,
        }),
    };
    (group, (x0, y0, x1, y1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Edge;

    fn node(id: &str, unit: Option<&str>) -> Node {
        Node {
            id: id.into(),
            name: if id == "root" { "/".into() } else { id.into() },
            unit_address: unit.map(Into::into),
            label: None,
            extra_labels: vec![],
            omit_if_no_ref: false,
            compatible: vec![],
            properties: vec![],
            inherited: None,
            position: Position::default(),
        }
    }

    fn graph(nodes: Vec<Node>, links: &[(&str, &str)]) -> Graph {
        Graph {
            nodes,
            edges: links
                .iter()
                .map(|(from, to)| Edge {
                    from: (*from).into(),
                    to: (*to).into(),
                    kind: EdgeKind::Child,
                })
                .collect(),
            groups: vec![],
            ..Default::default()
        }
    }

    fn pos(g: &Graph, id: &str) -> Position {
        g.node(&id.into()).unwrap().position
    }

    fn overlap(a: Position, b: Position) -> bool {
        (a.x - b.x).abs() < NODE_WIDTH && (a.y - b.y).abs() < NODE_HEIGHT
    }

    #[test]
    fn rows_by_depth_and_parents_centered() {
        let mut g = graph(
            vec![
                node("root", None),
                node("a", None),
                node("b", None),
                node("c", None),
            ],
            &[("root", "a"), ("root", "b"), ("a", "c")],
        );
        auto_layout(&mut g);
        let level = NODE_HEIGHT + LEVEL_GAP;
        assert_eq!(pos(&g, "root").y, 0.0);
        assert_eq!(pos(&g, "a").y, level);
        assert_eq!(pos(&g, "c").y, 2.0 * level);
        // `a` has a single child, so it sits right above it.
        assert_eq!(pos(&g, "a").x, pos(&g, "c").x);
        let mid = (pos(&g, "a").x + pos(&g, "b").x) / 2.0;
        assert_eq!(pos(&g, "root").x, mid);
        assert!(pos(&g, "a").x < pos(&g, "b").x);
    }

    #[test]
    fn no_overlap_and_idempotent() {
        let mut g = graph(
            vec![
                node("root", None),
                node("soc", None),
                node("uart", Some("1000")),
                node("i2c", Some("2000")),
                node("sensor", Some("48")),
                node("memory", Some("80000000")),
            ],
            &[
                ("root", "soc"),
                ("root", "memory"),
                ("soc", "uart"),
                ("soc", "i2c"),
                ("i2c", "sensor"),
            ],
        );
        auto_layout(&mut g);
        for (i, a) in g.nodes.iter().enumerate() {
            for b in &g.nodes[i + 1..] {
                assert!(
                    !overlap(a.position, b.position),
                    "{} overlaps {}",
                    a.id.0,
                    b.id.0
                );
            }
        }
        let once = g.clone();
        auto_layout(&mut g);
        assert_eq!(g, once);
    }

    #[test]
    fn groups_follow_buses_and_nest() {
        let mut g = graph(
            vec![
                node("root", None),
                node("soc", None),
                node("uart", Some("1000")),
                node("i2c", Some("2000")),
                node("sensor", Some("48")),
            ],
            &[
                ("root", "soc"),
                ("soc", "uart"),
                ("soc", "i2c"),
                ("i2c", "sensor"),
            ],
        );
        auto_layout(&mut g);
        // `soc` and `i2c` are buses; `soc` is not at the root so it is framed.
        assert_eq!(g.groups.len(), 1);
        let soc = &g.groups[0];
        assert_eq!(soc.id, "bus:soc");
        assert_eq!(soc.members, vec![NodeId::from("uart"), "i2c".into()]);
        assert_eq!(soc.subgroups.len(), 1);
        let i2c = &soc.subgroups[0];
        assert_eq!(i2c.members, vec![NodeId::from("sensor")]);

        // The outer frame contains the inner one and every member.
        let (o, i) = (soc.position, i2c.position);
        let (os, is) = (soc.size.unwrap(), i2c.size.unwrap());
        assert!(o.x < i.x && o.y < i.y);
        assert!(o.x + os.width > i.x + is.width && o.y + os.height > i.y + is.height);
        let u = pos(&g, "uart");
        assert!(u.x > o.x && u.y > o.y && u.y + NODE_HEIGHT < o.y + os.height);
        assert!(u.x + NODE_WIDTH < o.x + os.width);
    }

    #[test]
    fn keeps_user_groups_and_replaces_old_bus_groups() {
        let mut g = graph(
            vec![
                node("root", None),
                node("soc", None),
                node("uart", Some("1000")),
            ],
            &[("root", "soc"), ("soc", "uart")],
        );
        let user = Group {
            id: "g1".into(),
            title: "mine".into(),
            members: vec!["uart".into()],
            subgroups: vec![],
            position: Position::default(),
            size: None,
        };
        g.groups = vec![user.clone()];
        auto_layout(&mut g);
        auto_layout(&mut g);
        // The user group keeps its identity and members but wraps them again.
        assert_eq!(g.groups[0].members, user.members);
        let (gp, up) = (g.groups[0].position, pos(&g, "uart"));
        assert!(gp.x < up.x && gp.y < up.y);
        assert!(g.groups[0].size.is_some());
        assert_eq!(g.groups.len(), 2);
        // `uart` already belongs to a user group, so the bus frame skips it.
        assert!(g.groups[1].members.is_empty());
    }

    #[test]
    fn survives_cycles_and_detached_nodes() {
        let mut g = graph(
            vec![
                node("root", None),
                node("a", None),
                node("b", None),
                node("x", None),
            ],
            &[("root", "a"), ("a", "b"), ("b", "a")],
        );
        auto_layout(&mut g);
        for (i, a) in g.nodes.iter().enumerate() {
            for b in &g.nodes[i + 1..] {
                assert!(!overlap(a.position, b.position));
            }
        }
    }
}
