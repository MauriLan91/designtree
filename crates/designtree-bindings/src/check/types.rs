//! dt-schema's property type database (`extract_types` and
//! `get_prop_types` in `dtschema/validator.py`): the type of every property
//! name across all schemas, used to decode raw property bytes.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use fancy_regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::fixups::is_string_schema;

static TYPE_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(address|flag|u?int(8|16|32|64)(-(array|matrix))?|string(-array)?|phandle(-array)?)",
    )
    .unwrap()
});
static YAML_REF: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.yaml#?$").unwrap());
static MICROVOLT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-microvolt$").unwrap());
static HZ: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(^(?!opp)).*-hz$").unwrap());

/// Bounds of the outer and inner lists of a matrix: `((min, max), (min,
/// max))`, 0 for no maximum.
pub(crate) type Dim = ((u64, u64), (u64, u64));

/// One definition of a property name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct PropType {
    /// `uint32-array`, `phandle-array`, ...; `None` for an untyped
    /// definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ty: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim: Option<Dim>,
    #[serde(skip)]
    ids: Vec<String>,
    #[serde(skip)]
    pattern: bool,
}

/// Property types by name, and those of pattern properties.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct TypeDb {
    pub props: BTreeMap<String, Vec<PropType>>,
    pub patterns: BTreeMap<String, Vec<PropType>>,
    #[serde(skip)]
    compiled: Vec<(Option<Regex>, String)>,
}

fn has_any(map: &Map<String, Value>, keys: &[&str]) -> bool {
    keys.iter().any(|k| map.contains_key(*k))
}

fn is_match(regex: &Regex, text: &str) -> bool {
    regex.is_match(text).unwrap_or(false)
}

/// dt-schema's `_get_array_range`.
fn array_range(schema: &Value) -> (u64, u64) {
    let schema = match schema {
        Value::Array(list) if list.len() == 1 => &list[0],
        Value::Array(_) => return (0, 0),
        schema => schema,
    };
    let get = |key: &str| schema.get(key).and_then(Value::as_u64);
    match schema.get("items") {
        Some(Value::Array(items)) => {
            let max = items.len() as u64;
            (get("minItems").unwrap_or(max), max)
        }
        _ => (get("minItems").unwrap_or(1), get("maxItems").unwrap_or(0)),
    }
}

fn merge_dim(a: Dim, b: Dim) -> Dim {
    let merge = |x: (u64, u64), y: (u64, u64)| {
        let min = x.0.min(y.0);
        let mut max = x.1.max(y.1);
        if x.1.min(y.1) == 0 {
            max = 0;
        }
        if max == 1 {
            (1, max)
        } else {
            (min, max)
        }
    };
    (merge(a.0, b.0), merge(a.1, b.1))
}

fn local_ref<'a>(schema: &'a Value, reference: &str) -> Option<&'a Value> {
    let mut value = schema;
    for part in reference.split('/').skip(1) {
        value = value.get(part)?;
    }
    Some(value)
}

struct Extractor<'a> {
    props: BTreeMap<String, Vec<PropType>>,
    id: &'a str,
    schema: &'a Value,
}

