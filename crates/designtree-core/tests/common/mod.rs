//! Comparing devicetrees with `dtc`.

use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Runs `program` with `args`, feeding `input` on stdin.
#[allow(dead_code)]
pub fn run(program: &str, args: &[&str], input: &str) -> Result<String, String> {
    let output = run_bytes(program, args, input.as_bytes())?;
    String::from_utf8(output).map_err(|e| e.to_string())
}

/// Like [`run`], for binary input and output.
pub fn run_bytes(program: &str, args: &[&str], input: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("running {program}: {e}"))?;
    child
        .stdin
        .take()
        .expect("piped stdin")
        .write_all(input)
        .map_err(|e| format!("writing to {program}: {e}"))?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "{program} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(output.stdout)
}

/// The blob dtc compiles `dts` to.
#[allow(dead_code)]
pub fn compile(dts: &str, include_dir: Option<&Path>) -> Result<Vec<u8>, String> {
    let include_dir = include_dir.map(|dir| dir.display().to_string());
    let mut args = vec!["-q", "-I", "dts", "-O", "dtb"];
    if let Some(dir) = &include_dir {
        args.extend(["-i", dir.as_str()]);
    }
    args.push("-");
    run_bytes("dtc", &args, dts.as_bytes())
}

/// A blob decompiled by dtc with nodes and properties sorted, and the
/// path of the node each phandle number stands for.
fn sorted_blob(blob: &[u8]) -> Result<(Vec<String>, HashMap<u64, String>), String> {
    let text = run_bytes("dtc", &["-q", "-s", "-I", "dtb", "-O", "dts", "-"], blob)?;
    let text = String::from_utf8(text).map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    let mut phandles = HashMap::new();
    let mut stack: Vec<String> = Vec::new();
    for line in text.lines().map(str::trim) {
        if let Some(name) = line.strip_suffix(" {") {
            let path = match stack.last() {
                None => "/".to_owned(),
                Some(parent) if parent == "/" => format!("/{name}"),
                Some(parent) => format!("{parent}/{name}"),
            };
            stack.push(path);
        } else if line == "};" {
            stack.pop();
        } else if let Some(value) = line
            .strip_prefix("phandle = <")
            .and_then(|v| v.strip_suffix(">;"))
        {
            let number = u64::from_str_radix(value.trim_start_matches("0x"), 16).unwrap_or(0);
            phandles.insert(number, stack.last().cloned().unwrap_or_default());
            continue;
        }
        lines.push(line.to_owned());
    }
    Ok((lines, phandles))
}

/// Whether two blobs hold the same tree, whatever the order of nodes and
/// properties and the numbers given to phandles: a number that differs
/// must be a phandle of the same node on both sides. Returns the first
/// difference.
#[allow(dead_code)]
pub fn blob_difference(expected: &[u8], actual: &[u8]) -> Result<Option<String>, String> {
    let (theirs, their_phandles) = sorted_blob(expected)?;
    let (ours, our_phandles) = sorted_blob(actual)?;
    let number = |token: &str| {
        let token = token.trim_matches(|c| matches!(c, '<' | '>' | ';' | ','));
        token
            .strip_prefix("0x")
            .and_then(|hex| u64::from_str_radix(hex, 16).ok())
    };
    let same = |a: &str, b: &str| {
        let (a, b): (Vec<&str>, Vec<&str>) = (
            a.split_whitespace().collect(),
            b.split_whitespace().collect(),
        );
        a.len() == b.len()
            && a.iter().zip(&b).all(|(x, y)| {
                x == y
                    || match (number(x), number(y)) {
                        (Some(x), Some(y)) => their_phandles
                            .get(&x)
                            .is_some_and(|path| our_phandles.get(&y) == Some(path)),
                        _ => false,
                    }
            })
    };
    let at = theirs.iter().zip(&ours).position(|(t, o)| !same(t, o));
    Ok(match at {
        None if theirs.len() == ours.len() => None,
        _ => first_difference(&theirs, &ours),
    })
}

// Not every test binary that includes this module uses every helper.
#[allow(dead_code)]
pub fn dtc_available() -> bool {
    Command::new("dtc").arg("--version").output().is_ok()
}

/// The tree `dts` compiles to, as text that only differs between two
/// sources when their compiled trees differ: dtc sorts nodes and
/// properties, references are rewritten to the target's path (labels
/// differ between sources), and assigned phandle numbers and the grouping
/// of cells into `<...>` are dropped.
///
/// `include_dir` is where dtc looks for `/include/` files.
#[allow(dead_code)]
pub fn canonical(dts: &str, include_dir: Option<&Path>) -> Result<Vec<String>, String> {
    let include_dir = include_dir.map(|dir| dir.display().to_string());
    let mut args = vec!["-q", "-I", "dts", "-O", "dts", "-s"];
    if let Some(dir) = &include_dir {
        args.extend(["-i", dir.as_str()]);
    }
    args.push("-");
    let sorted = run("dtc", &args, dts)?;
    if sorted.lines().count() < 3 {
        return Err("dtc produced an empty tree".into());
    }

    // Label of every node -> its path.
    let mut paths = HashMap::new();
    let mut stack: Vec<String> = Vec::new();
    let mut lines = Vec::new();
    for line in sorted.lines() {
        let line = line.trim();
        if let Some(head) = line.strip_suffix(" {") {
            let mut parts: Vec<&str> = head.split(": ").collect();
            let name = parts.pop().expect("split yields one part");
            let path = match stack.last() {
                None => "/".to_owned(),
                Some(parent) if parent == "/" => format!("/{name}"),
                Some(parent) => format!("{parent}/{name}"),
            };
            for label in parts {
                paths.insert(label.to_owned(), path.clone());
            }
            lines.push(format!("{path} {{"));
            stack.push(path);
        } else if line == "};" {
            stack.pop();
            lines.push(line.to_owned());
        } else if !line.starts_with("phandle = ") && !line.is_empty() {
            lines.push(line.to_owned());
        }
    }

    Ok(lines
        .iter()
        .map(|line| {
            let mut out = String::new();
            let mut rest = line.as_str();
            while let Some(at) = rest.find('&') {
                out.push_str(&rest[..at]);
                rest = &rest[at + 1..];
                let len = rest
                    .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                    .unwrap_or(rest.len());
                match paths.get(&rest[..len]) {
                    Some(path) if len > 0 => {
                        out.push_str(&format!(" &{{{path}}}"));
                        rest = &rest[len..];
                    }
                    _ => out.push_str(" &"),
                }
            }
            out.push_str(rest);
            out.replace(">, <", " ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect())
}

/// The first line where two canonical trees differ, for error messages.
pub fn first_difference(expected: &[String], actual: &[String]) -> Option<String> {
    let at = expected
        .iter()
        .zip(actual)
        .position(|(e, a)| e != a)
        .unwrap_or(expected.len().min(actual.len()));
    (expected.len() != actual.len() || at < expected.len()).then(|| {
        format!(
            "line {}: expected `{}`, got `{}`",
            at + 1,
            expected.get(at).map_or("<end>", String::as_str),
            actual.get(at).map_or("<end>", String::as_str)
        )
    })
}
