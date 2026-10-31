//! Turns the raw properties of a devicetree blob into the values schemas
//! are written against, like dt-schema's `dtschema/dtb.py`: integers sized
//! and signed by the property's type, cell lists split into the matrix the
//! type implies (`reg` by `#address-cells`/`#size-cells`, phandle lists by
//! the provider's `#*-cells`), strings as lists.
//!
//! A value that cannot be decoded stays raw; it is written as a string in
//! dts byte syntax (`[00 01]`), which, like dt-schema's `bytes`, fails every
//! type a binding expects.

use std::collections::{BTreeSet, HashMap};

use serde_json::{json, Map, Value};

use super::fdt::FdtNode;
use super::types::{Dim, TypeDb};

/// A node with decoded properties, in blob order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Node {
    pub name: String,
    pub props: Vec<(String, Value)>,
    /// Width in bits of the integers of each property decoded with another
    /// width than 32 (`uint64`, `uint8-array`), for the `typeSize` keyword.
    pub sizes: HashMap<String, u8>,
    pub children: Vec<Node>,
}

impl Node {
    fn get(&self, name: &str) -> Option<&Value> {
        self.props.iter().find(|(n, _)| n == name).map(|(_, v)| v)
    }

    fn has(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    /// The node as a schema instance: properties, then child nodes.
    pub fn to_json(&self) -> Map<String, Value> {
        let mut map: Map<String, Value> = self.props.iter().cloned().collect();
        for child in &self.children {
            map.insert(child.name.clone(), Value::Object(child.to_json()));
        }
        map
    }
}

/// A property dt-schema could not decode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecodeError {
    /// Full path of the node.
    pub path: String,
    pub property: String,
    pub message: String,
}

fn raw(data: &[u8]) -> Value {
    let hex: Vec<String> = data.iter().map(|b| format!("{b:02x}")).collect();
    Value::String(format!("[{}]", hex.join(" ")))
}

fn is_raw(value: &Value) -> bool {
    value.is_string()
}

fn split_strings(data: &[u8]) -> Value {
    let data = data.strip_suffix(&[0]).unwrap_or(data);
    let strings: Vec<Value> = data
        .split(|b| *b == 0)
        .map(|s| Value::String(String::from_utf8_lossy(s).into_owned()))
        .collect();
    Value::Array(strings)
}

/// dt-schema's `bytes_to_string`: the value as strings, when it looks like
/// a list of printable, non-empty strings.
fn bytes_to_strings(data: &[u8]) -> Option<Value> {
    if !data.is_ascii() || data.last() != Some(&0) {
        return None;
    }
    let body = &data[..data.len() - 1];
    if body.is_empty() {
        // `""` alone is not taken for a string list.
        return None;
    }
    let printable = body
        .split(|b| *b == 0)
        .all(|s| !s.is_empty() && s.iter().all(|b| (0x20..0x7f).contains(b)));
    printable.then(|| split_strings(data))
}

/// Size in bytes and signedness of a type's elements.
fn element(ty: &str) -> Option<(usize, bool)> {
    let base = ty.split('-').next().unwrap_or(ty);
    Some(match base {
        "int8" => (1, true),
        "uint8" => (1, false),
        "int16" => (2, true),
        "uint16" => (2, false),
        "int32" => (4, true),
        "uint32" | "phandle" | "address" => (4, false),
        "int64" => (8, true),
        "uint64" => (8, false),
        _ => return None,
    })
}

fn unpack(data: &[u8], size: usize, signed: bool) -> Option<Vec<Value>> {
    if data.len() % size != 0 {
        return None;
    }
    Some(
        data.chunks(size)
            .map(|c| {
                let mut word = 0u64;
                for b in c {
                    word = word << 8 | u64::from(*b);
                }
                if signed {
                    let shift = 64 - 8 * size as u32;
                    json!(((word << shift) as i64) >> shift)
                } else {
                    json!(word)
                }
            })
            .collect(),
    )
}

