use std::collections::{HashMap, HashSet};

use thiserror::Error;

use crate::model::{EdgeKind, Graph, NodeId};

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

    errors
}
