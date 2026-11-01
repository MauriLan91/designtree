//! Overlay designs: a base design whose nodes are all inherited, so that
//! export writes only what the overlay adds or changes, as a `.dtso`.

use std::collections::HashMap;
use std::path::Path;

use thiserror::Error;

use crate::import::{import_dts_file, ImportError};
use crate::model::{
    Cell, EdgeKind, Graph, Inherited, NodeId, Overlay, Property, PropertyValue, ValueChunk,
};
use crate::preprocess::ImportOptions;

#[derive(Debug, Error)]
pub enum OverlayError {
    #[error("cannot read {path}: {source}")]
    Read {
        path: String,
        source: std::io::Error,
    },
    #[error("cannot parse {path}: {source}")]
    Parse {
        path: String,
        source: serde_json::Error,
    },
    #[error(transparent)]
    Import(#[from] ImportError),
}

/// A new overlay for the base at `path`: a design file (`.json`) or
/// devicetree source, imported with `options`.
pub fn new_overlay(path: &Path, options: &ImportOptions) -> Result<Graph, OverlayError> {
    let shown = path.display().to_string();
    let is_design = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    let base = if is_design {
        let text = std::fs::read_to_string(path).map_err(|source| OverlayError::Read {
            path: shown.clone(),
            source,
        })?;
        serde_json::from_str(&text).map_err(|source| OverlayError::Parse {
            path: shown.clone(),
            source,
        })?
    } else {
        import_dts_file(path, options)?
    };
    let name = path
        .file_name()
        .map_or(shown, |n| n.to_string_lossy().into_owned());
    Ok(overlay_on(&base, &name))
}

/// A new overlay for `base`. Every node of the base becomes inherited from
/// `base_file`, with its labels and properties as the base defines them;
/// the overlay starts with no changes.
pub fn overlay_on(base: &Graph, base_file: &str) -> Graph {
    let labels: HashMap<&NodeId, &String> = base
        .nodes
        .iter()
        .filter_map(|n| Some((&n.id, n.label.as_ref()?)))
        .collect();
    let mut references: HashMap<&NodeId, Vec<_>> = HashMap::new();
    for edge in &base.edges {
        if let EdgeKind::Reference { property, args } = &edge.kind {
            references
                .entry(&edge.from)
                .or_default()
                .push((property, args, &edge.to));
        }
    }
    let mut graph = base.clone();
    for node in &mut graph.nodes {
        let mut properties = Vec::new();
        if !node.compatible.is_empty() {
            properties.push(Property {
                name: "compatible".into(),
                value: PropertyValue::Strings(node.compatible.clone()),
            });
        }
        properties.extend(node.properties.iter().cloned());
        // Phandle lists, written the way an import keeps inherited ones.
        let mut lists: Vec<(String, Vec<ValueChunk>)> = Vec::new();
        for &(property, args, to) in references.get(&node.id).into_iter().flatten() {
            let Some(target) = labels.get(to) else {
                continue;
            };
            let chunk = ValueChunk::Cells {
                bits: 32,
                cells: std::iter::once(Cell::Phandle {
                    phandle: (*target).clone(),
                })
                .chain(args.iter().map(|a| Cell::Number((*a).into())))
                .collect(),
            };
            match lists.iter_mut().find(|(p, _)| p == property) {
                Some((_, chunks)) => chunks.push(chunk),
                None => lists.push((property.clone(), vec![chunk])),
            }
        }
        properties.extend(lists.into_iter().map(|(name, chunks)| Property {
            name,
            value: PropertyValue::Mixed(chunks),
        }));
        node.inherited = Some(Inherited {
            file: base_file.to_owned(),
            labels: node.labels().cloned().collect(),
            properties,
            omit_if_no_ref: node.omit_if_no_ref,
        });
    }
    for reserve in &mut graph.memreserves {
        reserve.inherited = true;
    }
    graph.includes.clear();
    graph.trailing_includes.clear();
    graph.deleted_nodes.clear();
    graph.overlay = Some(Overlay {
        base: base_file.to_owned(),
    });
    graph
}
