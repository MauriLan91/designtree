use std::collections::{HashMap, HashSet};

use thiserror::Error;

use crate::model::{Cell, EdgeKind, Graph, Node, NodeId, PropertyValue, ValueChunk};

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ValidationError {
    #[error("the design has no root node `/`")]
    MissingRoot,
    #[error("the design has more than one root node")]
    MultipleRoots,
    #[error("duplicate node id `{0}`")]
    DuplicateId(String),
    #[error("edge references unknown node `{0}`")]
    UnknownNode(String),
    // `path` is how messages name a node: its path when it is attached to
    // the root, else its own name. `node` is its id, for the editor.
    #[error("node `{path}` has more than one parent")]
    MultipleParents { node: NodeId, path: String },
    #[error("node `{path}` is not attached to the root")]
    Detached { node: NodeId, path: String },
    #[error("reference target `{path}` has no label")]
    UnlabeledTarget { node: NodeId, path: String },
    #[error("duplicate label `{label}` (on `{path}`)")]
    DuplicateLabel {
        node: NodeId,
        path: String,
        label: String,
    },
    #[error("property `{property}` of node `{path}` references unknown node `{target}`")]
    UnknownReference {
        node: NodeId,
        path: String,
        property: String,
        target: String,
    },
    /// A reference value whose node is not picked yet (US-17.5).
    #[error("property `{property}` of node `{path}` does not name a node yet")]
    MissingReference {
        node: NodeId,
        path: String,
        property: String,
    },
    /// What dtc's grammar would refuse, so the editor can say it before a build.
    #[error("node `{path}`: `{name}` is not a valid {what}")]
    InvalidName {
        node: NodeId,
        path: String,
        what: NameKind,
        name: String,
    },
    #[error("node `{path}` has the property `{property}` more than once")]
    DuplicateProperty {
        node: NodeId,
        path: String,
        property: String,
    },
    #[error("node `{path}` has more than one child named `{name}`")]
    DuplicateChild {
        node: NodeId,
        path: String,
        name: String,
    },
    /// Overlays are applied to a compiled base, so they can only add.
    #[error("`{path}`: an overlay cannot {what}")]
    OverlayCannot {
        node: NodeId,
        path: String,
        what: String,
    },
}

impl ValidationError {
    /// The node the error is about, when there is one.
    pub fn node(&self) -> Option<&NodeId> {
        use ValidationError::*;
        match self {
            MissingRoot | MultipleRoots | DuplicateId(_) | UnknownNode(_) => None,
            MultipleParents { node, .. }
            | Detached { node, .. }
            | UnlabeledTarget { node, .. }
            | DuplicateLabel { node, .. }
            | UnknownReference { node, .. }
            | MissingReference { node, .. }
            | InvalidName { node, .. }
            | DuplicateProperty { node, .. }
            | DuplicateChild { node, .. }
            | OverlayCannot { node, .. } => Some(node),
        }
    }
}

/// The kind of name an [`ValidationError::InvalidName`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameKind {
    NodeName,
    UnitAddress,
    Label,
    Property,
}

impl std::fmt::Display for NameKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            NameKind::NodeName => "node name",
            NameKind::UnitAddress => "unit address",
            NameKind::Label => "label",
            NameKind::Property => "property name",
        })
    }
}

impl NameKind {
    /// Whether dtc's lexer reads `name` as one name of this kind.
    pub fn accepts(self, name: &str) -> bool {
        let mut chars = name.chars();
        match self {
            NameKind::Label => {
                chars
                    .next()
                    .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
                    && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
            }
            NameKind::NodeName | NameKind::UnitAddress => {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || ",._+-".contains(c))
            }
            NameKind::Property => {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || ",._+?#-".contains(c))
            }
        }
    }
}

