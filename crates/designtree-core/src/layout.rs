//! Automatic placement of nodes on the editor canvas.
//!
//! The canvas shows one scope at a time: a node's children, and on the main
//! scope the top-level nodes beside the root (D7). Each scope is therefore
//! laid out on its own, from the origin, so that its nodes sit together and
//! fit in view however large the rest of the tree is. Within a scope nodes
//! keep their child order, in rows about as wide as a screen is wide in
//! proportion. A user group is placed as one block holding its members.
//!
//! Older versions framed every bus in a group named `bus:<node id>`; inside
//! the bus's own scope such a frame held everything, so it is dropped here.
//! Positions are the only thing that changes, so the generated DTS is
//! unaffected.

use std::collections::{HashMap, HashSet};

use crate::model::{EdgeKind, Graph, Group, NodeId, Position, Size};

/// Space reserved for one node; actual cards are a bit smaller, unless they
/// list many wired ports.
const NODE_WIDTH: f32 = 220.0;
const NODE_HEIGHT: f32 = 130.0;
/// Room between neighbouring nodes in a row.
const SIBLING_GAP: f32 = 40.0;
/// Room between rows.
const ROW_GAP: f32 = 60.0;
/// Padding between a group frame and the nodes inside it.
const GROUP_PADDING: f32 = 40.0;
/// The width to height ratio a scope's rows aim for, about that of a screen.
const ASPECT: f32 = 1.6;
/// Small scopes still get a row of up to four nodes rather than a column.
const MIN_ROW: f32 = 4.0 * (NODE_WIDTH + SIBLING_GAP) - SIBLING_GAP;
const BUS_GROUP_PREFIX: &str = "bus:";

/// Places every node, scope by scope, and refits the user groups.
pub fn auto_layout(graph: &mut Graph) {
    graph.groups.retain(|g| !g.id.starts_with(BUS_GROUP_PREFIX));
    for group in &mut graph.groups {
        drop_bus_subgroups(group);
    }

    let mut positions: HashMap<NodeId, Position> = HashMap::new();
    for scope in scopes(graph) {
        let blocks = blocks(&scope, &graph.groups);
        pack(&blocks, Position::default(), &mut positions);
    }
    for node in &mut graph.nodes {
        node.position = positions.get(&node.id).copied().unwrap_or_default();
    }
    // Routes were drawn for the old positions.
    for edge in &mut graph.edges {
        edge.route = None;
    }
    for group in &mut graph.groups {
        refit_group(group, &positions);
    }
}

fn drop_bus_subgroups(group: &mut Group) {
    group
        .subgroups
        .retain(|g| !g.id.starts_with(BUS_GROUP_PREFIX));
    for sub in &mut group.subgroups {
        drop_bus_subgroups(sub);
    }
}

/// The nodes of each scope, in child order: the top-level nodes beside the
/// root, then the children of every node that has some. The root itself is
/// drawn in no scope; it stays at the origin.
fn scopes(graph: &Graph) -> Vec<Vec<NodeId>> {
    let mut children: HashMap<&NodeId, Vec<NodeId>> = HashMap::new();
    let mut parented: HashSet<&NodeId> = HashSet::new();
    for edge in &graph.edges {
        // A node with several parents (an invalid design) is drawn under the first.
        if edge.kind == EdgeKind::Child && parented.insert(&edge.to) {
            children
                .entry(&edge.from)
                .or_default()
                .push(edge.to.clone());
        }
    }
    let root = graph.root().map(|n| &n.id);
    let mut main: Vec<NodeId> = Vec::new();
    if let Some(root) = root {
        main.extend(children.remove(root).unwrap_or_default());
    }
    main.extend(
        graph
            .nodes
            .iter()
            .filter(|n| Some(&n.id) != root && !parented.contains(&n.id))
            .map(|n| n.id.clone()),
    );
    let mut out = vec![main];
    // In the order of the design, so the result does not depend on hashing.
    for node in &graph.nodes {
        if let Some(kids) = children.remove(&node.id) {
            out.push(kids);
        }
    }
    out
}

/// Something placed as a whole: a node, or a group with its contents.
enum Block {
    Node(NodeId),
    Group(Vec<Block>),
}

