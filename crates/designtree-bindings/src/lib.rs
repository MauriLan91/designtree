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

mod check;
mod kernel;
mod macros;
mod resolve;
mod search;

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub use check::{parse_fdt, Checker, FdtError, FdtNode, SchemaProblem, SchemaSet};
pub use kernel::{index_kernel_tree_cached, kernel_version, CacheStatus};
pub use macros::{index_dt_macros, DtMacro};
pub use search::{Hit, LibraryEntry};
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
    /// The node name a new node gets, for the basic nodes the name defines
    /// (`/`, `cpus`, `memory@0`); `None` for a device binding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_name: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Catalog {
    pub bindings: Vec<Binding>,
    /// Files that could not be indexed, with the reason.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skipped: Vec<(String, String)>,
    /// The schemas processed for validation; see [`Checker`].
    #[serde(default, skip_serializing_if = "SchemaSet::is_empty")]
    pub schemas: SchemaSet,
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
    let core = resolve::core_docs();
    let schemas = resolve::Schemas::new(docs.iter().cloned(), core.iter().cloned());
    catalog.bindings = docs
        .iter()
        .filter_map(|(rel, doc)| binding(&schemas, doc, rel))
        .collect();
    // Kernel schemas first: they win over core schemas with the same `$id`.
    catalog.schemas = SchemaSet::new(
        docs.iter()
            .chain(&core)
            .map(|(rel, doc)| (rel.as_str(), doc)),
    );
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
        node_name: None,
    })
}

/// The category of the basic nodes in the library.
pub const BASIC_CATEGORY: &str = "basic";

/// The `/reserved-memory` container. dt-schema describes only its children,
/// so its own properties (devicetree specification 3.5) are written here.
const RESERVED_MEMORY: &str = r#"
$id: http://devicetree.org/schemas/designtree/reserved-memory-node.yaml#
description: Regions of memory kept from the operating system's normal use.
properties:
  '#address-cells': true
  '#size-cells': true
  ranges: true
required:
  - '#address-cells'
  - '#size-cells'
  - ranges
"#;

/// The basic devicetree nodes every board has (US-18.3): the root, `cpus`
/// and a `cpu`, `memory`, `chosen`, `aliases` and `reserved-memory`. They
/// carry no compatible, so the kernel's bindings do not list them; their
/// properties come from the dt-schema core schemas, so they are in the
/// library without a kernel.
pub fn basic_bindings() -> Vec<Binding> {
    // (core schema, pattern property holding the node, node name, title,
    // required properties the schema leaves to its parent's)
    type Basic = (
        &'static str,
        Option<&'static str>,
        &'static str,
        &'static str,
        &'static [&'static str],
    );
    const BASICS: &[Basic] = &[
        ("root-node.yaml", None, "/", "Root node", &[]),
        ("cpus.yaml", None, "cpus", "CPUs", &[]),
        // `cpus.yaml` requires these of its `cpu@N` children.
        ("cpu.yaml", None, "cpu@0", "CPU", &["device_type", "reg"]),
        ("memory.yaml", Some("^memory"), "memory@0", "Memory", &[]),
        ("chosen.yaml", None, "chosen", "Chosen", &[]),
        ("aliases.yaml", None, "aliases", "Aliases", &[]),
        (
            "designtree/reserved-memory-node.yaml",
            None,
            "reserved-memory",
            "Reserved memory",
            &[],
        ),
    ];
    let core = resolve::core_docs();
    let schemas = resolve::Schemas::new(std::iter::empty(), core.iter().cloned());
    let reserved: Value = serde_norway::from_str(RESERVED_MEMORY).expect("built-in schema parses");
    BASICS
        .iter()
        .filter_map(|&(rel, pattern, name, title, also_required)| {
            let doc = if rel.starts_with("designtree/") {
                &reserved
            } else {
                &core.iter().find(|(r, _)| r == rel)?.1
            };
            let node = match pattern {
                Some(prefix) => {
                    doc.get("patternProperties")?
                        .as_mapping()?
                        .iter()
                        .find(|(k, _)| k.as_str().is_some_and(|k| k.starts_with(prefix)))?
                        .1
                }
                None => doc,
            };
            let mut properties = schemas.properties(&format!("/schemas/{rel}"), node);
            // `$nodename` constrains the name, which the entry sets itself.
            properties.retain(|p| !p.name.starts_with('$'));
            for p in &mut properties {
                p.required |= also_required.contains(&p.name.as_str());
            }
            Some(Binding {
                path: format!("dtschema/{rel}"),
                category: BASIC_CATEGORY.to_owned(),
                title: Some(title.to_owned()),
                compatibles: Vec::new(),
                properties,
                node_name: Some(name.to_owned()),
            })
        })
        .collect()
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

#[cfg(test)]
mod basic_tests {
    use super::*;

    fn required(b: &Binding) -> Vec<&str> {
        b.properties
            .iter()
            .filter(|p| p.required)
            .map(|p| p.name.as_str())
            .collect()
    }

    #[test]
    fn basic_nodes_come_with_their_required_properties() {
        let basics = basic_bindings();
        let names: Vec<_> = basics
            .iter()
            .map(|b| b.node_name.as_deref().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "/",
                "cpus",
                "cpu@0",
                "memory@0",
                "chosen",
                "aliases",
                "reserved-memory"
            ]
        );
        let of = |name: &str| {
            basics
                .iter()
                .find(|b| b.node_name.as_deref() == Some(name))
                .unwrap()
        };
        assert_eq!(
            required(of("/")),
            ["model", "#address-cells", "#size-cells", "compatible"]
        );
        assert_eq!(required(of("cpu@0")), ["device_type", "reg"]);
        assert_eq!(required(of("memory@0")), ["device_type", "reg"]);
        assert_eq!(
            required(of("reserved-memory")),
            ["#address-cells", "#size-cells", "ranges"]
        );
        let device_type = of("memory@0")
            .properties
            .iter()
            .find(|p| p.name == "device_type")
            .unwrap();
        assert_eq!(device_type.enum_values, [serde_json::json!("memory")]);
        assert!(basics
            .iter()
            .all(|b| b.category == BASIC_CATEGORY && b.compatibles.is_empty()));
        assert!(basics
            .iter()
            .all(|b| b.properties.iter().all(|p| !p.name.starts_with('$'))));
    }
}
