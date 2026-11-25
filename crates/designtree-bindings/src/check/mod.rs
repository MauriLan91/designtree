//! Schema validation of devicetrees, as `make dtbs_check` does it.
//!
//! This is a port of dt-schema's validation: the bindings are processed
//! with its fixups ([`fixups`]), a property type database is built from
//! them ([`types`]), a devicetree blob is decoded with those types
//! ([`decode`]), and every node is validated against the schema of its
//! `compatible` and against every schema that selects itself (`select:`),
//! with a JSON Schema 2019-09 validator.
//!
//! The input is a devicetree blob, the same input `dt-validate` takes, so
//! that this crate needs nothing from the design model.
//!
//! `fixups`, `types` and `decode` are ports of dt-schema 2026.9 (Copyright
//! Linaro Ltd. and Arm Ltd., BSD-2-Clause; see `dtschema/LICENSE.txt`).

mod decode;
mod fdt;
mod fixups;
mod types;

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::sync::{Arc, RwLock};

use jsonschema::error::ValidationErrorKind;
use jsonschema::paths::LocationSegment;
use jsonschema::{Draft, Keyword, Registry, Retrieve, Uri, ValidationError, Validator};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

pub use fdt::{parse_fdt, FdtError, FdtNode};

/// How a problem about a schema that could not be used starts.
const CANNOT_CHECK: &str = "the binding cannot be checked";

/// Prefix of every schema `$id`.
const ID_BASE: &str = "http://devicetree.org/schemas/";

/// Bindings processed for validation, with the property type database.
/// Kept in the catalog cache, so that a restart does not process them again.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SchemaSet {
    /// Processed schemas by `$id` (without the trailing `#`).
    schemas: BTreeMap<String, Value>,
    types: types::TypeDb,
}

impl SchemaSet {
    /// Processes binding schemas: `(path relative to the bindings
    /// directory, document)`. Documents without `$id` are skipped; when two
    /// share an `$id`, the first wins, as in dt-schema.
    pub(crate) fn new<'a>(
        docs: impl IntoIterator<Item = (&'a str, &'a serde_norway::Value)>,
    ) -> Self {
        let mut schemas = BTreeMap::new();
        for (_, doc) in docs {
            let Ok(mut schema) = serde_json::to_value(doc) else {
                continue;
            };
            let Some(id) = schema.get("$id").and_then(Value::as_str) else {
                continue;
            };
            let id = id.trim_end_matches('#').to_owned();
            if schemas.contains_key(&id) {
                continue;
            }
            fixups::fixup_schema(&mut schema);
            if let Some(map) = schema.as_object_mut() {
                map.insert("type".into(), json!("object"));
                // The dt meta-schemas are not needed to validate devicetrees.
                map.remove("$schema");
                merge_trivial_patterns(map);
            }
            schemas.insert(id, schema);
        }
        let types = types::TypeDb::new(schemas.iter().map(|(id, s)| (id.as_str(), s)));
        // After the types: dt-schema reads property names from `$ref`s unescaped.
        schemas.values_mut().for_each(escape_ref_fragments);
        SchemaSet { schemas, types }
    }

    pub fn is_empty(&self) -> bool {
        self.schemas.is_empty()
    }

    pub fn len(&self) -> usize {
        self.schemas.len()
    }
}

/// Percent-encodes what a URI fragment may not hold in every `$ref`. The
/// JSON pointer of a property named `#interrupt-cells` has a bare `#`
/// (`arm,gic.yaml#/properties/#interrupt-cells`, kernel 7.2), which
/// dt-validate follows but a strict URI parser rejects.
fn escape_ref_fragments(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                match value {
                    Value::String(reference) if key == "$ref" => {
                        if let Some(escaped) = escape_fragment(reference) {
                            *reference = escaped;
                        }
                    }
                    _ => escape_ref_fragments(value),
                }
            }
        }
        Value::Array(list) => list.iter_mut().for_each(escape_ref_fragments),
        _ => {}
    }
}