/// Checks structural rules that must hold before DTS can be generated.
/// Returns every problem found rather than stopping at the first one, so the
/// editor can highlight them all.
pub fn validate(graph: &Graph) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    let paths = node_paths(graph);
    let path_of = |id: &NodeId| -> String {
        paths
            .get(id)
            .cloned()
            .or_else(|| graph.node(id).map(Node::full_name))
            .unwrap_or_else(|| id.0.clone())
    };

    let mut ids = HashSet::new();
    for node in &graph.nodes {
        if !ids.insert(&node.id) {
            errors.push(ValidationError::DuplicateId(node.id.0.clone()));
        }
    }

    let mut labels = HashSet::new();
    for node in &graph.nodes {
        for label in node.labels() {
            if !labels.insert(label) {
                errors.push(ValidationError::DuplicateLabel {
                    node: node.id.clone(),
                    path: path_of(&node.id),
                    label: label.clone(),
                });
            }
        }
    }

    match graph.nodes.iter().filter(|n| n.is_root()).count() {
        0 => errors.push(ValidationError::MissingRoot),
        1 => {}
        _ => errors.push(ValidationError::MultipleRoots),
    }

    let mut parent: HashMap<&NodeId, &NodeId> = HashMap::new();
    for edge in &graph.edges {
        for end in [&edge.from, &edge.to] {
            if !ids.contains(end) {
                errors.push(ValidationError::UnknownNode(end.0.clone()));
            }
        }
        match &edge.kind {
            EdgeKind::Child => {
                if parent.insert(&edge.to, &edge.from).is_some() {
                    errors.push(ValidationError::MultipleParents {
                        node: edge.to.clone(),
                        path: path_of(&edge.to),
                    });
                }
            }
            EdgeKind::Reference { .. } => {
                if graph.node(&edge.to).is_some_and(|n| n.label.is_none()) {
                    errors.push(ValidationError::UnlabeledTarget {
                        node: edge.to.clone(),
                        path: path_of(&edge.to),
                    });
                }
            }
        }
    }

    // Every non-root node must reach the root through parent links; this also
    // catches cycles in the hierarchy.
    for node in graph.nodes.iter().filter(|n| !n.is_root()) {
        let mut seen = HashSet::new();
        let mut current = &node.id;
        let attached = loop {
            if !seen.insert(current) {
                break false;
            }
            match parent.get(current) {
                Some(p) if graph.node(p).is_some_and(|n| n.is_root()) => break true,
                Some(p) => current = p,
                None => break false,
            }
        };
        if !attached {
            errors.push(ValidationError::Detached {
                node: node.id.clone(),
                path: path_of(&node.id),
            });
        }
    }

    check_names(graph, &path_of, &mut errors);
    check_duplicates(graph, &path_of, &mut errors);
    check_value_references(graph, &labels, &paths, &path_of, &mut errors);
    if graph.overlay.is_some() {
        check_overlay(graph, &path_of, &mut errors);
    }
    errors
}

/// Names dtc would not parse. Inherited nodes come from parsed source, but
/// a design file can still hold anything.
fn check_names(
    graph: &Graph,
    path_of: &dyn Fn(&NodeId) -> String,
    errors: &mut Vec<ValidationError>,
) {
    for node in &graph.nodes {
        let mut check = |what: NameKind, name: &str| {
            if !what.accepts(name) {
                errors.push(ValidationError::InvalidName {
                    node: node.id.clone(),
                    path: path_of(&node.id),
                    what,
                    name: name.to_owned(),
                });
            }
        };
        if !node.is_root() {
            check(NameKind::NodeName, &node.name);
        }
        if let Some(unit) = &node.unit_address {
            check(NameKind::UnitAddress, unit);
        }
        for label in node.labels() {
            check(NameKind::Label, label);
        }
        for property in &node.properties {
            check(NameKind::Property, &property.name);
        }
    }
}

