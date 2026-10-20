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
    #[error("node `{0}` has more than one parent")]
    MultipleParents(String),
    #[error("node `{0}` is not attached to the root")]
    Detached(String),
    #[error("reference target `{0}` has no label")]
    UnlabeledTarget(String),
    #[error("duplicate label `{0}`")]
    DuplicateLabel(String),
    #[error("property `{property}` of node `{node}` references unknown node `{target}`")]
    UnknownReference {
        node: String,
        property: String,
        target: String,
    },
}

/// Checks structural rules that must hold before DTS can be generated.
/// Returns every problem found rather than stopping at the first one, so the
/// editor can highlight them all.
pub fn validate(graph: &Graph) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    let mut ids = HashSet::new();
    for node in &graph.nodes {
        if !ids.insert(&node.id) {
            errors.push(ValidationError::DuplicateId(node.id.0.clone()));
        }
    }

    let mut labels = HashSet::new();
    for label in graph.nodes.iter().filter_map(|n| n.label.as_ref()) {
        if !labels.insert(label) {
            errors.push(ValidationError::DuplicateLabel(label.clone()));
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
                    errors.push(ValidationError::MultipleParents(edge.to.0.clone()));
                }
            }
            EdgeKind::Reference { .. } => {
                if graph.node(&edge.to).is_some_and(|n| n.label.is_none()) {
                    errors.push(ValidationError::UnlabeledTarget(edge.to.0.clone()));
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
            errors.push(ValidationError::Detached(node.id.0.clone()));
        }
    }

    check_value_references(graph, &labels, &mut errors);
    errors
}

/// References inside `Mixed` values must name an existing label or path.
fn check_value_references(
    graph: &Graph,
    labels: &HashSet<&String>,
    errors: &mut Vec<ValidationError>,
) {
    let mut paths: Option<HashSet<String>> = None;
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
                let known = if target.starts_with('/') {
                    paths
                        .get_or_insert_with(|| node_paths(graph))
                        .contains(target)
                } else {
                    labels.contains(target)
                };
                if !known {
                    errors.push(ValidationError::UnknownReference {
                        node: node.id.0.clone(),
                        property: property.name.clone(),
                        target: target.clone(),
                    });
                }
            }
        }
    }
}

/// Full paths of the nodes attached to the root, such as `/soc/serial@1000`.
fn node_paths(graph: &Graph) -> HashSet<String> {
    let mut children: HashMap<&NodeId, Vec<&NodeId>> = HashMap::new();
    for edge in graph.edges.iter().filter(|e| e.kind == EdgeKind::Child) {
        children.entry(&edge.from).or_default().push(&edge.to);
    }
    let nodes: HashMap<&NodeId, &Node> = graph.nodes.iter().map(|n| (&n.id, n)).collect();

    let mut paths = HashSet::new();
    let mut visited = HashSet::new();
    let mut stack: Vec<(&NodeId, String)> = graph
        .root()
        .map(|root| (&root.id, String::new()))
        .into_iter()
        .collect();
    while let Some((id, path)) = stack.pop() {
        // Nodes with several parents or in cycles are reported elsewhere.
        if !visited.insert(id) {
            continue;
        }
        for child in children.get(id).into_iter().flatten() {
            if let Some(node) = nodes.get(child) {
                stack.push((child, format!("{path}/{}", node.full_name())));
            }
        }
        paths.insert(if path.is_empty() { "/".into() } else { path });
    }
    paths
}
