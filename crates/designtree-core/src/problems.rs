//! dtc's messages as problems attached to design nodes.
//!
//! dtc prints one message per line on stderr, with the position in the
//! source it was given and, for checks, the path of the node:
//!
//! ```text
//! <stdin>:4.7-5.4: Warning (unit_address_vs_reg): /n@10: node has a unit name, ...
//! <stdin>:2.5-9 syntax error
//! ```
//!
//! The position is mapped back to a node with the [`SourceMap`] of the
//! generated source; messages without a usable position fall back to the
//! node path in the message.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dts::SourceMap;
use crate::model::NodeId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct Problem {
    pub severity: Severity,
    pub message: String,
    /// Line in the generated source, when dtc gave one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// The node the message is about, when it could be found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<NodeId>,
}

/// The problems in dtc's stderr, located with `map`.
pub fn parse_problems(stderr: &str, map: &SourceMap) -> Vec<Problem> {
    stderr
        .lines()
        .filter_map(|line| parse_line(line.trim(), map))
        .collect()
}

fn parse_line(line: &str, map: &SourceMap) -> Option<Problem> {
    let lower = line.to_ascii_lowercase();
    let severity = if lower.contains("error") {
        Severity::Error
    } else if lower.contains("warning") {
        Severity::Warning
    } else {
        return None;
    };

    let position = line
        .find("<stdin>:")
        .map(|at| &line[at + "<stdin>:".len()..]);
    let line_number = position.and_then(leading_number);

    // What follows the position and the check name: `/path: message` or
    // just the message.
    let mut message = line;
    if let Some(at) = line.find("): ") {
        message = &line[at + 3..];
    } else if let Some(position) = position {
        let rest = position.trim_start_matches(|c: char| c.is_ascii_digit() || ".-".contains(c));
        message = rest.trim_start_matches(':').trim();
    } else if let Some(at) = lower.find("error:") {
        message = line[at + "error:".len()..].trim();
    }
    let mut path = None;
    if message.starts_with('/') {
        if let Some((head, rest)) = message.split_once(": ") {
            // `/node:property` names a property of the node.
            path = Some(head.split(':').next().unwrap_or(head));
            message = rest;
        }
    }

    let node = line_number
        .and_then(|n| map.node_at_line(n))
        .or_else(|| path.and_then(|p| map.node_at_path(p)))
        .map(|span| span.node.clone());
    Some(Problem {
        severity,
        message: message.to_owned(),
        line: line_number,
        node,
    })
}

fn leading_number(text: &str) -> Option<u32> {
    let digits: String = text.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dts::NodeSpan;

    fn map() -> SourceMap {
        let span = |id: &str, path: &str, first, last| NodeSpan {
            node: id.into(),
            path: path.into(),
            first_line: first,
            last_line: last,
        };
        let mut map = SourceMap::default();
        map.spans = vec![span("root", "/", 2, 9), span("n1", "/n@10", 4, 6)];
        map
    }

    #[test]
    fn warning_with_position_and_path() {
        let text = "<stdin>:4.7-5.4: Warning (unit_address_vs_reg): /n@10: node has a unit name, but no reg or ranges property";
        let problems = parse_problems(text, &map());
        assert_eq!(problems.len(), 1);
        assert_eq!(problems[0].severity, Severity::Warning);
        assert_eq!(problems[0].line, Some(4));
        assert_eq!(problems[0].node, Some("n1".into()));
        assert_eq!(
            problems[0].message,
            "node has a unit name, but no reg or ranges property"
        );
    }

    #[test]
    fn property_line_maps_to_innermost_node() {
        let text = "<stdin>:5.3-10: ERROR (x): /n@10:foo: bad";
        let problems = parse_problems(text, &map());
        assert_eq!(problems[0].node, Some("n1".into()));
        assert_eq!(problems[0].message, "bad");
    }

    #[test]
    fn path_is_the_fallback() {
        let text = "Warning (avoid_unnecessary_addr_size): /n@10: no ranges";
        let problems = parse_problems(text, &map());
        assert_eq!(problems[0].line, None);
        assert_eq!(problems[0].node, Some("n1".into()));
    }

    #[test]
    fn syntax_error_has_a_line_but_may_have_no_node() {
        let text = "Error: <stdin>:12.5-9 syntax error\nFATAL ERROR: Unable to parse input tree";
        let problems = parse_problems(text, &map());
        assert_eq!(problems.len(), 2);
        assert_eq!(problems[0].line, Some(12));
        assert_eq!(problems[0].node, None);
        assert_eq!(problems[0].message, "syntax error");
        assert_eq!(problems[1].severity, Severity::Error);
        assert_eq!(problems[1].line, None);
    }

    #[test]
    fn other_lines_are_ignored() {
        assert!(parse_problems("\nsome note\n", &map()).is_empty());
    }
}