/// Two properties of a node with one name, counting `compatible` and the
/// phandle lists drawn as edges, and siblings with one `name@unit`: dtc
/// refuses both.
fn check_duplicates(
    graph: &Graph,
    path_of: &dyn Fn(&NodeId) -> String,
    errors: &mut Vec<ValidationError>,
) {
    let mut references: HashMap<&NodeId, HashSet<&str>> = HashMap::new();
    let mut children: HashMap<&NodeId, Vec<&NodeId>> = HashMap::new();
    for edge in &graph.edges {
        match &edge.kind {
            EdgeKind::Reference { property, .. } => {
                references.entry(&edge.from).or_default().insert(property);
            }
            EdgeKind::Child => children.entry(&edge.from).or_default().push(&edge.to),
        }
    }
    for node in &graph.nodes {
        let mut seen = HashSet::new();
        if !node.compatible.is_empty() {
            seen.insert("compatible");
        }
        let refs = references.get(&node.id);
        let mut reported = HashSet::new();
        for property in &node.properties {
            let name = property.name.as_str();
            let twice = !seen.insert(name) || refs.is_some_and(|r| r.contains(name));
            if twice && reported.insert(name) {
                errors.push(ValidationError::DuplicateProperty {
                    node: node.id.clone(),
                    path: path_of(&node.id),
                    property: name.to_owned(),
                });
            }
        }
        let mut names = HashSet::new();
        let mut reported = HashSet::new();
        for child in children.get(&node.id).into_iter().flatten() {
            let Some(child) = graph.node(child) else {
                continue;
            };
            let name = child.full_name();
            if !names.insert(name.clone()) && reported.insert(name.clone()) {
                errors.push(ValidationError::DuplicateChild {
                    node: node.id.clone(),
                    path: path_of(&node.id),
                    name,
                });
            }
        }
    }
}

/// What an overlay cannot express: deleting from its base, labeling base
/// nodes or referencing them by path (only labels reach the base, through
/// its `__symbols__`), adding `/memreserve/`s and changing
/// `/omit-if-no-ref/`.
fn check_overlay(
    graph: &Graph,
    path_of: &dyn Fn(&NodeId) -> String,
    errors: &mut Vec<ValidationError>,
) {
    let referenced: HashSet<(&NodeId, &str)> = graph
        .edges
        .iter()
        .filter_map(|e| match &e.kind {
            EdgeKind::Reference { property, .. } => Some((&e.from, property.as_str())),
            EdgeKind::Child => None,
        })
        .collect();
    let mut cannot = |node: &NodeId, path: String, what: String| {
        errors.push(ValidationError::OverlayCannot {
            node: node.clone(),
            path,
            what,
        })
    };
    let root = graph
        .root()
        .map(|r| r.id.clone())
        .unwrap_or_else(|| "/".into());
    for target in &graph.deleted_nodes {
        cannot(&root, target.clone(), "delete a node of its base".into());
    }
    if graph.memreserves.iter().any(|r| !r.inherited) {
        cannot(&root, "/".into(), "add /memreserve/ entries".into());
    }
    for node in &graph.nodes {
        let Some(base) = &node.inherited else {
            continue;
        };
        let id = &node.id;
        let path = path_of(id);
        for label in node.labels().filter(|l| !base.labels.contains(l)) {
            cannot(
                id,
                path.clone(),
                format!("add the label `{label}` to a node of its base"),
            );
        }
        let present = |name: &str| {
            (name == "compatible" && !node.compatible.is_empty())
                || node.properties.iter().any(|p| p.name == name)
                || referenced.contains(&(&node.id, name))
        };
        for property in base.properties.iter().filter(|p| !present(&p.name)) {
            cannot(
                id,
                path.clone(),
                format!("delete the property `{}`", property.name),
            );
        }
        if node.omit_if_no_ref != base.omit_if_no_ref {
            cannot(
                id,
                path,
                "change /omit-if-no-ref/ on a node of its base".into(),
            );
        }
    }
    // Values the overlay writes: those of its own nodes and changed ones.
    for node in &graph.nodes {
        let base = node.inherited.as_ref().map(|b| b.properties.as_slice());
        for property in &node.properties {
            if base.is_some_and(|b| b.contains(property)) {
                continue;
            }
            let PropertyValue::Mixed(chunks) = &property.value else {
                continue;
            };
            let by_path = chunks.iter().any(|chunk| match chunk {
                ValueChunk::Path { .. } => true,
                ValueChunk::Cells { cells, .. } => cells
                    .iter()
                    .any(|c| matches!(c, Cell::Phandle { phandle } if phandle.starts_with('/'))),
                _ => false,
            });
            if by_path {
                cannot(
                    &node.id,
                    path_of(&node.id),
                    format!(
                        "reference a node by path (`{}`); use its label",
                        property.name
                    ),
                );
            }
        }
    }
}