/// `reference` with its fragment percent-encoded, or `None` when it needs
/// no change.
fn escape_fragment(reference: &str) -> Option<String> {
    let (base, fragment) = reference.split_once('#')?;
    let bytes = fragment.as_bytes();
    let allowed = |i: usize| {
        let b = bytes[i];
        b.is_ascii_alphanumeric()
            || b"-._~!$&'()*+,;=:@/?".contains(&b)
            || (b == b'%'
                && bytes.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
                && bytes.get(i + 2).is_some_and(u8::is_ascii_hexdigit))
    };
    if (0..bytes.len()).all(allowed) {
        return None;
    }
    let mut out = format!("{base}#");
    for (i, &b) in bytes.iter().enumerate() {
        if allowed(i) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    Some(out)
}

/// The first `$ref` of `schema` that is not a valid URI reference, with
/// why.
fn invalid_ref(schema: &Value) -> Option<String> {
    match schema {
        Value::Object(map) => map.iter().find_map(|(key, value)| match value {
            Value::String(reference) if key == "$ref" => jsonschema::uri::from_str(reference)
                .err()
                .map(|e| e.to_string()),
            _ => invalid_ref(value),
        }),
        Value::Array(list) => list.iter().find_map(invalid_ref),
        _ => None,
    }
}

/// Patterns that accept anything (`^acme,.*: true` in
/// `vendor-prefixes.yaml`, about a thousand of them) only mark property
/// names as known. One alternation does the same and is checked far faster
/// than a thousand separate patterns per property.
fn merge_trivial_patterns(schema: &mut Map<String, Value>) {
    let Some(Value::Object(patterns)) = schema.get_mut("patternProperties") else {
        return;
    };
    let trivial: Vec<String> = patterns
        .iter()
        .filter(|(_, spec)| *spec == &json!(true) || *spec == &json!({}))
        .map(|(pattern, _)| pattern.clone())
        .collect();
    if trivial.len() < 16 {
        return;
    }
    for pattern in &trivial {
        patterns.remove(pattern);
    }
    let merged: Vec<String> = trivial.iter().map(|p| format!("(?:{p})")).collect();
    patterns.insert(merged.join("|"), json!(true));
}

/// A schema error on one node of a devicetree.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SchemaProblem {
    /// Full path of the node (`/soc/serial@1000`).
    pub node: String,
    /// The property the error is about, when it is about one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property: Option<String>,
    pub message: String,
    /// The binding that reports it, relative to the bindings directory
    /// (`serial/8250.yaml`); empty for a value that could not be decoded.
    pub schema: String,
}

/// `property: message (schema)`, without the node.
impl fmt::Display for SchemaProblem {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        if let Some(property) = &self.property {
            write!(f, "{property}: ")?;
        }
        f.write_str(&self.message)?;
        if !self.schema.is_empty() {
            write!(f, " ({})", self.schema)?;
        }
        Ok(())
    }
}

/// A `$ref` to a schema the set does not have resolves to `false`, as in
/// dt-validate: whatever relies on a missing schema fails instead of
/// passing unchecked.
struct MissingIsFalse;

impl Retrieve for MissingIsFalse {
    fn retrieve(
        &self,
        _uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        Ok(Value::Bool(false))
    }
}

thread_local! {
    /// Integer widths other than 32 bits in the instance being validated,
    /// by address of the JSON number (the instance does not change while
    /// it is validated).
    static SIZES: RefCell<HashMap<usize, u8>> = RefCell::new(HashMap::new());
}

/// Records the integer widths of a node's values and its children's.
fn record_sizes(node: &decode::Node, instance: &Value, sizes: &mut HashMap<usize, u8>) {
    fn leaves(value: &Value, bits: u8, sizes: &mut HashMap<usize, u8>) {
        match value {
            Value::Number(_) => {
                sizes.insert(value as *const Value as usize, bits);
            }
            Value::Array(items) => items.iter().for_each(|v| leaves(v, bits, sizes)),
            _ => {}
        }
    }
    for (name, bits) in &node.sizes {
        if let Some(value) = instance.get(name) {
            leaves(value, *bits, sizes);
        }
    }
    for child in &node.children {
        if let Some(sub) = instance.get(&child.name) {
            record_sizes(child, sub, sizes);
        }
    }
}

/// dt-schema's `typeSize` keyword: the integer has the width its type
/// definition expects (`uint64` against `uint32` in a `oneOf`).
struct TypeSize(u8);

impl TypeSize {
    fn size(instance: &Value) -> u8 {
        SIZES
            .with(|s| {
                s.borrow()
                    .get(&(instance as *const Value as usize))
                    .copied()
            })
            .unwrap_or(32)
    }
}