impl Extractor<'_> {
    fn prop(&mut self, name: &str, sub: &Value, pattern: bool, depth: usize) {
        if name.starts_with('$') || depth > 32 {
            return;
        }
        let Some(map) = sub.as_object() else {
            if sub == &Value::Bool(true) {
                self.props.entry(name.to_owned()).or_insert_with(|| {
                    vec![PropType {
                        ty: None,
                        dim: None,
                        ids: vec![self.id.to_owned()],
                        pattern,
                    }]
                });
            }
            return;
        };

        let mut ty: Option<String> = None;
        let reference = map.get("$ref").and_then(Value::as_str);
        if let Some(reference) = reference {
            if reference.starts_with("#/") {
                if let Some(list) = self.props.get(name) {
                    if list.iter().any(|p| p.ids.iter().any(|i| i == self.id)) {
                        return;
                    }
                }
                if let Some(target) = local_ref(self.schema, reference) {
                    self.prop(name, target, pattern, depth + 1);
                }
            } else if reference.contains("/properties/") {
                let last = reference.rsplit('/').next().unwrap_or_default();
                if last != name {
                    ty = Some(last.to_owned());
                }
            }
        }
        for key in ["allOf", "oneOf", "anyOf"] {
            if let Some(Value::Array(list)) = map.get(key) {
                for item in list {
                    self.prop(name, item, pattern, depth + 1);
                }
            }
        }
        self.props.entry(name.to_owned()).or_default();

        if map.get("type").and_then(Value::as_str) == Some("object")
            || has_any(
                map,
                &["properties", "patternProperties", "additionalProperties"],
            )
        {
            ty = Some("node".into());
        } else if let Some(found) = reference
            .and_then(|r| TYPE_NAME.find(r).ok().flatten())
            .map(|m| m.as_str().to_owned())
        {
            ty = Some(found);
        } else if map.get("type").and_then(Value::as_str) == Some("boolean") {
            ty = Some("flag".into());
        } else if let Some(items) = map.get("items") {
            let strings = match items {
                Value::Array(list) => list.first().is_some_and(is_string_schema),
                items => is_string_schema(items),
            };
            ty = if strings {
                Some("string-array".into())
            } else if is_match(&MICROVOLT, name) {
                Some("int32-matrix".into())
            } else if is_match(&HZ, name) {
                Some("uint32-matrix".into())
            } else {
                None
            };
        } else if reference.is_some_and(|r| is_match(&YAML_REF, r)) {
            ty = Some("node".into());
        }

        let mut new = PropType {
            ty: ty.clone(),
            dim: None,
            ids: vec![self.id.to_owned()],
            pattern,
        };
        let list = self.props.get_mut(name).expect("inserted above");
        let Some(ty) = ty else {
            if list.is_empty() {
                list.push(new);
            }
            return;
        };

        let dim = if (ty == "phandle-array" || ty.ends_with("-matrix"))
            && has_any(map, &["items", "minItems", "maxItems"])
        {
            let outer = array_range(sub);
            let inner = match map.get("items") {
                Some(Value::Array(list)) => list.first().map_or((0, 0), array_range),
                Some(items) => array_range(items),
                None => (0, 0),
            };
            Some((outer, inner))
        } else {
            None
        };
        new.dim = dim;

        let mut keep_new = true;
        let mut untyped = None;
        for (i, p) in list.iter_mut().enumerate() {
            let Some(existing) = p.ty.clone() else {
                untyped = Some(i);
                break;
            };
            let mut absorb = false;
            if let Some(dim) =
                dim.filter(|_| existing == "phandle-array" || existing.ends_with("-matrix"))
            {
                p.dim = Some(p.dim.map_or(dim, |d| merge_dim(d, dim)));
                absorb = true;
            } else if existing == ty {
                absorb = true;
            } else if ty.contains("string") && existing.contains("string") {
                if ty == "string-array" {
                    p.ty = Some(ty.clone());
                }
                absorb = true;
            }
            if absorb {
                if !p.ids.iter().any(|i| i == self.id) {
                    p.ids.push(self.id.to_owned());
                }
                keep_new = false;
                break;
            }
        }
        if let Some(i) = untyped {
            list.remove(i);
        }
        if keep_new {
            list.push(new);
        }
        if has_any(
            map,
            &["properties", "patternProperties", "additionalProperties"],
        ) {
            self.sub_schema(sub, depth + 1);
        }
    }

    fn sub_schema(&mut self, sub: &Value, depth: usize) {
        let Some(map) = sub.as_object() else {
            return;
        };
        if depth > 32 {
            return;
        }
        if let Some(additional) = map.get("additionalProperties") {
            self.sub_schema(additional, depth + 1);
        }
        for key in ["allOf", "oneOf", "anyOf"] {
            if let Some(Value::Array(list)) = map.get(key) {
                for item in list {
                    self.sub_schema(item, depth + 1);
                }
            }
        }
        for key in ["properties", "patternProperties"] {
            if let Some(Value::Object(props)) = map.get(key) {
                for (name, spec) in props {
                    self.prop(name, spec, key == "patternProperties", depth + 1);
                }
            }
        }
    }
}

impl TypeDb {
    /// Builds the database from processed schemas, by `$id`.
    pub(crate) fn new<'a>(schemas: impl IntoIterator<Item = (&'a str, &'a Value)>) -> Self {
        let mut props = BTreeMap::new();
        for (id, schema) in schemas {
            let mut extractor = Extractor {
                props: std::mem::take(&mut props),
                id,
                schema,
            };
            extractor.sub_schema(schema, 0);
            props = extractor.props;
        }