/// dt-schema's `get_stride`: the length of each row of a matrix.
fn stride(len: usize, dim: Dim) -> usize {
    let len64 = len as u64;
    let ((omin, omax), (imin, imax)) = dim;
    let omax = if omax == 0 { len64 } else { omax };
    let imax = if imax == 0 { len64 } else { imax };
    for outer in omin..=omax {
        for inner in imin..=imax {
            if outer * inner == len64 {
                return inner as usize;
            }
        }
    }
    if imin > 0 && imin == imax {
        return imin as usize;
    }
    if omin > 0 && omin == omax {
        return (len64 / omin) as usize;
    }
    len
}

fn rows(values: Vec<Value>, stride: usize) -> Value {
    let stride = stride.max(1);
    Value::Array(
        values
            .chunks(stride)
            .map(|c| Value::Array(c.to_vec()))
            .collect(),
    )
}

struct Decoder<'a> {
    types: &'a TypeDb,
    errors: Vec<DecodeError>,
    /// Integer width of the value last decoded.
    bits: u8,
}

impl Decoder<'_> {
    /// dt-schema's `prop_value`.
    fn value(&mut self, path: &str, node_name: &str, name: &str, data: &[u8]) -> Value {
        self.bits = 32;
        if data.is_empty() {
            return Value::Bool(true);
        }
        if name != "phandle" && matches!(node_name, "__fixups__" | "aliases") {
            return split_strings(data);
        }
        let mut types: BTreeSet<String> = self.types.types(name);
        types.remove("node");
        if types.is_empty() {
            return raw(data);
        }

        let len = data.len();
        if types.len() > 1 {
            let mut drop = |names: &[&str]| {
                for n in names {
                    types.remove(*n);
                }
            };
            if len % 8 != 0 {
                drop(&["int64", "uint64", "int64-array", "uint64-array"]);
            }
            if len % 4 != 0 {
                drop(&[
                    "int32",
                    "uint32",
                    "int32-array",
                    "uint32-array",
                    "phandle",
                    "phandle-array",
                ]);
            }
            if len % 2 != 0 {
                drop(&["int16", "uint16", "int16-array", "uint16-array"]);
            }
            if len > 4 {
                drop(&["int32", "uint32", "phandle"]);
            } else {
                drop(&["int64", "uint64", "int64-array", "uint64-array"]);
            }
            if len > 2 {
                drop(&["int16", "uint16"]);
            } else {
                drop(&[
                    "int32",
                    "uint32",
                    "int32-array",
                    "uint32-array",
                    "phandle",
                    "phandle-array",
                ]);
            }
            if len > 1 {
                drop(&["int8", "uint8"]);
            } else {
                drop(&["int16", "uint16", "int16-array", "uint16-array"]);
            }
            drop(&["flag"]);
            for (signed, unsigned) in [
                ("int64", "uint64"),
                ("int32", "uint32"),
                ("int16", "uint16"),
                ("int8", "uint8"),
            ] {
                if types.contains(signed) && types.contains(unsigned) {
                    types.remove(unsigned);
                }
            }
        }

        let mut dim = if name == "iommu-map" {
            None
        } else {
            self.types.dim(name)
        };
        let matrix: BTreeSet<String> = types
            .iter()
            .filter(|t| t.contains("matrix") || *t == "phandle-array")
            .cloned()
            .collect();

        let mut fmt: Option<String> = None;
        if types.len() > 1 {
            if name == "dma-masters" || name == "mode-gpios" {
                fmt = Some("phandle-array".into());
            } else if name == "gpios" {
                fmt = Some(if node_name.contains("hog") {
                    "uint32-matrix".into()
                } else {
                    "phandle-array".into()
                });
            } else if name == "cooling-levels" {
                fmt = Some(if data.len() >= 2 && data[0] == 0 && data[1] == 0 {
                    "uint32-array".into()
                } else {
                    "uint8-array".into()
                });
            } else if types.contains("string") || types.contains("string-array") {
                if let Some(strings) = bytes_to_strings(data) {
                    return strings;
                }
                match types
                    .iter()
                    .find(|t| *t != "string" && *t != "string-array")
                {
                    Some(other) => fmt = Some(other.clone()),
                    None => return raw(data),
                }
            } else if !matrix.is_empty() {
                let scalars: Vec<&String> = types.difference(&matrix).collect();
                if let [scalar] = scalars.as_slice() {
                    let min = match dim {
                        Some(((omin, _), (imin, _))) => imin.max(1) * omin,
                        None => 1,
                    };
                    let size = element(scalar).map_or(4, |(size, _)| size);
                    if (len / size) as u64 >= min {
                        fmt = matrix.iter().next().cloned();
                    } else {
                        fmt = Some((*scalar).clone());
                        dim = Some(((1, 1), (1, 1)));
                    }
                }
            }
        }
        let fmt = match fmt.or_else(|| types.iter().next().cloned()) {
            Some(fmt) => fmt,
            None => return raw(data),
        };

        if fmt.starts_with("string") {
            if data.last() != Some(&0) {
                return raw(data);
            }
            return split_strings(data);
        }
        if types.contains("flag") && fmt == "flag" {
            self.errors.push(DecodeError {
                path: path.to_owned(),
                property: name.to_owned(),
                message: format!("boolean property with value {}", raw(data)),
            });
            return raw(data);
        }

        let Some((size, signed)) = element(&fmt) else {
            return raw(data);
        };
        self.bits = size as u8 * 8;
        let values = match unpack(data, size, signed) {
            Some(values) => values,
            None => {
                self.errors.push(DecodeError {
                    path: path.to_owned(),
                    property: name.to_owned(),
                    message: format!("size ({len}) error for type {fmt}"),
                });
                let size = match len {
                    4 => 4,
                    2 => 2,
                    1 => 1,
                    _ => return raw(data),
                };
                self.bits = size as u8 * 8;
                unpack(data, size, false).unwrap_or_default()
            }
        };

        if fmt.contains("matrix") || matches!(fmt.as_str(), "phandle" | "phandle-array" | "address")
        {
            let stride = match dim {
                Some(dim) => stride(values.len(), dim),
                None => values.len(),
            };
            rows(values, stride)
        } else if !fmt.contains("array") && values.len() == 1 {
            values.into_iter().next().unwrap()
        } else {
            Value::Array(values)
        }
    }

    fn node(&mut self, fdt: &FdtNode, path: &str) -> Node {
        let name = if path == "/" {
            "/".to_owned()
        } else {
            fdt.name.clone()
        };
        let mut sizes = HashMap::new();
        let mut props = Vec::new();
        for (prop, data) in &fdt.properties {
            let value = self.value(path, &name, prop, data);
            if self.bits != 32 {
                sizes.insert(prop.clone(), self.bits);
            }
            props.push((prop.clone(), value));
        }
        let children = fdt
            .children
            .iter()
            .filter(|c| !c.name.starts_with("__"))
            .map(|c| self.node(c, &child_path(path, &c.name)))
            .collect();
        Node {
            name,
            props,
            sizes,
            children,
        }
    }
}

