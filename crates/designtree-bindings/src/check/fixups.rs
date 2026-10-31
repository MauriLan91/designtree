//! dt-schema's schema fixups (`dtschema/fixups.py`), applied to every
//! binding before it validates anything.
//!
//! Bindings are written for property values as authors think of them
//! (`reg: maxItems: 1`, `compatible: const: foo`), but a decoded devicetree
//! value is always a list, and a list of lists for cell matrices
//! (`reg = <0x1000 0x100>` is `[[0x1000, 0x100]]`). The fixups rewrite the
//! schemas into that shape, and add what every node may carry (`status`,
//! `pinctrl-*`, `interrupts-extended` where `interrupts` is allowed).
//!
//! This is a port, kept close to the original so that both report the same
//! errors; the odd corners are dt-schema's.

use std::sync::LazyLock;

use fancy_regex::Regex;
use serde_json::{json, Map, Value};

/// Properties with a variable number of cells per entry, left unchecked.
const VARIABLE_MATRIX_PROPS: [&str; 2] = ["fsl,pins", "qcom,board-id"];

// Keep in sync with dt-schema's property-units.yaml.
static UNIT_ARRAY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"-(kBps|bits|percent|bp|db|mhz|sec|ms|us|ns|ps|mm|nanoamp|(micro-)?ohms|micro(amp|watt)(-hours)?|milliwatt|(femto|pico)farads|(milli)?celsius|kelvin|k?pascal)$",
    )
    .unwrap()
});
static UNIT_MATRIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-(hz|microvolt)$").unwrap());
static PINCTRL_N: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^pinctrl-[0-9]").unwrap());

/// Rewrites a binding (as JSON) into the schema dt-schema validates with.
pub(crate) fn fixup_schema(schema: &mut Value) {
    let Some(map) = schema.as_object_mut() else {
        return;
    };
    for key in ["examples", "maintainers", "historical"] {
        map.remove(key);
    }
    add_select_schema(map);
    fixup_sub_schema(schema, &[]);
}

/// `path` with `key` appended.
fn join(path: &[String], key: &str) -> Vec<String> {
    let mut path = path.to_vec();
    path.push(key.to_owned());
    path
}

fn is_match(regex: &Regex, text: &str) -> bool {
    regex.is_match(text).unwrap_or(false)
}

/// Python's `isinstance(x, int)`, which also holds for booleans.
fn is_int(value: &Value) -> bool {
    value.is_i64() || value.is_u64() || value.is_boolean()
}

/// dt-schema's `_value_is_type`: the value of `key`, or its first item.
fn value_is(schema: &Map<String, Value>, key: &str, test: fn(&Value) -> bool) -> bool {
    match schema.get(key) {
        Some(Value::Array(items)) => items.first().is_some_and(test),
        Some(value) => test(value),
        None => false,
    }
}

pub(crate) fn is_int_schema(schema: &Value) -> bool {
    schema.as_object().is_some_and(|map| {
        ["const", "enum", "minimum", "maximum"]
            .iter()
            .any(|key| value_is(map, key, is_int))
    })
}

pub(crate) fn is_string_schema(schema: &Value) -> bool {
    schema.as_object().is_some_and(|map| {
        ["const", "enum", "pattern"]
            .iter()
            .any(|key| value_is(map, key, Value::is_string))
    })
}

/// Moves the keywords that constrain one value out of `schema`.
fn extract_single_schemas(schema: &mut Map<String, Value>) -> Value {
    let mut single = Map::new();
    for key in [
        "const",
        "enum",
        "pattern",
        "minimum",
        "maximum",
        "multipleOf",
    ] {
        if let Some(value) = schema.remove(key) {
            single.insert(key.to_owned(), value);
        }
    }
    Value::Object(single)
}

fn fixup_string_to_array(schema: &mut Map<String, Value>) {
    if !is_string_schema(&Value::Object(schema.clone())) {
        return;
    }
    let single = extract_single_schemas(schema);
    schema.insert("items".into(), json!([single]));
}