        // A `$ref` to another schema's property takes that property's type.
        let names: Vec<String> = props.keys().cloned().collect();
        for name in names {
            let Some(list) = props.get(&name) else {
                continue;
            };
            let resolved = list.iter().enumerate().find_map(|(i, p)| {
                let ty = p.ty.as_deref()?;
                if ty == "node" || is_match(&TYPE_NAME, ty) {
                    return None;
                }
                let target = props.get(ty)?.first()?.ty.clone();
                Some((i, target))
            });
            if let Some((i, target)) = resolved {
                if let Some(list) = props.get_mut(&name) {
                    list[i].ty = target;
                }
            }
        }

        props.remove(r"^[a-z][a-z0-9\-]*$");
        for list in props.values_mut() {
            list.retain(|p| p.ty.as_deref() != Some("node"));
        }
        props.retain(|_, list| !list.is_empty());

        let mut patterns = BTreeMap::new();
        let pattern_names: Vec<String> = props
            .iter()
            .filter(|(_, list)| list[0].pattern)
            .map(|(name, _)| name.clone())
            .collect();
        for name in pattern_names {
            if let Some(list) = props.remove(&name) {
                if list[0].ty.is_some() {
                    patterns.insert(name, list);
                }
            }
        }
        let mut db = TypeDb {
            props,
            patterns,
            compiled: Vec::new(),
        };
        db.compile();
        let untyped: Vec<String> = db
            .props
            .iter()
            .filter(|(name, list)| list[0].ty.is_none() && db.typed_pattern(name))
            .map(|(name, _)| name.clone())
            .collect();
        for name in untyped {
            db.props.remove(&name);
        }
        db
    }

    /// Compiles the patterns; called again after loading from a cache.
    pub(crate) fn compile(&mut self) {
        self.compiled = self
            .patterns
            .keys()
            .map(|p| (Regex::new(p).ok(), p.clone()))
            .collect();
    }

    fn matching_patterns<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a PropType> + 'a {
        self.compiled.iter().filter_map(move |(regex, pattern)| {
            let first = self.patterns.get(pattern)?.first()?;
            (first.ty.is_some() && regex.as_ref().is_some_and(|r| is_match(r, name)))
                .then_some(first)
        })
    }

    fn typed_pattern(&self, name: &str) -> bool {
        self.matching_patterns(name).next().is_some()
    }

    /// dt-schema's `property_get_type`.
    pub(crate) fn types(&self, name: &str) -> BTreeSet<String> {
        let mut types: BTreeSet<String> = self
            .props
            .get(name)
            .into_iter()
            .flatten()
            .filter_map(|p| p.ty.clone())
            .collect();
        if types.is_empty() {
            types.extend(self.matching_patterns(name).filter_map(|p| p.ty.clone()));
        }
        if types.len() > 1 {
            types.remove("node");
        }
        types
    }

    /// dt-schema's `property_get_type_dim`.
    pub(crate) fn dim(&self, name: &str) -> Option<Dim> {
        if let Some(dim) = self
            .props
            .get(name)
            .into_iter()
            .flatten()
            .find_map(|p| p.dim)
        {
            return Some(dim);
        }
        self.matching_patterns(name).find_map(|p| p.dim)
    }

    /// dt-schema's `property_has_fixed_dimensions`.
    pub(crate) fn fixed_dimensions(&self, name: &str) -> bool {
        self.dim(name).is_some_and(|((omin, omax), (imin, imax))| {
            (omin > 0 && omin == omax) || (imin > 0 && imin == imax)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn types_come_from_type_references() {
        let schema = json!({
            "properties": {
                "acme,gain": { "$ref": "/schemas/types.yaml#/definitions/uint32" },
                "acme,names": { "$ref": "/schemas/types.yaml#/definitions/string-array" },
                "acme,phys": {
                    "$ref": "/schemas/types.yaml#/definitions/phandle-array",
                    "items": [{ "items": [{}, {}] }],
                },
                "acme,on": { "type": "boolean" },
                "acme,child": { "type": "object" },
            },
            "patternProperties": {
                "-acme-ms$": { "$ref": "/schemas/types.yaml#/definitions/uint32-array" },
            },
        });
        let db = TypeDb::new([("a", &schema)]);
        let one = |name: &str| db.types(name).into_iter().collect::<Vec<_>>();
        assert_eq!(one("acme,gain"), ["uint32"]);
        assert_eq!(one("acme,names"), ["string-array"]);
        assert_eq!(one("acme,on"), ["flag"]);
        assert!(one("acme,child").is_empty());
        assert_eq!(one("delay-acme-ms"), ["uint32-array"]);
        assert_eq!(db.dim("acme,phys"), Some(((1, 1), (2, 2))));
        assert!(db.fixed_dimensions("acme,phys"));
    }
}
