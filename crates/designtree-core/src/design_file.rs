//! The design file: the graph as JSON, indented so it reads and diffs well,
//! with each array of numbers on one line (US-11.3). Pretty JSON puts every
//! number of a 4 KiB init sequence on a line of its own, which made the
//! files of large boards several times larger than their content.

use crate::model::Graph;

/// The design file of `graph`.
pub fn to_design_json(graph: &Graph) -> serde_json::Result<String> {
    Ok(compact_number_arrays(&serde_json::to_string_pretty(graph)?))
}

/// Pretty JSON with every array holding only numbers on one line. In pretty
/// JSON a string never spans lines, so a line that is a number is one.
fn compact_number_arrays(pretty: &str) -> String {
    let lines: Vec<&str> = pretty.lines().collect();
    let mut out = String::with_capacity(pretty.len());
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.ends_with('[') {
            let numbers: Vec<&str> = lines[i + 1..]
                .iter()
                .map(|l| l.trim().trim_end_matches(','))
                .take_while(|l| is_number(l))
                .collect();
            let close = lines.get(i + 1 + numbers.len()).map(|l| l.trim());
            if !numbers.is_empty() && matches!(close, Some("]" | "],")) {
                out.push_str(line);
                out.push_str(&numbers.join(", "));
                out.push_str(close.unwrap());
                out.push('\n');
                i += numbers.len() + 2;
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
        i += 1;
    }
    out
}

fn is_number(text: &str) -> bool {
    !text.is_empty()
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || "-+.eE".contains(c))
        && text.chars().any(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrays_of_numbers_take_one_line() {
        let pretty = "{\n  \"a\": [\n    1,\n    -2.5,\n    3e4\n  ],\n  \"b\": [\n    \"x\",\n    1\n  ],\n  \"c\": [\n    [\n      1,\n      2\n    ]\n  ]\n}";
        assert_eq!(
            compact_number_arrays(pretty),
            "{\n  \"a\": [1, -2.5, 3e4],\n  \"b\": [\n    \"x\",\n    1\n  ],\n  \"c\": [\n    [1, 2]\n  ]\n}\n"
        );
    }

    #[test]
    fn the_file_reads_back_as_the_same_design() {
        let source = "/dts-v1/;\n/ {\n\tseq = [00 11 22 33 44 55 66 77 88 99];\n\treg = <1 2 3 4>;\n\tname = \"x\";\n};\n";
        let graph = crate::import_dts(
            source,
            std::path::Path::new("board.dts"),
            &crate::ImportOptions::default(),
        )
        .unwrap();
        let file = to_design_json(&graph).unwrap();
        assert!(
            file.contains("[0, 17, 34, 51, 68, 85, 102, 119, 136, 153]"),
            "{file}"
        );
        let back: Graph = serde_json::from_str(&file).unwrap();
        assert_eq!(
            serde_json::to_value(&back).unwrap(),
            serde_json::to_value(&graph).unwrap()
        );
        assert!(file.len() < serde_json::to_string_pretty(&graph).unwrap().len());
    }
}