/// The blocks of a scope: its nodes, with those in a user group gathered
/// into that group's block at the place of its first member.
fn blocks(scope: &[NodeId], groups: &[Group]) -> Vec<Block> {
    let in_scope: HashSet<&NodeId> = scope.iter().collect();
    let mut owner: HashMap<&NodeId, usize> = HashMap::new();
    for (i, group) in groups.iter().enumerate() {
        for id in members_recursive(group) {
            if let Some(id) = in_scope.get(&id) {
                owner.insert(id, i);
            }
        }
    }
    let mut out = Vec::new();
    let mut done: HashSet<usize> = HashSet::new();
    for id in scope {
        match owner.get(id) {
            None => out.push(Block::Node(id.clone())),
            Some(&i) => {
                if done.insert(i) {
                    out.push(group_block(&groups[i], &in_scope));
                }
            }
        }
    }
    out
}

fn group_block(group: &Group, in_scope: &HashSet<&NodeId>) -> Block {
    let mut inner: Vec<Block> = group
        .members
        .iter()
        .filter(|id| in_scope.contains(id))
        .map(|id| Block::Node(id.clone()))
        .collect();
    inner.extend(
        group
            .subgroups
            .iter()
            .map(|sub| group_block(sub, in_scope))
            .filter(|b| !matches!(b, Block::Group(inner) if inner.is_empty())),
    );
    Block::Group(inner)
}

/// The size a block takes once packed.
fn size_of(block: &Block) -> (f32, f32) {
    match block {
        Block::Node(_) => (NODE_WIDTH, NODE_HEIGHT),
        Block::Group(inner) => {
            let (w, h) = pack(inner, Position::default(), &mut HashMap::new());
            (w + 2.0 * GROUP_PADDING, h + 2.0 * GROUP_PADDING)
        }
    }
}