/// References inside `Mixed` values must name an existing label or path.
fn check_value_references(
    graph: &Graph,
    labels: &HashSet<&String>,
    paths: &HashMap<NodeId, String>,
    path_of: &dyn Fn(&NodeId) -> String,
    errors: &mut Vec<ValidationError>,
) {
    let mut known_paths: Option<HashSet<&String>> = None;
    for node in &graph.nodes {
        for property in &node.properties {
            let PropertyValue::Mixed(chunks) = &property.value else {
                continue;
            };
            let targets = chunks.iter().flat_map(|chunk| match chunk {
                ValueChunk::Path { target } => vec![target],
                ValueChunk::Cells { cells, .. } => cells
                    .iter()
                    .filter_map(|c| match c {
                        Cell::Phandle { phandle } => Some(phandle),
                        Cell::Number(_) => None,
                    })
                    .collect(),
                _ => vec![],
            });
            for target in targets {
                if target.is_empty() {
                    errors.push(ValidationError::MissingReference {
                        node: node.id.clone(),
                        path: path_of(&node.id),
                        property: property.name.clone(),
                    });
                    continue;
                }
                let known = if target.starts_with('/') {
                    known_paths
                        .get_or_insert_with(|| paths.values().collect())
                        .contains(target)
                } else {
                    labels.contains(target)
                };
                if !known {
                    errors.push(ValidationError::UnknownReference {
                        node: node.id.clone(),
                        path: path_of(&node.id),
                        property: property.name.clone(),
                        target: target.clone(),
                    });
                }
            }
        }
    }
}