fn fixup_reg_schema(schema: &mut Map<String, Value>, path: &[String]) {
    if !path.iter().any(|p| p == "reg") {
        return;
    }
    let whole_is_int = is_int_schema(&Value::Object(schema.clone()));
    let single = match schema.get_mut("items") {
        Some(items) => {
            let item = match items {
                Value::Array(list) => match list.first_mut() {
                    Some(item) => item,
                    None => return,
                },
                item => item,
            };
            if !is_int_schema(item) {
                return;
            }
            match item.as_object_mut() {
                Some(item) => extract_single_schemas(item),
                None => return,
            }
        }
        None if whole_is_int => extract_single_schemas(schema),
        None => return,
    };
    schema.insert("items".into(), json!([{ "items": [single] }]));
}

fn has_size_keys(value: &Value) -> bool {
    value.as_object().is_some_and(|map| {
        ["items", "maxItems", "minItems"]
            .iter()
            .any(|key| map.contains_key(*key))
    })
}

fn is_matrix_schema(schema: &Map<String, Value>) -> bool {
    match schema.get("items") {
        Some(Value::Array(list)) => list.iter().any(has_size_keys),
        Some(items) => has_size_keys(items),
        None => false,
    }
}

fn fixup_remove_empty_items(schema: &mut Map<String, Value>) {
    let Some(items) = schema.get_mut("items") else {
        return;
    };
    let list = match items {
        Value::Array(list) => list,
        Value::Object(items) => {
            fixup_remove_empty_items(items);
            return;
        }
        _ => return,
    };
    for item in list.iter_mut() {
        let Some(item) = item.as_object_mut() else {
            continue;
        };
        item.remove("description");
        fixup_remove_empty_items(item);
        if !item.is_empty() {
            return;
        }
    }
    let count = list.len();
    schema.entry("type").or_insert_with(|| json!("array"));
    schema.entry("maxItems").or_insert_with(|| json!(count));
    schema.entry("minItems").or_insert_with(|| json!(count));
    schema.remove("items");
}

fn fixup_unit_suffix_props(schema: &mut Map<String, Value>, path: &[String]) {
    // The name of the innermost property this schema belongs to.
    let reversed: Vec<&String> = path.iter().rev().collect();
    let Some(index) = reversed
        .iter()
        .position(|p| matches!(p.as_str(), "properties" | "$defs" | "definitions"))
    else {
        return;
    };
    // Python's `path[idx - 1]` wraps around for index 0.
    let name = if index == 0 {
        reversed[reversed.len() - 1]
    } else {
        reversed[index - 1]
    };
    if schema.contains_key("$ref") {
        return;
    }
    let whole = Value::Object(schema.clone());
    if is_match(&UNIT_ARRAY, name) && is_int_schema(&whole) {
        let single = extract_single_schemas(schema);
        schema.insert("items".into(), json!([single]));
    } else if is_match(&UNIT_MATRIX, name) {
        if is_matrix_schema(schema) {
            return;
        }
        if ["items", "minItems", "maxItems"]
            .iter()
            .any(|key| schema.contains_key(*key))
        {
            schema.insert("items".into(), json!([whole]));
            schema.remove("minItems");
            schema.remove("maxItems");
        } else if is_int_schema(&whole) {
            let single = extract_single_schemas(schema);
            schema.insert("items".into(), json!([{ "items": [single] }]));
        }
    }
}