impl<'i> Keyword<'i> for TypeSize {
    fn validate(&self, instance: &'i Value) -> Result<(), ValidationError<'i>> {
        let size = Self::size(instance);
        if !instance.is_number() || size == self.0 {
            return Ok(());
        }
        Err(ValidationError::custom(format!(
            "size is {size}, expected {}",
            self.0
        )))
    }

    fn is_valid(&self, instance: &'i Value) -> bool {
        !instance.is_number() || Self::size(instance) == self.0
    }
}

/// A property type that holds phandles, see [`Checker::phandle_kind`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhandleKind {
    /// One phandle.
    Phandle,
    /// Phandles with specifier cells; `entry` is the fixed number of cells
    /// of an entry, phandle included, when the schemas give one.
    PhandleArray { entry: Option<usize> },
}

/// Validates devicetree blobs against a [`SchemaSet`]. Validators are
/// compiled on first use and kept, so the first check of a design is the
/// slowest.
pub struct Checker {
    /// Every processed schema, shared by all validators.
    registry: Registry<'static>,
    types: types::TypeDb,
    /// Schema for each documented compatible string.
    by_compatible: HashMap<String, String>,
    /// Schemas with a `select`, tried on every node, with the selector.
    selecting: Vec<(String, Value)>,
    /// Compiled validators, or why one could not be compiled.
    validators: RwLock<HashMap<String, Result<Arc<Validator>, String>>>,
    /// Schemas left out of the registry, with why: one that cannot be
    /// registered would leave every other schema unchecked.
    broken: HashMap<String, String>,
}

impl Checker {
    pub fn new(set: SchemaSet) -> Self {
        let SchemaSet { schemas, mut types } = set;
        types.compile();
        let mut by_compatible = HashMap::new();
        let mut selecting = Vec::new();
        for (id, schema) in &schemas {
            match schema.get("select") {
                Some(Value::Bool(false)) => {}
                Some(select) => selecting.push((id.clone(), select.clone())),
                None => {
                    let Some(compatible) =
                        schema.get("properties").and_then(|p| p.get("compatible"))
                    else {
                        continue;
                    };
                    let mut list = node_compatibles(compatible);
                    if list.len() > 1 {
                        list.retain(|c| {
                            !matches!(c.as_str(), "syscon" | "simple-mfd" | "simple-bus")
                        });
                    }
                    for compatible in list {
                        by_compatible.insert(compatible, id.clone());
                    }
                }
            }
        }
        let mut broken = HashMap::new();
        let resources: Vec<_> = schemas
            .into_iter()
            .filter(|(id, schema)| match invalid_ref(schema) {
                Some(reason) => {
                    broken.insert(id.clone(), reason);
                    false
                }
                None => true,
            })
            .map(|(id, s)| (id, Arc::new(s)))
            .collect();
        // Only an invalid `$id` makes this fail; nothing can be checked then.
        let registry = Registry::new()
            .draft(Draft::Draft201909)
            .retriever(MissingIsFalse)
            .extend(resources)
            .and_then(|builder| builder.prepare())
            .unwrap_or_else(|_| Registry::new().prepare().expect("an empty registry"));
        Checker {
            registry,
            types,
            by_compatible,
            selecting,
            validators: RwLock::default(),
            broken,
        }
    }

    /// Compiles the validators every check needs (the schemas that select
    /// themselves), so that the first check is not much slower than the
    /// next ones. Meant to run in the background after loading.
    pub fn warm_up(&self) {
        for (id, select) in &self.selecting {
            let _ = self.select_validator(id, select);
            let _ = self.validator(id);
        }
    }

    /// The validator of the schema `id`.
    fn validator(&self, id: &str) -> Result<Arc<Validator>, String> {
        if let Some(reason) = self.broken.get(id) {
            return Err(reason.clone());
        }
        self.compiled(id, || json!({ "$ref": id }))
    }

    /// The validator of the `select` of schema `id`.
    fn select_validator(&self, id: &str, select: &Value) -> Result<Arc<Validator>, String> {
        self.compiled(&format!("{id}#select"), || {
            let mut select = select.clone();
            // Relative `$ref`s in the selector resolve against its schema.
            if let Value::Object(map) = &mut select {
                map.insert("$id".into(), json!(id));
            }
            select
        })
    }

    fn compiled(&self, key: &str, root: impl FnOnce() -> Value) -> Result<Arc<Validator>, String> {
        if let Some(found) = self.validators.read().unwrap().get(key) {
            return found.clone();
        }
        let built = jsonschema::options()
            .with_draft(Draft::Draft201909)
            .with_registry(&self.registry)
            .with_retriever(MissingIsFalse)
            .with_keyword("typeSize", |_, value, _| {
                let bits = value
                    .as_u64()
                    .and_then(|b| u8::try_from(b).ok())
                    .unwrap_or(32);
                Ok(Box::new(TypeSize(bits)))
            })
            .build(&root())
            .map(Arc::new)
            .map_err(|e| e.to_string());
        self.validators
            .write()
            .unwrap()
            .insert(key.to_owned(), built.clone());
        built
    }

