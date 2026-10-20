//! Resolves the type and constraints of binding properties by following
//! `$ref`, `allOf`, `oneOf` and `anyOf` through the kernel schemas and the
//! dt-schema core schemas (`/schemas/types.yaml`, `/schemas/clock/...`).

use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};

use fancy_regex::Regex;
use serde_norway::Value;

use crate::{PropertySpec, PropertyType};

include!(concat!(env!("OUT_DIR"), "/core_schemas.rs"));

const TYPES: &str = "/schemas/types.yaml";
/// Bound on `$ref` chains, so cyclic schemas cannot loop.
const MAX_DEPTH: usize = 24;

/// Every schema the indexer can refer to, by `$id` path (`/schemas/...`).
pub(crate) struct Schemas {
    docs: HashMap<String, Value>,
    /// Properties of the core schemas that apply to any node
    /// (`dt-core.yaml`, `clock/clock.yaml`, ...), unlike those for special
    /// nodes such as `/aliases`.
    generic: HashMap<String, Vec<Value>>,
    /// Every definition of each property name across all schemas, core
    /// ones first, child node schemas included. Like dt-schema's own property type database, this types
    /// a property a binding names without typing it (`reset-gpios: true`).
    by_name: HashMap<String, Vec<(String, Value)>>,
    /// Pattern properties of the generic core schemas (`-gpios$`,
    /// `-microvolt$`).
    patterns: Vec<(Regex, String, Value)>,
}

/// A property schema and the document its relative `$ref`s start from.
type Candidate<'a> = (&'a str, &'a Value);

impl Schemas {
    /// Builds the registry from the kernel schemas (path relative to the
    /// bindings directory, document) and the embedded core schemas.
    pub(crate) fn new(kernel: impl IntoIterator<Item = (String, Value)>) -> Self {
        let mut docs = HashMap::new();
        let mut order = Vec::new();
        for (rel, text) in CORE_SCHEMAS {
            if let Ok(doc) = serde_norway::from_str::<Value>(text) {
                let id = format!("/schemas/{rel}");
                order.push((id.clone(), applies_to_any_node(&doc)));
                docs.insert(id, doc);
            }
        }
        for (rel, doc) in kernel {
            let id = format!("/schemas/{rel}");
            if let Entry::Vacant(entry) = docs.entry(id.clone()) {
                order.push((id, false));
                entry.insert(doc);
            }
        }

        let mut by_name: HashMap<String, Vec<(String, Value)>> = HashMap::new();
        let mut generic: HashMap<String, Vec<Value>> = HashMap::new();
        let mut patterns = Vec::new();
        for (id, is_generic) in &order {
            let doc = &docs[id];
            each_property(doc, &mut |name, spec| {
                by_name
                    .entry(name.to_owned())
                    .or_default()
                    .push((id.clone(), spec.clone()));
            });
            if *is_generic {
                for (name, spec) in mapping(doc, "properties") {
                    generic
                        .entry(name.to_owned())
                        .or_default()
                        .push(spec.clone());
                }
                for (pattern, spec) in mapping(doc, "patternProperties") {
                    if let Ok(regex) = Regex::new(pattern) {
                        patterns.push((regex, id.clone(), spec.clone()));
                    }
                }
            }
        }
        Schemas {
            docs,
            generic,
            by_name,
            patterns,
        }
    }