/// Places `blocks` in rows from `origin`, left to right and wrapping where
/// the rows would get wider than `ASPECT` times their height, and returns
/// the size taken.
fn pack(
    blocks: &[Block],
    origin: Position,
    positions: &mut HashMap<NodeId, Position>,
) -> (f32, f32) {
    if blocks.is_empty() {
        return (0.0, 0.0);
    }
    let sizes: Vec<(f32, f32)> = blocks.iter().map(size_of).collect();
    let area: f32 = sizes
        .iter()
        .map(|(w, h)| (w + SIBLING_GAP) * (h + ROW_GAP))
        .sum();
    let widest = sizes.iter().map(|s| s.0).fold(0.0, f32::max);
    let wrap = (area * ASPECT).sqrt().max(widest).max(MIN_ROW);

    let (mut x, mut y, mut row_height, mut width) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    for (block, (w, h)) in blocks.iter().zip(sizes) {
        if x > 0.0 && x + w > wrap {
            x = 0.0;
            y += row_height + ROW_GAP;
            row_height = 0.0;
        }
        let at = Position {
            x: origin.x + x,
            y: origin.y + y,
        };
        match block {
            Block::Node(id) => {
                positions.insert(id.clone(), at);
            }
            Block::Group(inner) => {
                pack(
                    inner,
                    Position {
                        x: at.x + GROUP_PADDING,
                        y: at.y + GROUP_PADDING,
                    },
                    positions,
                );
            }
        }
        width = width.max(x + w);
        row_height = row_height.max(h);
        x += w + SIBLING_GAP;
    }
    (width, y + row_height)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Edge, Node};

    fn node(id: &str, unit: Option<&str>) -> Node {
        Node {
            id: id.into(),
            name: if id == "root" { "/".into() } else { id.into() },
            unit_address: unit.map(Into::into),
            label: None,
            extra_labels: vec![],
            omit_if_no_ref: false,
            compatible: vec![],
            compatible_at: None,
            properties: vec![],
            inherited: None,
            position: Position::default(),
            board_position: None,
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
                    route: None,
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

    /// The nodes drawn together in each scope overlap none of the others.
    fn assert_no_overlap(g: &Graph) {
        for scope in scopes(g) {
            for (i, a) in scope.iter().enumerate() {
                for b in &scope[i + 1..] {
                    assert!(
                        !overlap(pos(g, &a.0), pos(g, &b.0)),
                        "{} overlaps {}",
                        a.0,
                        b.0
                    );
                }
            }
        }
    }

    #[test]
    fn each_scope_starts_at_the_origin_in_child_order() {
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
        // `a` and `b` share the main scope, `c` is alone in the scope of `a`.
        assert_eq!(pos(&g, "a"), Position { x: 0.0, y: 0.0 });
        assert_eq!(pos(&g, "b").y, 0.0);
        assert_eq!(pos(&g, "b").x, NODE_WIDTH + SIBLING_GAP);
        assert_eq!(pos(&g, "c"), Position { x: 0.0, y: 0.0 });
    }

    #[test]
    fn a_large_scope_wraps_into_rows_about_as_wide_as_a_screen() {
        let mut nodes = vec![node("root", None), node("soc", None)];
        let mut links = vec![("root".to_string(), "soc".to_string())];
        for i in 0..494 {
            nodes.push(node(&format!("dev{i}"), Some(&format!("{i:x}"))));
            links.push(("soc".into(), format!("dev{i}")));
        }
        let links: Vec<(&str, &str)> = links
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let mut g = graph(nodes, &links);
        auto_layout(&mut g);
        assert_no_overlap(&g);
        let right = g
            .nodes
            .iter()
            .map(|n| n.position.x + NODE_WIDTH)
            .fold(0.0, f32::max);
        let bottom = g
            .nodes
            .iter()
            .map(|n| n.position.y + NODE_HEIGHT)
            .fold(0.0, f32::max);
        let ratio = right / bottom;
        assert!((1.0..2.5).contains(&ratio), "{right} x {bottom}");
        // No frame around the bus: the scope already is the bus.
        assert!(g.groups.is_empty());
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
        assert_no_overlap(&g);
        let once = g.clone();
        auto_layout(&mut g);
        assert_eq!(g, once);
    }

    #[test]
    fn drops_the_bus_frames_of_older_versions() {
        let mut g = graph(
            vec![
                node("root", None),
                node("soc", None),
                node("uart", Some("1000")),
            ],
            &[("root", "soc"), ("soc", "uart")],
        );
        let frame = |id: &str, subgroups| Group {
            id: id.into(),
            title: id.into(),
            members: vec!["uart".into()],
            subgroups,
            position: Position::default(),
            size: None,
            collapsed: false,
        };
        g.groups = vec![
            frame("bus:soc", vec![]),
            frame("g1", vec![frame("bus:i2c", vec![])]),
        ];
        auto_layout(&mut g);
        assert_eq!(g.groups.len(), 1);
        assert_eq!(g.groups[0].id, "g1");
        assert!(g.groups[0].subgroups.is_empty());
    }

    #[test]
    fn keeps_user_groups_as_blocks() {
        let mut g = graph(
            vec![
                node("root", None),
                node("a", None),
                node("b", None),
                node("c", None),
                node("d", None),
            ],
            &[("root", "a"), ("root", "b"), ("root", "c"), ("root", "d")],
        );
        let user = Group {
            id: "g1".into(),
            title: "mine".into(),
            members: vec!["b".into(), "d".into()],
            subgroups: vec![],
            position: Position::default(),
            size: None,
            collapsed: false,
        };
        g.groups = vec![user.clone()];
        auto_layout(&mut g);
        auto_layout(&mut g);
        // The user group keeps its identity and members and wraps them again.
        assert_eq!(g.groups.len(), 1);
        assert_eq!(g.groups[0].members, user.members);
        let (gp, gs) = (g.groups[0].position, g.groups[0].size.unwrap());
        for id in ["b", "d"] {
            let p = pos(&g, id);
            assert!(p.x > gp.x && p.y > gp.y);
            assert!(p.x + NODE_WIDTH < gp.x + gs.width && p.y + NODE_HEIGHT < gp.y + gs.height);
        }
        // Nodes outside the group stay outside its frame.
        for id in ["a", "c"] {
            let p = pos(&g, id);
            let inside = p.x + NODE_WIDTH > gp.x
                && p.x < gp.x + gs.width
                && p.y + NODE_HEIGHT > gp.y
                && p.y < gp.y + gs.height;
            assert!(!inside, "{id} is inside the group");
        }
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
        assert_no_overlap(&g);
    }
}