    /// What the schemas say a property holds, when it holds phandles and
    /// nothing else, for reading decompiled trees.
    pub fn phandle_kind(&self, property: &str) -> Option<PhandleKind> {
        let types = self.types.types(property);
        let only = |ty: &str| types.len() == 1 && types.contains(ty);
        if only("phandle") {
            Some(PhandleKind::Phandle)
        } else if only("phandle-array") {
            let entry = match self.types.dim(property) {
                Some((_, (min, max))) if min > 0 && min == max => Some(min as usize),
                _ => None,
            };
            Some(PhandleKind::PhandleArray { entry })
        } else {
            None
        }
    }

    /// Validates a devicetree blob. Errors are attached to the node they
    /// are about, and reported once even when several schemas find them.
    pub fn check_dtb(&self, blob: &[u8]) -> Result<Vec<SchemaProblem>, FdtError> {
        let root = parse_fdt(blob)?;
        Ok(self.check_tree(&root))
    }

    /// Validates a parsed devicetree blob.
    pub fn check_tree(&self, root: &FdtNode) -> Vec<SchemaProblem> {
        let (tree, decode_errors) = decode::decode(&self.types, root);
        let mut problems: Vec<SchemaProblem> = decode_errors
            .into_iter()
            .map(|e| SchemaProblem {
                node: e.path,
                property: Some(e.property),
                message: e.message,
                schema: String::new(),
            })
            .collect();
        let mut instance = Value::Object(tree.to_json());
        self.check_subtree(&tree, "/", false, &mut instance, &mut problems);

        SIZES.with(|s| s.borrow_mut().clear());
        let mut seen = HashSet::new();
        problems.retain(|p| seen.insert((p.node.clone(), p.property.clone(), p.message.clone())));
        problems
    }

    fn check_subtree(
        &self,
        node: &decode::Node,
        path: &str,
        disabled: bool,
        instance: &mut Value,
        out: &mut Vec<SchemaProblem>,
    ) {
        let disabled = match instance.get("status") {
            Some(status) => is_disabled(status),
            None => disabled,
        };
        if let Value::Object(map) = instance {
            map.insert("$nodename".into(), json!([node.name]));
        }
        let mut sizes = HashMap::new();
        record_sizes(node, instance, &mut sizes);
        SIZES.with(|s| *s.borrow_mut() = sizes);
        self.check_node(instance, path, disabled, out);
        if let Value::Object(map) = instance {
            map.remove("$nodename");
        }
        for child in &node.children {
            if let Some(sub) = instance.get_mut(&child.name) {
                let child_path = decode::child_path(path, &child.name);
                self.check_subtree(child, &child_path, disabled, sub, out);
            }
        }
    }

    fn check_node(
        &self,
        instance: &Value,
        path: &str,
        disabled: bool,
        out: &mut Vec<SchemaProblem>,
    ) {
        let mut ids: Vec<&str> = Vec::new();
        if let Some(compatibles) = instance.get("compatible").and_then(Value::as_array) {
            if let Some(id) = compatibles
                .iter()
                .filter_map(Value::as_str)
                .find_map(|c| self.by_compatible.get(c))
            {
                ids.push(id);
            }
        }
        for (id, select) in &self.selecting {
            let selected = select == &Value::Bool(true)
                || self
                    .select_validator(id, select)
                    .is_ok_and(|v| v.is_valid(instance));
            if selected {
                ids.push(id);
            }
        }
        for id in ids {
            let validator = match self.validator(id) {
                Ok(validator) => validator,
                Err(reason) => {
                    let schema = schema_path(id);
                    // Once per tree: a schema that selects itself would
                    // report it on every node.
                    if !out
                        .iter()
                        .any(|p| p.schema == schema && p.message.starts_with(CANNOT_CHECK))
                    {
                        out.push(SchemaProblem {
                            node: path.to_owned(),
                            property: None,
                            message: format!("{CANNOT_CHECK}: {reason}"),
                            schema,
                        });
                    }
                    continue;
                }
            };
            for error in validator.iter_errors(instance) {
                if (disabled || instance_disabled(&error)) && about_missing_or_extra(&error) {
                    continue;
                }
                out.push(problem(instance, path, id, &error));
            }
        }
    }
}

