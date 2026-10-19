//! Builds the DesignTree element library from the devicetree binding
//! schemas shipped with the Linux kernel
//! (`Documentation/devicetree/bindings/**/*.yaml`, dt-schema format).
//!
//! The indexer is intentionally lenient: kernel schemas use the full JSON
//! Schema vocabulary, and we only extract what the editor needs to offer a
//! node in its palette (compatible strings, properties, required list).
//! Files that fail to parse are reported, not fatal.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_norway::Value;
use thiserror::Error;
use walkdir::WalkDir;

/// Location of the binding schemas inside a kernel source tree.
pub const BINDINGS_DIR: &str = "Documentation/devicetree/bindings";

#[derive(Debug, Error)]
pub enum IndexError {
    #[error("`{0}` does not look like a Linux source tree (missing {BINDINGS_DIR})")]
    NotAKernelTree(PathBuf),
    #[error("failed to read {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse {path}: {source}")]
    Yaml {
        path: PathBuf,
        source: serde_norway::Error,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PropertySpec {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub required: bool,
}

/// One entry of the element library, derived from one schema file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Binding {
    /// Path relative to the bindings directory, e.g. `serial/8250.yaml`.
    pub path: String,
    /// Library category, taken from the first directory component (`serial`).
    pub category: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub compatibles: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<PropertySpec>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Catalog {
    pub bindings: Vec<Binding>,
    /// Files that could not be indexed, with the reason.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<(String, String)>,
}

impl Catalog {
    /// Finds the binding that documents a compatible string.
    pub fn find_compatible(&self, compatible: &str) -> Option<&Binding> {
        self.bindings
            .iter()
            .find(|b| b.compatibles.iter().any(|c| c == compatible))
    }
}

/// Indexes every binding schema of a kernel source tree.
pub fn index_kernel_tree(linux_src: &Path) -> Result<Catalog, IndexError> {
    let root = linux_src.join(BINDINGS_DIR);
    if !root.is_dir() {
        return Err(IndexError::NotAKernelTree(linux_src.to_path_buf()));
    }
    index_dir(&root)
}

/// Indexes every `*.yaml` schema below `root`.
pub fn index_dir(root: &Path) -> Result<Catalog, IndexError> {
    let mut catalog = Catalog::default();
    let mut files: Vec<_> = WalkDir::new(root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "yaml"))
        .collect();
    files.sort();

    for path in files {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        match parse_schema_file(&path, &rel) {
            Ok(Some(binding)) => catalog.bindings.push(binding),
            Ok(None) => {}
            Err(err) => catalog.skipped.push((rel, err.to_string())),
        }
    }
    Ok(catalog)
}

fn parse_schema_file(path: &Path, rel: &str) -> Result<Option<Binding>, IndexError> {
    let text = fs::read_to_string(path).map_err(|source| IndexError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let doc: Value = serde_norway::from_str(&text).map_err(|source| IndexError::Yaml {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(parse_schema(&doc, rel))
}

/// Extracts a [`Binding`] from a parsed schema. Returns `None` for documents
/// that are not dt-schema bindings (e.g. helper files without `$id`).
pub fn parse_schema(doc: &Value, rel: &str) -> Option<Binding> {
    doc.get("$id")?;

    let required: Vec<String> = doc
        .get("required")
        .and_then(Value::as_sequence)
        .map(|seq| {
            seq.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();

    let mut compatibles = Vec::new();
    let mut properties = Vec::new();
    if let Some(props) = doc.get("properties").and_then(Value::as_mapping) {
        for (key, spec) in props {
            let Some(name) = key.as_str() else { continue };
            if name == "compatible" {
                collect_strings(spec, &mut compatibles);
            }
            properties.push(PropertySpec {
                name: name.to_owned(),
                description: spec
                    .get("description")
                    .and_then(Value::as_str)
                    .map(|s| s.trim().to_owned()),
                required: required.iter().any(|r| r == name),
            });
        }
    }
    compatibles.sort();
    compatibles.dedup();

    Some(Binding {
        path: rel.to_owned(),
        category: rel
            .split('/')
            .next()
            .filter(|_| rel.contains('/'))
            .unwrap_or("misc")
            .to_owned(),
        title: doc
            .get("title")
            .and_then(Value::as_str)
            .map(|s| s.trim().to_owned()),
        compatibles,
        properties,
    })
}

/// Collects every literal string reachable through `const`, `enum`, `items`,
/// `oneOf`, `anyOf` and `allOf` inside a `compatible` schema.
fn collect_strings(spec: &Value, out: &mut Vec<String>) {
    match spec {
        Value::Mapping(map) => {
            for (key, value) in map {
                match key.as_str() {
                    Some("const") => out.extend(value.as_str().map(str::to_owned)),
                    Some("enum") => {
                        if let Some(seq) = value.as_sequence() {
                            out.extend(seq.iter().filter_map(Value::as_str).map(str::to_owned));
                        }
                    }
                    Some("items" | "oneOf" | "anyOf" | "allOf" | "contains") => {
                        collect_strings(value, out)
                    }
                    _ => {}
                }
            }
        }
        Value::Sequence(seq) => seq.iter().for_each(|v| collect_strings(v, out)),
        _ => {}
    }
}