    /// Lists the properties of a binding with their resolved types.
    pub(crate) fn properties(&self, id: &str, doc: &Value) -> Vec<PropertySpec> {
        let required: Vec<&str> = doc
            .get("required")
            .and_then(Value::as_sequence)
            .map(|seq| seq.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();

        // Every definition of each property name: the binding's own first,
        // then those of the schemas it includes.
        let mut candidates: HashMap<&str, Vec<Candidate>> = HashMap::new();
        self.collect(id, doc, &mut candidates, &mut HashSet::new(), 0);

        let mut names: Vec<&str> = mapping(doc, "properties")
            .filter(|(_, spec)| spec.as_bool() != Some(false))
            .map(|(name, _)| name)
            .collect();
        for name in &required {
            if !names.contains(name) {
                names.push(name);
            }
        }

        names
            .into_iter()
            .map(|name| {
                let related = candidates.remove(name).unwrap_or_default();
                let patterns: Vec<Candidate> = self.matching_patterns(name).collect();
                // Descriptions and constraints come from this binding, the
                // schemas it includes and the generic core schemas, never
                // from an unrelated binding that uses the same name.
                let constraints: Vec<&Value> = related
                    .iter()
                    .map(|(_, spec)| *spec)
                    .chain(self.generic.get(name).into_iter().flatten())
                    .chain(patterns.iter().map(|(_, spec)| *spec))
                    .collect();
                let mut property = PropertySpec {
                    name: name.to_owned(),
                    description: constraints.iter().find_map(|spec| {
                        spec.get("description")
                            .and_then(Value::as_str)
                            .map(|s| s.trim().to_owned())
                    }),
                    required: required.contains(&name),
                    ..PropertySpec::default()
                };
                // A type a schema states beats one guessed from values
                // (`reg: maximum: 7` is still an address).
                property.ty = [false, true].into_iter().find_map(|guess| {
                    related
                        .iter()
                        .copied()
                        .chain(self.global(name))
                        .chain(patterns.iter().copied())
                        .find_map(|(base, spec)| self.type_of(base, spec, guess, 0))
                });
                for spec in constraints {
                    fill_constraints(&mut property, spec);
                }
                property
            })
            .collect()
    }

    /// Gathers the property definitions of `doc` and of every schema it
    /// includes through a top-level `$ref` or `allOf`.
    fn collect<'a>(
        &'a self,
        id: &'a str,
        doc: &'a Value,
        out: &mut HashMap<&'a str, Vec<Candidate<'a>>>,
        visited: &mut HashSet<(&'a str, *const Value)>,
        depth: usize,
    ) {
        if depth > MAX_DEPTH || !visited.insert((id, doc)) {
            return;
        }
        for (name, spec) in mapping(doc, "properties") {
            if spec.as_bool() != Some(false) {
                out.entry(name).or_default().push((id, spec));
            }
        }
        if let Some(target) = doc.get("$ref").and_then(Value::as_str) {
            if let Some((id, target)) = self.lookup(id, target) {
                self.collect(id, target, out, visited, depth + 1);
            }
        }
        for item in doc
            .get("allOf")
            .and_then(Value::as_sequence)
            .into_iter()
            .flatten()
        {
            self.collect(id, item, out, visited, depth + 1);
        }
    }

    /// The definitions of a property in any schema.
    fn global<'a>(&'a self, name: &str) -> impl Iterator<Item = Candidate<'a>> {
        self.by_name
            .get(name)
            .into_iter()
            .flatten()
            .map(|(id, spec)| (id.as_str(), spec))
    }

    fn matching_patterns<'a>(&'a self, name: &'a str) -> impl Iterator<Item = Candidate<'a>> {
        self.patterns
            .iter()
            .filter(move |(regex, _, spec)| {
                is_definite(spec) && regex.is_match(name).unwrap_or(false)
            })
            .map(|(_, id, spec)| (id.as_str(), spec))
    }

    /// The type a property schema describes, if it pins one down. With
    /// `guess`, also infer it from listed values and bounds.
    fn type_of(&self, base: &str, spec: &Value, guess: bool, depth: usize) -> Option<PropertyType> {
        if depth > MAX_DEPTH {
            return None;
        }
        let map = spec.as_mapping()?;

        if let Some(target) = spec.get("$ref").and_then(Value::as_str) {
            let (id, fragment) = self.split(base, target);
            if id == TYPES {
                if let Some(name) = fragment.strip_prefix("/definitions/") {
                    return PropertyType::from_definition(name);
                }
            }
            if let Some((id, target)) = self.lookup(base, target) {
                if let Some(ty) = self.type_of(id, target, guess, depth + 1) {
                    return Some(ty);
                }
                if is_node(target) {
                    return Some(PropertyType::Node);
                }
            }
        }

        match spec.get("type") {
            Some(Value::String(ty)) => match ty.as_str() {
                "boolean" => return Some(PropertyType::Flag),
                "object" => return Some(PropertyType::Node),
                "string" => return Some(PropertyType::String),
                "integer" => return Some(PropertyType::Uint32),
                _ => {}
            },
            Some(Value::Sequence(_)) => return None,
            _ => {}
        }

        // Alternatives: a value type wins over "or a child node of the same
        // name" (`clocks: anyOf: [{type: object}, {$ref: phandle-array}]`).
        for key in ["allOf", "oneOf", "anyOf"] {
            let types: Vec<PropertyType> = spec
                .get(key)
                .and_then(Value::as_sequence)
                .into_iter()
                .flatten()
                .filter_map(|item| self.type_of(base, item, guess, depth + 1))
                .collect();
            if let Some(ty) = types
                .iter()
                .find(|ty| **ty != PropertyType::Node)
                .or(types.first())
            {
                return Some(*ty);
            }
        }

        if let Some(items) = spec.get("items") {
            let element = match items {
                Value::Sequence(seq) => seq
                    .iter()
                    .find_map(|item| self.type_of(base, item, guess, depth + 1)),
                _ => self.type_of(base, items, guess, depth + 1),
            };
            return element.and_then(PropertyType::array_of);
        }
        if !guess {
            return None;
        }
        if let Some(value) = spec.get("const").or_else(|| first(spec.get("enum"))) {
            return scalar_type(value);
        }
        if map.contains_key("minimum") || map.contains_key("maximum") {
            return Some(PropertyType::Uint32);
        }
        None
    }

    /// Splits a `$ref` into the `$id` path of its document and the JSON
    /// pointer inside it.
    fn split<'r>(&self, base: &str, target: &'r str) -> (String, &'r str) {
        let (path, fragment) = target.split_once('#').unwrap_or((target, ""));
        let path = path.strip_prefix("http://devicetree.org").unwrap_or(path);
        let id = if path.is_empty() {
            base.to_owned()
        } else if path.starts_with('/') {
            path.to_owned()
        } else {
            let dir = base.rsplit_once('/').map_or("", |(dir, _)| dir);
            normalize(&format!("{dir}/{path}"))
        };
        (id, fragment)
    }

    /// Resolves a `$ref` to the schema it points at.
    fn lookup<'a>(&'a self, base: &str, target: &str) -> Option<(&'a str, &'a Value)> {
        let (id, fragment) = self.split(base, target);
        let (id, mut value) = self.docs.get_key_value(&id)?;
        for segment in fragment.split('/').filter(|s| !s.is_empty()) {
            let segment = segment.replace("~1", "/").replace("~0", "~");
            value = match value {
                Value::Sequence(seq) => seq.get(segment.parse::<usize>().ok()?)?,
                _ => value.get(segment.as_str())?,
            };
        }
        Some((id, value))
    }
}