/// Every literal string an `enum`, `const` or `pattern` gives in a
/// `compatible` schema (dt-schema's `extract_node_compatibles`).
fn node_compatibles(schema: &Value) -> Vec<String> {
    fn walk(value: &Value, out: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, value) in map {
                    match (key.as_str(), value) {
                        ("enum", Value::Array(list))
                            if list.first().is_some_and(Value::is_string) =>
                        {
                            out.extend(list.iter().filter_map(Value::as_str).map(str::to_owned));
                        }
                        ("const" | "pattern", Value::String(s)) => out.push(s.clone()),
                        ("enum" | "const" | "pattern", _) => {}
                        _ => walk(value, out),
                    }
                }
            }
            Value::Array(list) => list.iter().for_each(|v| walk(v, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(schema, &mut out);
    out.sort();
    out.dedup();
    out
}

fn is_disabled(status: &Value) -> bool {
    status
        .as_array()
        .is_some_and(|list| list.iter().any(|s| s == "disabled"))
}

fn instance_disabled(error: &ValidationError) -> bool {
    error.instance().get("status").is_some_and(is_disabled)
}

/// Disabled nodes may lack required properties (a board fills them in),
/// so dt-schema does not report missing or unexpected ones there.
fn about_missing_or_extra(error: &ValidationError) -> bool {
    let hit = |e: &ValidationError| {
        e.schema_path().segments().any(|s| {
            matches!(&s, LocationSegment::Property(p) if p == "required" || p == "unevaluatedProperties")
        })
    };
    if hit(error) {
        return true;
    }
    match error.kind() {
        ValidationErrorKind::AnyOf { context } | ValidationErrorKind::OneOfNotValid { context } => {
            context.iter().flatten().any(hit)
        }
        _ => false,
    }
}

/// Locates an error: the instance path walks down child nodes, then names
/// a property.
fn problem(instance: &Value, path: &str, id: &str, error: &ValidationError) -> SchemaProblem {
    let mut node = path.to_owned();
    let mut property = None;
    let mut current = instance;
    for segment in error.instance_path().segments() {
        let LocationSegment::Property(name) = segment else {
            break;
        };
        match current.get(name.as_ref()) {
            Some(next @ Value::Object(_)) => {
                node = decode::child_path(&node, &name);
                current = next;
            }
            _ => {
                property = Some(name.into_owned());
                break;
            }
        }
    }
    SchemaProblem {
        node,
        property,
        message: describe(error),
        schema: schema_path(id),
    }
}

/// `serial/8250.yaml` for the schema `$id` `http://devicetree.org/schemas/serial/8250.yaml`.
fn schema_path(id: &str) -> String {
    id.strip_prefix(ID_BASE).unwrap_or(id).to_owned()
}

/// The message of an error, like dt-schema's `format_error`: a failed
/// `oneOf`/`anyOf` lists what would satisfy it instead of printing the
/// instance, and a node is never printed whole.
fn describe(error: &ValidationError) -> String {
    match error.kind() {
        ValidationErrorKind::AnyOf { context } | ValidationErrorKind::OneOfNotValid { context } => {
            let depth = error.instance_path().segments().count();
            let mut messages: Vec<String> = Vec::new();
            for sub in context.iter().flatten() {
                let below: Vec<String> = sub
                    .instance_path()
                    .segments()
                    .skip(depth)
                    .map(|s| match s {
                        LocationSegment::Property(p) => p.into_owned(),
                        LocationSegment::Index(i) => i.to_string(),
                    })
                    .collect();
                let mut message = describe(sub);
                if !below.is_empty() {
                    message = format!("{}: {message}", below.join("/"));
                }
                if !messages.contains(&message) {
                    messages.push(message);
                }
            }
            match messages.len() {
                0 => error.masked_with("the value").to_string(),
                1 => messages.remove(0),
                _ => format!("one of these must be fixed: {}", messages.join("; ")),
            }
        }
        // `memory: false` in root-node.yaml, `"^gic-its@": false`: a name
        // the schema forbids. dt-validate's "False schema does not allow"
        // says neither what nor why.
        ValidationErrorKind::FalseSchema => match error.instance_path().segments().last() {
            None => "the binding relies on a schema that is not loaded".to_owned(),
            Some(LocationSegment::Property(name)) if error.instance().is_object() => {
                format!("a node named `{name}` is not allowed here")
            }
            Some(_) => "not allowed here".to_owned(),
        },
        _ if error.instance().is_object() => error.masked_with("the node").to_string(),
        _ => error.to_string(),
    }
}