/// Full path of each node attached to the root, such as
/// `/soc/serial@1000`.
pub(crate) fn node_paths(graph: &Graph) -> HashMap<NodeId, String> {
    let mut children: HashMap<&NodeId, Vec<&NodeId>> = HashMap::new();
    for edge in graph.edges.iter().filter(|e| e.kind == EdgeKind::Child) {
        children.entry(&edge.from).or_default().push(&edge.to);
    }
    let nodes: HashMap<&NodeId, &Node> = graph.nodes.iter().map(|n| (&n.id, n)).collect();

    let mut paths = HashMap::new();
    let mut stack: Vec<(&NodeId, String)> = graph
        .root()
        .map(|root| (&root.id, String::new()))
        .into_iter()
        .collect();
    while let Some((id, path)) = stack.pop() {
        // Nodes with several parents or in cycles are reported elsewhere.
        if paths.contains_key(id) {
            continue;
        }
        for child in children.get(id).into_iter().flatten() {
            if let Some(node) = nodes.get(child) {
                stack.push((child, format!("{path}/{}", node.full_name())));
            }
        }
        paths.insert(id.clone(), if path.is_empty() { "/".into() } else { path });
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Edge, Property};

    fn node(id: &str, name: &str) -> Node {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "name": name,
            "position": { "x": 0.0, "y": 0.0 },
        }))
        .unwrap()
    }

    fn child(from: &str, to: &str) -> Edge {
        Edge {
            from: from.into(),
            to: to.into(),
            kind: EdgeKind::Child,
            route: None,
        }
    }

    fn graph(nodes: Vec<Node>) -> Graph {
        let edges = nodes
            .iter()
            .filter(|n| !n.is_root())
            .map(|n| child("root", &n.id.0))
            .collect();
        Graph {
            nodes,
            edges,
            ..Default::default()
        }
    }

    fn flag(name: &str) -> Property {
        Property {
            name: name.into(),
            value: PropertyValue::Empty,
        }
    }

    #[test]
    fn names_dtc_would_refuse_are_reported_on_their_node() {
        let mut leds = node("n1", "my leds}");
        leds.label = Some("led-0".into());
        leds.unit_address = Some("1 0".into());
        leds.properties = vec![flag("bad prop"), flag("#gpio-cells"), flag("linux,code?")];
        let errors = validate(&graph(vec![node("root", "/"), leds]));
        let invalid: Vec<_> = errors
            .iter()
            .filter_map(|e| match e {
                ValidationError::InvalidName { what, name, .. } => Some((*what, name.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(
            invalid,
            [
                (NameKind::NodeName, "my leds}"),
                (NameKind::UnitAddress, "1 0"),
                (NameKind::Label, "led-0"),
                (NameKind::Property, "bad prop"),
            ]
        );
        assert_eq!(errors[0].node(), Some(&NodeId::from("n1")));
        assert_eq!(
            errors[0].to_string(),
            "node `/my leds}@1 0`: `my leds}` is not a valid node name"
        );
        assert!(NameKind::Label.accepts("_osc24M"));
        assert!(!NameKind::Label.accepts("0osc"));
        assert!(!NameKind::NodeName.accepts("serial@0"));
    }

    #[test]
    fn an_empty_label_in_a_design_file_is_no_label() {
        let node: Node = serde_json::from_value(serde_json::json!({
            "id": "osc", "name": "oscillator", "label": "",
            "position": { "x": 0.0, "y": 0.0 },
        }))
        .unwrap();
        assert_eq!(node.label, None);
    }

    #[test]
    fn duplicate_properties_and_siblings_are_reported() {
        let mut gpio = node("gpio", "gpio");
        gpio.compatible = vec!["opencores,gpio".into()];
        gpio.properties = vec![
            flag("compatible"),
            flag("clocks"),
            flag("ready"),
            flag("ready"),
        ];
        let mut a = node("a", "serial");
        a.unit_address = Some("1c28000".into());
        let mut b = a.clone();
        b.id = "b".into();
        let mut osc = node("osc", "osc");
        osc.label = Some("osc".into());
        let mut g = graph(vec![node("root", "/"), gpio, a, b, osc]);
        g.edges.push(Edge {
            from: "gpio".into(),
            to: "osc".into(),
            kind: EdgeKind::Reference {
                property: "clocks".into(),
                args: vec![],
            },
            route: None,
        });
        let messages: Vec<_> = validate(&g).iter().map(ToString::to_string).collect();
        assert_eq!(
            messages,
            [
                "node `/` has more than one child named `serial@1c28000`",
                "node `/gpio` has the property `compatible` more than once",
                "node `/gpio` has the property `clocks` more than once",
                "node `/gpio` has the property `ready` more than once",
            ]
        );
    }

    #[test]
    fn messages_name_nodes_by_path_not_id() {
        let mut aliases = node("nmwb5q1xxk", "aliases");
        aliases.properties = vec![Property {
            name: "serial0".into(),
            value: PropertyValue::Mixed(vec![ValueChunk::Path {
                target: "uart0".into(),
            }]),
        }];
        let errors = validate(&graph(vec![node("root", "/"), aliases]));
        assert_eq!(
            errors[0].to_string(),
            "property `serial0` of node `/aliases` references unknown node `uart0`"
        );
        assert_eq!(errors[0].node(), Some(&NodeId::from("nmwb5q1xxk")));

        let lost = validate(&Graph {
            nodes: vec![node("root", "/"), node("x1", "led-0")],
            ..Default::default()
        });
        assert_eq!(
            lost[0].to_string(),
            "node `led-0` is not attached to the root"
        );
    }
}