/// Copies the enum, default, bounds and item counts a schema states, where
/// the property has none yet (the binding's own constraints come first).
fn fill_constraints(property: &mut PropertySpec, spec: &Value) {
    let items = spec.get("items").filter(|items| items.is_mapping());
    let get = |key: &str| spec.get(key).or_else(|| items.and_then(|i| i.get(key)));

    if property.enum_values.is_empty() {
        property.enum_values = enum_values(spec)
            .or_else(|| items.and_then(enum_values))
            .unwrap_or_default();
    }
    if property.default.is_none() {
        property.default = spec.get("default").and_then(to_json);
    }
    if property.minimum.is_none() {
        property.minimum = get("minimum").and_then(to_number);
    }
    if property.maximum.is_none() {
        property.maximum = get("maximum").and_then(to_number);
    }
    // Like dt-schema's fixups, a list of items bounds the count both ways
    // unless the schema says otherwise (`reg: items: [a, b]`).
    let listed = spec
        .get("items")
        .and_then(Value::as_sequence)
        .map(|seq| seq.len() as u64);
    if property.min_items.is_none() {
        property.min_items = spec.get("minItems").and_then(Value::as_u64).or(listed);
    }
    if property.max_items.is_none() {
        property.max_items = spec.get("maxItems").and_then(Value::as_u64).or(listed);
    }
}

