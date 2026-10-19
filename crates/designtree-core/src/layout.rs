//! Automatic placement of nodes on the editor canvas.
//!
//! The devicetree hierarchy is drawn left to right: depth selects the column,
//! leaves are stacked top to bottom in child order and every parent is
//! centered on its children. Each bus (a non-root node with addressable
//! children) is wrapped in a group frame named `bus:<node id>`. Groups created
//! by the user are left alone. Positions are the only thing that changes, so
//! the generated DTS is unaffected.

use std::collections::{HashMap, HashSet};

use crate::model::{EdgeKind, Graph, Group, Node, NodeId, Position, Size};

/// Space reserved for one node; actual cards are a bit smaller.
const NODE_WIDTH: f32 = 220.0;
const NODE_HEIGHT: f32 = 100.0;
const COLUMN_GAP: f32 = 100.0;
const ROW_GAP: f32 = 30.0;
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

/// Lays out the subtree of `id` and returns the vertical center of its node.
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
            let center = *cursor + NODE_HEIGHT / 2.0;
            *cursor += NODE_HEIGHT + ROW_GAP;
            center
        }
    };

    positions.insert(
        id.clone(),
        Position {
            x: depth as f32 * (NODE_WIDTH + COLUMN_GAP),
            y: center - NODE_HEIGHT / 2.0,
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
            compatible: vec![],
            properties: vec![],
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
        }
    }

    fn pos(g: &Graph, id: &str) -> Position {
        g.node(&id.into()).unwrap().position
    }

    fn overlap(a: Position, b: Position) -> bool {
        (a.x - b.x).abs() < NODE_WIDTH && (a.y - b.y).abs() < NODE_HEIGHT
    }

    #[test]
    fn columns_by_depth_and_parents_centered() {
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
        assert_eq!(pos(&g, "root").x, 0.0);
        assert_eq!(pos(&g, "a").x, NODE_WIDTH + COLUMN_GAP);
        assert_eq!(pos(&g, "c").x, 2.0 * (NODE_WIDTH + COLUMN_GAP));
        // `a` has a single child, so it sits at the child's height.
        assert_eq!(pos(&g, "a").y, pos(&g, "c").y);
        let mid = (pos(&g, "a").y + pos(&g, "b").y) / 2.0;
        assert_eq!(pos(&g, "root").y, mid);
        assert!(pos(&g, "a").y < pos(&g, "b").y);
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
        assert_eq!(g.groups[0], user);
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