pub(crate) fn child_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

/// The `#*-cells` values of every node with a phandle, by phandle.
type Providers = HashMap<u64, HashMap<String, u64>>;

fn providers(node: &FdtNode, out: &mut Providers) {
    let word =
        |data: &[u8]| -> Option<u64> { Some(u64::from(u32::from_be_bytes(data.try_into().ok()?))) };
    let phandle = node
        .properties
        .iter()
        .find(|(n, _)| n == "phandle" || n == "linux,phandle")
        .and_then(|(_, v)| word(v));
    if let Some(phandle) = phandle {
        let cells = node
            .properties
            .iter()
            .filter(|(n, _)| n.starts_with('#'))
            .filter_map(|(n, v)| Some((n.clone(), word(v)?)))
            .collect();
        out.insert(phandle, cells);
    }
    for child in &node.children {
        providers(child, out);
    }
}

fn cells_of(node: &Node, name: &str) -> u64 {
    node.get(name).and_then(Value::as_u64).unwrap_or(0)
}

/// The first row of a value decoded as a matrix (`[[...]]`).
fn single_row(value: &Value) -> Option<Vec<Value>> {
    match value {
        Value::Array(rows) => rows.first()?.as_array().cloned(),
        _ => None,
    }
}

fn as_u64s(row: &[Value]) -> Vec<u64> {
    row.iter().map(|v| v.as_u64().unwrap_or(u64::MAX)).collect()
}