/// The allowed values of a schema: its `const` or `enum`, or those of every
/// value alternative of a `oneOf`/`anyOf` (`status`, whose other
/// alternative is a child node of the same name).
fn enum_values(spec: &Value) -> Option<Vec<serde_json::Value>> {
    if let Some(value) = spec.get("const") {
        return Some(to_json(value).into_iter().collect());
    }
    if let Some(values) = spec.get("enum").and_then(Value::as_sequence) {
        return Some(values.iter().filter_map(to_json).collect());
    }
    for key in ["oneOf", "anyOf"] {
        let Some(alternatives) = spec.get(key).and_then(Value::as_sequence) else {
            continue;
        };
        let mut values = Vec::new();
        for alternative in alternatives.iter().filter(|alt| !is_node(alt)) {
            values.extend(enum_values(alternative)?);
        }
        return Some(values);
    }
    None
}

fn to_json(value: &Value) -> Option<serde_json::Value> {
    serde_json::to_value(value).ok()
}

fn to_number(value: &Value) -> Option<serde_json::Number> {
    match to_json(value)? {
        serde_json::Value::Number(n) => Some(n),
        _ => None,
    }
}

fn scalar_type(value: &Value) -> Option<PropertyType> {
    match value {
        Value::String(_) => Some(PropertyType::String),
        Value::Number(_) => Some(PropertyType::Uint32),
        Value::Bool(_) => Some(PropertyType::Flag),
        _ => None,
    }
}

fn first(value: Option<&Value>) -> Option<&Value> {
    value?.as_sequence()?.first()
}

/// Whether a core schema applies to every node: `select: true`, or a
/// selection that neither depends on `compatible` nor requires a property
/// (`gpio-consumer.yaml`, but not `gpio-hog.yaml`).
fn applies_to_any_node(doc: &Value) -> bool {
    match doc.get("select") {
        Some(Value::Bool(select)) => *select,
        Some(select) => {
            select.get("required").is_none()
                && select
                    .get("properties")
                    .is_some_and(|p| p.get("compatible").is_none())
        }
        None => false,
    }
}

/// Whether a pattern property gives a single, definite type. The
/// catch-all patterns of `dt-core.yaml` allow anything and are skipped.
fn is_definite(spec: &Value) -> bool {
    !matches!(spec.get("type"), Some(Value::Sequence(_)))
}

/// Whether a schema describes a child node rather than a value.
fn is_node(spec: &Value) -> bool {
    spec.get("type").and_then(Value::as_str) == Some("object")
        || spec.get("properties").is_some()
        || spec.get("patternProperties").is_some()
}

fn mapping<'a>(doc: &'a Value, key: &str) -> impl Iterator<Item = (&'a str, &'a Value)> {
    doc.get(key)
        .and_then(Value::as_mapping)
        .into_iter()
        .flatten()
        .filter_map(|(name, spec)| Some((name.as_str()?, spec)))
}

/// Calls `f` with every property definition in a schema, at any depth
/// (child nodes under `patternProperties`, `allOf` branches, ...).
fn each_property<'a>(value: &'a Value, f: &mut impl FnMut(&'a str, &'a Value)) {
    match value {
        Value::Mapping(map) => {
            for (key, value) in map {
                if key.as_str() == Some("properties") {
                    for (name, spec) in value.as_mapping().into_iter().flatten() {
                        if let Some(name) = name.as_str() {
                            f(name, spec);
                        }
                    }
                }
                each_property(value, f);
            }
        }
        Value::Sequence(seq) => seq.iter().for_each(|v| each_property(v, f)),
        _ => {}
    }
}

/// Resolves `.` and `..` segments of a `/schemas/...` path.
fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(part),
        }
    }
    format!("/{}", parts.join("/"))
}