fn fixup_items_size(schema: &mut Value, path: &[String]) {
    match schema {
        Value::Array(list) => list.iter_mut().for_each(|s| fixup_items_size(s, path)),
        Value::Object(map) => {
            map.remove("description");
            if map.contains_key("items") {
                map.insert("type".into(), json!("array"));
                if let Some(Value::Array(list)) = map.get("items") {
                    let count = list.len();
                    map.entry("minItems").or_insert_with(|| json!(count));
                    map.entry("maxItems").or_insert_with(|| json!(count));
                }
                let path = join(path, "items");
                if let Some(items) = map.get_mut("items") {
                    fixup_items_size(items, &path);
                }
            } else if !path.iter().any(|p| p == "then" || p == "else") {
                match (map.get("minItems").cloned(), map.get("maxItems").cloned()) {
                    (None, Some(max)) => {
                        map.insert("minItems".into(), max);
                    }
                    (Some(min), None) => {
                        map.insert("maxItems".into(), min);
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

/// `dependencies` became `dependentRequired` and `dependentSchemas`.
fn fixup_schema_to_201909(schema: &mut Map<String, Value>) {
    let Some(Value::Object(dependencies)) = schema.remove("dependencies") else {
        return;
    };
    for (key, value) in dependencies {
        let target = if value.is_array() {
            "dependentRequired"
        } else {
            "dependentSchemas"
        };
        if let Value::Object(map) = schema.entry(target).or_insert_with(|| json!({})) {
            map.insert(key, value);
        }
    }
}

fn fixup_vals(schema: &mut Map<String, Value>, path: &[String]) {
    schema.remove("description");
    fixup_reg_schema(schema, path);
    fixup_remove_empty_items(schema);
    fixup_unit_suffix_props(schema, path);
    fixup_string_to_array(schema);
    let mut value = Value::Object(std::mem::take(schema));
    fixup_items_size(&mut value, path);
    if let Value::Object(map) = value {
        *schema = map;
    }
    fixup_schema_to_201909(schema);
}

/// `oneOf`/`anyOf` lists of plain `const`s become an `enum`, which reports
/// errors much better.
fn fixup_one_of_to_enum(schema: &mut Map<String, Value>) {
    let list = match (
        schema.get("anyOf"),
        schema.get("oneOf"),
        schema.get("items"),
    ) {
        (Some(list), _, _) | (None, Some(list), _) => list,
        (None, None, Some(Value::Object(_))) => {
            if let Some(Value::Object(items)) = schema.get_mut("items") {
                fixup_one_of_to_enum(items);
            }
            return;
        }
        _ => return,
    };
    let mut consts = Vec::new();
    for item in list.as_array().into_iter().flatten() {
        let Some(item) = item.as_object() else {
            return;
        };
        let Some(value) = item.get("const") else {
            return;
        };
        // dt-schema's test is `set(l) > {'const', 'description'}`.
        if item.contains_key("description") && item.len() > 2 {
            return;
        }
        consts.push(value.clone());
    }
    schema.remove("anyOf");
    schema.remove("oneOf");
    schema.insert("enum".into(), Value::Array(consts));
}

fn walk_properties(schema: &mut Value, path: &[String]) {
    let Some(map) = schema.as_object_mut() else {
        return;
    };
    fixup_one_of_to_enum(map);
    for key in ["allOf", "oneOf", "anyOf"] {
        if let Some(Value::Array(list)) = map.get_mut(key) {
            let path = join(path, key);
            list.iter_mut().for_each(|s| walk_properties(s, &path));
        }
    }
    if let Some(then) = map.get_mut("then") {
        walk_properties(then, &join(path, "then"));
    }
    fixup_vals(map, path);
}

fn fixup_interrupts(schema: &mut Map<String, Value>, path: &[String]) {
    if let Some(Value::Object(props)) = schema.get_mut("properties") {
        if (props.contains_key("interrupts") || props.contains_key("interrupt-controller"))
            && !props.contains_key("interrupt-parent")
        {
            props.insert("interrupt-parent".into(), json!(true));
        }
        if let Some(interrupts) = props.get("interrupts").cloned() {
            props.entry("interrupts-extended").or_insert(interrupts);
        }
    }

    let either =
        || json!([{ "required": ["interrupts"] }, { "required": ["interrupts-extended"] }]);
    let requires_interrupts = schema
        .get("required")
        .and_then(Value::as_array)
        .is_some_and(|r| r.iter().any(|v| v == "interrupts"));
    if requires_interrupts && path.last().is_none_or(|p| p != "oneOf") {
        if schema.contains_key("oneOf") {
            if let Value::Array(all) = schema.entry("allOf").or_insert_with(|| json!([])) {
                all.push(json!({ "oneOf": either() }));
            }
        } else {
            schema.insert("oneOf".into(), either());
        }
        if let Some(Value::Array(required)) = schema.get_mut("required") {
            if let Some(i) = required.iter().position(|v| v == "interrupts") {
                required.remove(i);
            }
            if required.is_empty() {
                schema.remove("required");
            }
        }
    }

    if let Some(Value::Object(dep_req)) = schema.get_mut("dependentRequired") {
        if let Some(value) = dep_req.get("interrupts").cloned() {
            dep_req.entry("interrupts-extended").or_insert(value);
        }
        let mut dependent_schemas = None;
        let mut emptied = None;
        for (prop, value) in dep_req.iter_mut() {
            let Value::Array(list) = value else { continue };
            let Some(i) = list.iter().position(|v| v == "interrupts") else {
                continue;
            };
            dependent_schemas = Some((prop.clone(), json!({ "oneOf": either() })));
            list.remove(i);
            if list.is_empty() {
                emptied = Some(prop.clone());
                break;
            }
        }
        if let Some(prop) = emptied {
            dep_req.remove(&prop);
        }
        let empty = dep_req.is_empty();
        if let Some((prop, value)) = dependent_schemas {
            schema.insert("dependentSchemas".into(), json!({ prop: value }));
        }
        if empty {
            schema.remove("dependentRequired");
        }
    }

    if let Some(Value::Object(dep)) = schema.get_mut("dependentSchemas") {
        if let Some(value) = dep.get("interrupts").cloned() {
            dep.entry("interrupts-extended").or_insert(value);
        }
    }
}

fn fixup_node_props(schema: &mut Map<String, Value>) {
    if !schema.contains_key("unevaluatedProperties") && !schema.contains_key("additionalProperties")
    {
        return;
    }
    let mut keys: Vec<String> = Vec::new();
    for key in ["properties", "patternProperties"] {
        if let Some(Value::Object(map)) = schema.get(key) {
            keys.extend(map.keys().cloned());
        }
    }
    let has = |name: &str| keys.iter().any(|k| k == name);
    fn props(schema: &mut Map<String, Value>) -> Option<&mut Map<String, Value>> {
        schema
            .entry("properties")
            .or_insert_with(|| json!({}))
            .as_object_mut()
    }

    if has("clocks") && !has("assigned-clocks") {
        if let Some(props) = props(schema) {
            for name in [
                "assigned-clocks",
                "assigned-clock-rates-u64",
                "assigned-clock-rates",
                "assigned-clock-parents",
                "assigned-clock-sscs",
            ] {
                props.insert(name.into(), json!(true));
            }
        }
    }
    if has("ranges") {
        if let Some(props) = props(schema) {
            props.entry("dma-ranges").or_insert(json!(true));
        }
    }
    if schema.get("additionalProperties") == Some(&json!(true))
        || schema.get("unevaluatedProperties") == Some(&json!(true))
    {
        return;
    }
    if let Some(props) = props(schema) {
        for name in [
            "phandle",
            "status",
            "secure-status",
            "$nodename",
            "bootph-pre-sram",
            "bootph-verify",
            "bootph-pre-ram",
            "bootph-some-ram",
            "bootph-all",
        ] {
            props.entry(name).or_insert(json!(true));
        }
    }
    if !keys.iter().any(|k| is_match(&PINCTRL_N, k)) {
        if let Some(props) = props(schema) {
            props.entry("pinctrl-names").or_insert(json!(true));
        }
        if let Value::Object(patterns) = schema
            .entry("patternProperties")
            .or_insert_with(|| json!({}))
        {
            patterns.insert("^pinctrl-[0-9]+$".into(), json!(true));
        }
    }
}

fn fixup_sub_schema(schema: &mut Value, path: &[String]) {
    let Some(map) = schema.as_object_mut() else {
        return;
    };
    map.remove("description");
    fixup_schema_to_201909(map);
    fixup_interrupts(map, path);
    fixup_node_props(map);
    // `additionalProperties: true` does not work with
    // `unevaluatedProperties`; common (incomplete) schemas have it.
    if map.get("additionalProperties") == Some(&json!(true)) {
        map.remove("additionalProperties");
    }

    for (key, value) in map.iter_mut() {
        let sub = join(path, key);
        match key.as_str() {
            "select" | "if" | "then" | "else" | "not" | "additionalProperties" => {
                fixup_sub_schema(value, &sub)
            }
            "allOf" | "anyOf" | "oneOf" => {
                if let Value::Array(list) = value {
                    list.iter_mut().for_each(|s| fixup_sub_schema(s, &sub));
                }
            }
            _ => {}
        }
        if !matches!(
            key.as_str(),
            "dependentRequired"
                | "dependentSchemas"
                | "properties"
                | "patternProperties"
                | "$defs"
                | "definitions"
        ) {
            continue;
        }
        let Value::Object(props) = value else {
            continue;
        };
        for (prop, spec) in props.iter_mut() {
            if VARIABLE_MATRIX_PROPS.contains(&prop.as_str()) && spec.is_object() {
                let reference = spec.get("$ref").cloned();
                *spec = match reference {
                    Some(r) => json!({ "$ref": r }),
                    None => json!({}),
                };
                continue;
            }
            let sub = join(&sub, prop);
            walk_properties(spec, &sub);
            fixup_sub_schema(spec, &sub);
        }
    }
}

/// A schema without `select` that matches by node name gets a `select` on
/// `$nodename`.
fn add_select_schema(schema: &mut Map<String, Value>) {
    if schema.contains_key("select") {
        return;
    }
    let Some(Value::Object(props)) = schema.get("properties") else {
        return;
    };
    if props.contains_key("compatible") {
        return;
    }
    match props.get("$nodename") {
        Some(name) if name != &json!(true) => {
            let select = json!({ "required": ["$nodename"], "properties": { "$nodename": name } });
            schema.insert("select".into(), select);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed(schema: Value) -> Value {
        let mut schema = schema;
        fixup_schema(&mut schema);
        schema
    }

    #[test]
    fn scalars_become_lists() {
        let schema = fixed(json!({
            "properties": {
                "compatible": { "const": "acme,foo" },
                "reg": { "maxItems": 1 },
                "acme,level": { "$ref": "/schemas/types.yaml#/definitions/uint32", "enum": [1, 2] },
            },
            "additionalProperties": false,
        }));
        let props = &schema["properties"];
        assert_eq!(
            props["compatible"],
            json!({ "items": [{ "const": "acme,foo" }], "type": "array", "minItems": 1, "maxItems": 1 })
        );
        assert_eq!(props["reg"], json!({ "maxItems": 1, "minItems": 1 }));
        // Typed properties keep their scalar form: the type definition wraps them.
        assert_eq!(props["acme,level"]["enum"], json!([1, 2]));
        // Every node may carry these.
        assert_eq!(props["status"], json!(true));
        assert_eq!(schema["patternProperties"]["^pinctrl-[0-9]+$"], json!(true));
    }

    #[test]
    fn reg_items_become_a_matrix() {
        let schema = fixed(
            json!({ "properties": { "reg": { "items": [{ "description": "a" }, { "description": "b" }] } } }),
        );
        assert_eq!(
            schema["properties"]["reg"],
            json!({ "type": "array", "minItems": 2, "maxItems": 2 })
        );
    }

    #[test]
    fn interrupts_or_interrupts_extended_is_required() {
        let schema = fixed(json!({
            "properties": { "interrupts": { "maxItems": 1 } },
            "required": ["reg", "interrupts"],
        }));
        assert_eq!(schema["required"], json!(["reg"]));
        assert_eq!(
            schema["oneOf"],
            json!([{ "required": ["interrupts"] }, { "required": ["interrupts-extended"] }])
        );
        assert_eq!(schema["properties"]["interrupt-parent"], json!(true));
        assert!(schema["properties"]["interrupts-extended"].is_object());
    }

    #[test]
    fn a_list_of_consts_becomes_an_enum() {
        let schema = fixed(json!({ "properties": { "mode": {
            "oneOf": [{ "const": "a", "description": "A" }, { "const": "b" }]
        } } }));
        assert_eq!(
            schema["properties"]["mode"]["items"],
            json!([{ "enum": ["a", "b"] }])
        );
    }

    #[test]
    fn node_name_schemas_select_by_name() {
        let schema = fixed(json!({ "properties": { "$nodename": { "pattern": "^cpus$" } } }));
        assert_eq!(schema["select"]["required"], json!(["$nodename"]));
    }
}