fn chunked(row: &[Value], sizes: impl FnMut(usize) -> Option<usize>) -> Value {
    let mut sizes = sizes;
    let mut out = Vec::new();
    let mut i = 0;
    while i < row.len() {
        let Some(n) = sizes(i).filter(|n| *n > 0) else {
            break;
        };
        out.push(Value::Array(row[i..(i + n).min(row.len())].to_vec()));
        i += n;
    }
    Value::Array(out)
}

/// Property names whose provider cell count does not follow `foos` /
/// `#foo-cells`, from dt-schema.
fn phandle_args(name: &str) -> Option<Option<Cells>> {
    let cells = match name {
        "assigned-clocks" | "assigned-clock-parents" => "#clock-cells",
        "cooling-device" => "#cooling-cells",
        "interrupts-extended" | "msi-ranges" => "#interrupt-cells",
        "interconnects" => "#interconnect-cells",
        "mboxes" => "#mbox-cells",
        "sound-dai" => "#sound-dai-cells",
        "msi-parent" => "#msi-cells",
        "dma-masters" => "#dma-cells",
        "gpio-ranges" => return Some(Some(Cells::Fixed(3))),
        "memory-region" => return Some(None),
        _ => return None,
    };
    Some(Some(Cells::Named(cells.to_owned())))
}

/// How many argument cells follow a phandle: a provider property, or a
/// fixed count.
enum Cells {
    Named(String),
    Fixed(u64),
}

struct Fixer<'a> {
    types: &'a TypeDb,
    providers: Providers,
}

