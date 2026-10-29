//! Builds the DesignTree element library from the devicetree binding
//! schemas shipped with the Linux kernel
//! (`Documentation/devicetree/bindings/**/*.yaml`, dt-schema format).
//!
//! The indexer is intentionally lenient: kernel schemas use the full JSON
//! Schema vocabulary, and we only extract what the editor needs to offer a
//! node in its palette (compatible strings, typed properties, required
//! list). Property types are resolved through `$ref` and `allOf` into the
//! kernel schemas and the dt-schema core schemas (`/schemas/types.yaml`),
//! which are embedded because the kernel tree does not ship them.
//! Files that fail to parse are reported, not fatal.

mod macros;
mod resolve;

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub use macros::{index_dt_macros, DtMacro};
use serde::{Deserialize, Serialize};
use serde_norway::Value;
use thiserror::Error;
use ts_rs::TS;
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

/// A property value type: the definitions of dt-schema's `types.yaml`,
/// plus `node` for a child node that shares the property namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum PropertyType {
    Flag,
    String,
    StringArray,
    NonUniqueStringArray,
    Uint8,
    Uint8Array,
    Uint8Matrix,
    Int8,
    Int8Array,
    Int8Matrix,
    Uint16,
    Uint16Array,
    Uint16Matrix,
    Int16,
    Int16Array,
    Int16Matrix,
    Uint32,
    Uint32Array,
    Uint32Matrix,
    Int32,
    Int32Array,
    Int32Matrix,
    Uint64,
    Uint64Array,
    Uint64Matrix,
    Int64,
    Int64Array,
    Int64Matrix,
    Phandle,
    PhandleArray,
    /// `reg`-style address and size cells.
    Address,
    Node,
}

impl PropertyType {
    /// The type named by a `types.yaml#/definitions/<name>` reference.
    pub fn from_definition(name: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(name.to_owned()))
            .ok()
            .filter(|ty| *ty != PropertyType::Node)
    }

    /// The array type whose items have this type (`uint32` gives
    /// `uint32-array`, `uint32-array` gives `uint32-matrix`).
    fn array_of(self) -> Option<Self> {
        use PropertyType::*;
        Some(match self {
            String => StringArray,
            Uint8 => Uint8Array,
            Uint8Array => Uint8Matrix,
            Int8 => Int8Array,
            Int8Array => Int8Matrix,
            Uint16 => Uint16Array,
            Uint16Array => Uint16Matrix,
            Int16 => Int16Array,
            Int16Array => Int16Matrix,
            Uint32 => Uint32Array,
            Uint32Array => Uint32Matrix,
            Int32 => Int32Array,
            Int32Array => Int32Matrix,
            Uint64 => Uint64Array,
            Uint64Array => Uint64Matrix,
            Int64 => Int64Array,
            Int64Array => Int64Matrix,
            Phandle => PhandleArray,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
pub struct PropertySpec {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub required: bool,
    /// Value type; `None` when the schemas do not pin one down.
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub ty: Option<PropertyType>,
    /// Allowed values, when the schema lists them.
    #[serde(rename = "enum", default, skip_serializing_if = "Vec::is_empty")]
    #[ts(type = "Array<unknown>", optional)]
    pub enum_values: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "unknown", optional)]
    pub default: Option<serde_json::Value>,
    /// Bounds of each number in the value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub minimum: Option<serde_json::Number>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub maximum: Option<serde_json::Number>,
    /// Bounds on the number of entries of an array value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub min_items: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub max_items: Option<u64>,
}

/// One entry of the element library, derived from one schema file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
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

    /// The G2 metrics of the backlog: how many schemas were indexed and how
    /// many of their properties have a resolved type.
    pub fn stats(&self) -> Stats {
        let properties = self.bindings.iter().flat_map(|b| &b.properties);
        Stats {
            bindings: self.bindings.len(),
            skipped: self.skipped.len(),
            properties: properties.clone().count(),
            typed: properties.filter(|p| p.ty.is_some()).count(),
        }
    }
}

/// Indexing coverage, see [`Catalog::stats`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stats {
    pub bindings: usize,
    pub skipped: usize,
    pub properties: usize,
    pub typed: usize,
}

impl Stats {
    /// Percentage of binding schemas indexed (G2 target: 95 %).
    pub fn indexed_percent(&self) -> f64 {
        percent(self.bindings, self.bindings + self.skipped)
    }

    /// Percentage of properties with a resolved type (G2 target: 90 %).
    pub fn typed_percent(&self) -> f64 {
        percent(self.typed, self.properties)
    }
}

/// An empty catalog counts as 0 %, so it never meets a target.
fn percent(part: usize, whole: usize) -> f64 {
    if whole == 0 {
        0.0
    } else {
        100.0 * part as f64 / whole as f64
    }
}

impl fmt::Display for Stats {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let mark = |ok: bool| if ok { "ok" } else { "below target" };
        writeln!(
            f,
            "schemas indexed:  {}/{} ({:.1} %, target 95 %: {})",
            self.bindings,
            self.bindings + self.skipped,
            self.indexed_percent(),
            mark(self.indexed_percent() >= 95.0)
        )?;
        write!(
            f,
            "properties typed: {}/{} ({:.1} %, target 90 %: {})",
            self.typed,
            self.properties,
            self.typed_percent(),
            mark(self.typed_percent() >= 90.0)
        )
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

    // Bindings refer to each other, so every file is read before any is
    // indexed.
    let mut docs = Vec::new();
    for path in files {
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        match read_schema(&path) {
            Ok(doc) => docs.push((rel, doc)),
            Err(err) => catalog.skipped.push((rel, err.to_string())),
        }
    }
    let schemas = resolve::Schemas::new(docs.iter().cloned());
    catalog.bindings = docs
        .iter()
        .filter_map(|(rel, doc)| binding(&schemas, doc, rel))
        .collect();
    Ok(catalog)
}

fn read_schema(path: &Path) -> Result<Value, IndexError> {
    let text = fs::read_to_string(path).map_err(|source| IndexError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    serde_norway::from_str(&text).map_err(|source| IndexError::Yaml {
        path: path.to_path_buf(),
        source,
    })
}

/// Extracts a [`Binding`] from a parsed schema. Returns `None` for
/// documents that are not dt-schema bindings (e.g. helper files without
/// `$id`).
fn binding(schemas: &resolve::Schemas, doc: &Value, rel: &str) -> Option<Binding> {
    doc.get("$id")?;

    let mut compatibles = Vec::new();
    if let Some(spec) = doc.get("properties").and_then(|p| p.get("compatible")) {
        collect_strings(spec, &mut compatibles);
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
        properties: schemas.properties(&format!("/schemas/{rel}"), doc),
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
