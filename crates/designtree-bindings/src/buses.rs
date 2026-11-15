//! Where a binding's nodes go (US-18.4), read from the schema's own
//! `examples`: kernel bindings show each device inside the node it hangs
//! from (`i2c { sensor@48 { … } }`, `cpus { cpu@0 { … } }`), or at the top
//! of the example for a memory-mapped device. The parent's name, reduced to
//! a bus class, is what the library's "Fits here" section and the placement
//! warning compare with the scope a node is in.

/// The bus class of a node name: the name without labels, unit address and
/// instance number (`i2c@1c2ac00` and `i2c0` are both `i2c`), and `mmio` for
/// the root and the plain memory-mapped buses a SoC's devices sit on. The
/// editor has the same function in `app/src/fits.ts`; keep the two alike.
pub fn bus_class(name: &str) -> String {
    let name = name.rsplit(':').next().unwrap_or(name).trim();
    let base = name.split('@').next().unwrap_or(name);
    let base = base
        .trim_end_matches(|c: char| c.is_ascii_digit())
        .trim_end_matches(['-', '_']);
    let base = base.to_ascii_lowercase();
    match base.as_str() {
        "" | "/" | "soc" | "bus" | "simple-bus" | "apb" | "ahb" | "axi" | "aips-bus" | "aips" => {
            "mmio".to_owned()
        }
        "pcie" => "pci".to_owned(),
        _ => base,
    }
}

/// The bus classes the nodes with one of `compatibles` are under in
/// `examples`, sorted and without repeats.
pub fn example_buses(examples: &[&str], compatibles: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for example in examples {
        scan(&strip_comments(example), compatibles, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

/// Walks one example's nodes, noting the parent of each node whose
/// `compatible` names one of `compatibles`.
fn scan(text: &str, compatibles: &[String], out: &mut Vec<String>) {
    let mut stack: Vec<String> = Vec::new();
    let mut statement = String::new();
    for c in text.chars() {
        match c {
            '{' => {
                stack.push(node_name(&statement));
                statement.clear();
            }
            '}' => {
                stack.pop();
                statement.clear();
            }
            ';' => {
                if names_one_of(&statement, compatibles) && !stack.is_empty() {
                    // A device at the top of the example has no parent shown:
                    // it sits on the SoC's memory-mapped bus.
                    let parent = stack
                        .len()
                        .checked_sub(2)
                        .map_or("/", |i| stack[i].as_str());
                    out.push(bus_class(parent));
                }
                statement.clear();
            }
            _ => statement.push(c),
        }
    }
}

/// The node name at the end of the text before a `{`: `lbl: i2c@0` gives
/// `i2c@0`, `/` the root.
fn node_name(statement: &str) -> String {
    statement.split_whitespace().last().unwrap_or("").to_owned()
}

/// Whether a statement is `compatible = "…", …` naming one of `compatibles`.
fn names_one_of(statement: &str, compatibles: &[String]) -> bool {
    let Some((name, value)) = statement.split_once('=') else {
        return false;
    };
    name.trim() == "compatible"
        && value
            .split('"')
            .skip(1)
            .step_by(2)
            .any(|s| compatibles.iter().any(|c| c == s))
}

fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('/') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        if after.starts_with("//") {
            rest = after.find('\n').map_or("", |j| &after[j..]);
        } else if after.starts_with("/*") {
            rest = after.find("*/").map_or("", |j| &after[j + 2..]);
        } else {
            out.push('/');
            rest = &after[1..];
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes_drop_labels_units_and_numbers() {
        assert_eq!(bus_class("i2c@1c2ac00"), "i2c");
        assert_eq!(bus_class("i2c0"), "i2c");
        assert_eq!(bus_class("spi_1"), "spi");
        assert_eq!(bus_class("cpus"), "cpus");
        assert_eq!(bus_class("/"), "mmio");
        assert_eq!(bus_class("soc@0"), "mmio");
        assert_eq!(bus_class("ahb"), "mmio");
    }

    #[test]
    fn finds_the_parent_of_the_documented_node() {
        let compatibles = vec!["ti,tmp102".to_owned()];
        let i2c = "i2c {\n  #address-cells = <1>;\n  #size-cells = <0>;\n\n  /* the sensor */\n  sensor@48 {\n    compatible = \"ti,tmp102\";\n    reg = <0x48>;\n  };\n};\n";
        assert_eq!(example_buses(&[i2c], &compatibles), ["i2c"]);
        // A device on its own at the top: a memory-mapped one.
        let mmio = "serial@1c28000 {\n  compatible = \"other\", \"ti,tmp102\";\n};";
        assert_eq!(example_buses(&[mmio, i2c], &compatibles), ["i2c", "mmio"]);
        // Other nodes of the example, such as a provider it references, are not counted.
        let other = "clk: clock { compatible = \"fixed-clock\"; };\nspi { dev@0 { compatible = \"ti,tmp102\"; }; };";
        assert_eq!(example_buses(&[other], &compatibles), ["spi"]);
    }
}