impl Fixer<'_> {
    fn provider_cells(&self, phandle: u64, cells: &Cells) -> Option<u64> {
        match cells {
            Cells::Fixed(n) => Some(*n),
            Cells::Named(name) => self.provider(phandle).map(|p| cell(p, name)),
        }
    }

    fn provider(&self, phandle: u64) -> Option<&HashMap<String, u64>> {
        self.providers.get(&phandle)
    }

    /// dt-schema's `fixup_gpios`.
    fn gpios(&self, node: &mut Node) {
        if node.has("gpio-hog") {
            return;
        }
        for (name, value) in node.props.iter_mut() {
            let gpio = name.ends_with("-gpios")
                || name.ends_with("-gpio")
                || name == "gpio"
                || name == "gpios";
            if !gpio || name.ends_with(",nr-gpios") || !value.is_array() {
                continue;
            }
            let Some(row) = single_row(value) else {
                continue;
            };
            let cells = as_u64s(&row);
            let mut broken = false;
            let split = chunked(&row, |i| {
                let phandle = cells[i];
                if phandle == 0 {
                    return Some(1);
                }
                match self.provider_cells(phandle, &Cells::Named("#gpio-cells".into())) {
                    Some(n) => Some(n as usize + 1),
                    None => {
                        broken = true;
                        None
                    }
                }
            });
            if !broken {
                *value = split;
            }
        }
        for child in node.children.iter_mut() {
            self.gpios(child);
        }
    }

    /// dt-schema's `fixup_interrupts`.
    fn interrupts(&self, node: &mut Node, inherited: u64) {
        let mut icells = inherited;
        if let Some(parent) = node.get("interrupt-parent").and_then(single_row) {
            if let Some(phandle) = parent.first().and_then(Value::as_u64) {
                if phandle == 0xffff_ffff {
                    node.props.retain(|(n, _)| n != "interrupt-parent");
                } else if let Some(n) =
                    self.provider_cells(phandle, &Cells::Named("#interrupt-cells".into()))
                {
                    icells = n;
                }
            }
        }
        let own_cells = node
            .get("#interrupt-cells")
            .map(|_| cells_of(node, "#interrupt-cells"));
        let address_cells = cells_of(node, "#address-cells");
        for i in 0..node.props.len() {
            let (name, value) = &node.props[i];
            if is_raw(value) {
                continue;
            }
            let Some(row) = single_row(value) else {
                continue;
            };
            let split = match name.as_str() {
                "interrupts" => {
                    let n = icells as usize;
                    chunked(&row, |_| Some(n))
                }
                "interrupt-map" => {
                    let imap = own_cells.unwrap_or(0) as usize;
                    let ac = address_cells as usize;
                    let cells = as_u64s(&row);
                    let Some(&phandle) = cells.get(ac + imap) else {
                        continue;
                    };
                    if phandle == 0xffff_ffff {
                        continue;
                    }
                    let Some(provider) = self.provider(phandle) else {
                        continue;
                    };
                    let n = ac
                        + imap
                        + 1
                        + cell(provider, "#address-cells") as usize
                        + cell(provider, "#interrupt-cells") as usize;
                    // dt-schema assumes one provider (and cell count) per map.
                    chunked(&row, |_| Some(n))
                }
                _ => continue,
            };
            node.props[i].1 = split;
        }
        let for_children = own_cells.unwrap_or(icells);
        for child in node.children.iter_mut() {
            self.interrupts(child, for_children);
        }
    }

    /// dt-schema's `fixup_addresses`.
    fn addresses(&self, node: &mut Node, ac: u64, sc: u64) {
        let child_ac = node
            .get("#address-cells")
            .map_or(ac, |_| cells_of(node, "#address-cells"));
        let child_sc = node
            .get("#size-cells")
            .map_or(sc, |_| cells_of(node, "#size-cells"));
        let own = cells_of(node, "#address-cells") + cells_of(node, "#size-cells");
        for (name, value) in node.props.iter_mut() {
            let n = if self.types.types(name).contains("address") {
                ac + sc
            } else if (name == "ranges" || name == "dma-ranges") && !value.is_boolean() {
                ac + own
            } else {
                continue;
            };
            if is_raw(value) || n == 0 {
                continue;
            }
            if let Some(row) = single_row(value) {
                *value = chunked(&row, |_| Some(n as usize));
            }
        }
        for child in node.children.iter_mut() {
            self.addresses(child, child_ac, child_sc);
        }
    }

    /// dt-schema's `fixup_iommu_map`.
    fn iommu_map(&self, node: &mut Node) {
        let map_cells = match cells_of(node, "#iommu-cells") {
            0 => 1,
            n => n as usize,
        };
        for i in 0..node.props.len() {
            if node.props[i].0 != "iommu-map" {
                continue;
            }
            let Some(row) = single_row(&node.props[i].1) else {
                continue;
            };
            let cells = as_u64s(&row);
            let Some(&phandle) = cells.get(map_cells) else {
                continue;
            };
            let split = if phandle == 0xffff_ffff {
                let n = cells[map_cells + 1..]
                    .iter()
                    .position(|c| *c == 0xffff_ffff)
                    .map_or(cells.len(), |p| p + 1);
                chunked(&row, |_| Some(n))
            } else {
                let mut broken = false;
                let split = chunked(&row, |i| {
                    let Some(&phandle) = cells.get(i + map_cells) else {
                        return Some(cells.len() - i);
                    };
                    match self.provider_cells(phandle, &Cells::Named("#iommu-cells".into())) {
                        Some(n) => Some(map_cells + 1 + n as usize + 1),
                        None => {
                            broken = true;
                            None
                        }
                    }
                });
                if broken {
                    continue;
                }
                split
            };
            node.props[i].1 = split;
        }
        for child in node.children.iter_mut() {
            self.iommu_map(child);
        }
    }

    /// dt-schema's `_get_phandle_arg_size`.
    fn arg_size(&self, cells: &[u64], spec: &Option<Cells>) -> usize {
        let Some(&phandle) = cells.first() else {
            return 0;
        };
        let Some(spec) = spec else { return 1 };
        if phandle == 0 {
            return 1;
        }
        if phandle == 0xffff_ffff {
            return 0;
        }
        match self.provider_cells(phandle, spec) {
            Some(n) => n as usize + 1,
            None => 0,
        }
    }

    /// dt-schema's `fixup_phandles`.
    fn phandles(&self, node: &mut Node) {
        for i in 0..node.props.len() {
            let name = node.props[i].0.clone();
            if !self.types.types(&name).contains("phandle-array") {
                continue;
            }
            if name != "dma-masters" && self.types.fixed_dimensions(&name) {
                continue;
            }
            let value = &node.props[i].1;
            let Value::Array(rows) = value else { continue };
            if rows.len() != 1 || !rows[0].is_array() {
                continue;
            }
            let row = rows[0].as_array().cloned().unwrap_or_default();
            let cells = as_u64s(&row);
            let spec = match phandle_args(&name) {
                Some(spec) => spec,
                None if name.ends_with('s') && !name.contains("gpio") => {
                    let spec = Some(Cells::Named(format!("#{}-cells", &name[..name.len() - 1])));
                    if self.arg_size(&cells, &spec) == 0 {
                        continue;
                    }
                    spec
                }
                None => continue,
            };

            // dt-schema's guess for a type collision: a small `dma-masters`
            // value that is no DMA provider is a number.
            if name == "dma-masters" {
                let phandle = cells.first().copied().unwrap_or(0);
                let provider = self.provider(phandle);
                if (1..=4).contains(&phandle)
                    && provider.is_none_or(|p| !p.contains_key("#dma-cells"))
                {
                    node.props[i].1 = json!(phandle);
                    continue;
                }
            }

            let mut out = Vec::new();
            let mut at = 0;
            while at < cells.len() {
                let mut n = self.arg_size(&cells[at..], &spec);
                if n == 0 {
                    break;
                }
                if name == "msi-ranges" {
                    n += 1;
                }
                if name == "interconnects" {
                    n += self.arg_size(cells.get(at + n..).unwrap_or_default(), &spec);
                }
                out.push(Value::Array(row[at..(at + n).min(row.len())].to_vec()));
                at += n;
            }
            node.props[i].1 = Value::Array(out);
        }
        for child in node.children.iter_mut() {
            self.phandles(child);
        }
    }
}

fn cell(provider: &HashMap<String, u64>, name: &str) -> u64 {
    provider.get(name).copied().unwrap_or(0)
}

/// Decodes a parsed blob like dt-schema's `fdt_unflatten`.
pub(crate) fn decode(types: &TypeDb, root: &FdtNode) -> (Node, Vec<DecodeError>) {
    let mut decoder = Decoder {
        types,
        errors: Vec::new(),
        bits: 32,
    };
    let mut node = decoder.node(root, "/");
    let mut providers_map = Providers::new();
    providers(root, &mut providers_map);
    let fixer = Fixer {
        types,
        providers: providers_map,
    };
    fixer.gpios(&mut node);
    fixer.interrupts(&mut node, 1);
    fixer.addresses(&mut node, 2, 1);
    fixer.iommu_map(&mut node);
    fixer.phandles(&mut node);
    (node, decoder.errors)
}
