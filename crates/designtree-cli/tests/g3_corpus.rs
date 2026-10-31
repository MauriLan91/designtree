//! G3 seeded-error corpus (see docs/backlog.md): measures how much of what
//! `make dtbs_check` reports DesignTree reports too.
//!
//! Every entry of `corpus/g3.txt` appends one mistake to a kernel board file
//! (an `&label { ... }` override). The mutated board is compiled the way the
//! kernel build does it (cpp, dtc) and validated with dt-schema's
//! `dt-validate`, which is what `dtbs_check` runs; DesignTree imports the
//! same source and checks it with its own validator. The problems a mistake
//! adds are those of the mutated board minus those of the unmodified board.
//! Recall is the share of the problems `dt-validate` adds that DesignTree
//! also adds, matched by node and property: what the editor marks. The
//! binding and the message are not compared. Both tools may report one
//! mistake through several bindings (a node's own and its parent's), and
//! DesignTree shows such a problem once.
//!
//! Needs a kernel tree with the bindings, `cpp`, `dtc` and dt-schema
//! (`pip install dtschema`) at the version of the embedded core schemas:
//!
//! ```sh
//! scripts/fetch-kernel-dts.sh ~/linux-g1
//! DESIGNTREE_LINUX_SRC=~/linux-g1 cargo test --release -p designtree-cli --test g3_corpus -- --ignored --nocapture
//! ```
//!
//! The kernel tree must be writable: mutated boards are written next to
//! the original for their includes. `DESIGNTREE_G3_THRESHOLD` sets the
//! required recall in percent (default 90). `DESIGNTREE_DT_SCHEMA` names a
//! processed schema (`dt-mk-schema -j`) to use instead of building one.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use designtree_bindings::{parse_fdt, Checker, FdtNode};
use designtree_core::{import_dts_file, to_dtb, ImportOptions};
use serde_json::Value;

/// One problem, as both tools can name it: node path and property (empty
/// for the node itself).
type Key = (String, String);

struct Entry {
    board: String,
    kind: String,
    snippet: String,
}

fn corpus() -> Vec<Entry> {
    include_str!("corpus/g3.txt")
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .map(|line| {
            let mut fields = line.splitn(3, '\t');
            let mut next = || fields.next().expect("board, kind and snippet").to_owned();
            Entry {
                board: next(),
                kind: next(),
                snippet: next(),
            }
        })
        .collect()
}

fn run(program: &str, args: &[&str], input: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{program}: {e}"))?;
    child.stdin.take().unwrap().write_all(input).unwrap();
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "{program}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(output.stdout)
}

/// Compiles a board file the way the kernel build does.
fn kernel_dtb(linux: &Path, source: &Path) -> Result<Vec<u8>, String> {
    let dir = source.parent().unwrap().display().to_string();
    let include = linux.join("scripts/dtc/include-prefixes");
    let text = fs::read(source).map_err(|e| e.to_string())?;
    let preprocessed = run(
        "cpp",
        &[
            "-nostdinc",
            "-I",
            &dir,
            "-I",
            &include.display().to_string(),
            "-undef",
            "-D__DTS__",
            "-x",
            "assembler-with-cpp",
            "-",
        ],
        &text,
    )?;
    run(
        "dtc",
        &["-q", "-i", &dir, "-I", "dts", "-O", "dtb", "-"],
        &preprocessed,
    )
}

/// The path of every node in a blob.
fn node_paths(blob: &[u8]) -> BTreeSet<String> {
    fn walk(node: &FdtNode, path: &str, out: &mut BTreeSet<String>) {
        for child in &node.children {
            let child_path = format!("{}/{}", path.trim_end_matches('/'), child.name);
            walk(child, &child_path, out);
        }
        out.insert(path.to_owned());
    }
    let mut paths = BTreeSet::new();
    walk(&parse_fdt(blob).expect("a valid blob"), "/", &mut paths);
    paths
}

/// What DesignTree reports for a board file.
fn ours(checker: &Checker, linux: &Path, source: &Path) -> Result<BTreeSet<Key>, String> {
    let graph = import_dts_file(source, &ImportOptions::kernel(linux))
        .map_err(|e| format!("import: {e}"))?;
    let dtb = to_dtb(&graph).map_err(|e| format!("blob: {e:?}"))?;
    let problems = checker.check_dtb(&dtb.blob).map_err(|e| e.to_string())?;
    Ok(problems
        .into_iter()
        .map(|p| (p.node, p.property.unwrap_or_default()))
        .collect())
}

/// What `dt-validate` reports for each blob, by file name. It is slow and
/// single-threaded, so the blobs are split between several runs.
///
/// dt-validate names the node a schema was applied to and the path inside
/// it; a problem in a child node is moved to that child, which is where
/// DesignTree reports it.
fn theirs(schema: &Path, work: &Path, blobs: &[PathBuf]) -> BTreeMap<String, BTreeSet<Key>> {
    let jobs = std::thread::available_parallelism().map_or(1, |n| n.get());
    let runs: Vec<_> = blobs
        .chunks(blobs.len().div_ceil(jobs).max(1))
        .enumerate()
        .map(|(n, chunk)| {
            let json = work.join(format!("dt-validate-{n}.json"));
            // dt-validate exits non-zero when it finds problems.
            let child = Command::new("dt-validate")
                .arg("-s")
                .arg(schema)
                .arg("--json-output")
                .arg(&json)
                .args(chunk)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("running dt-validate");
            (child, json)
        })
        .collect();
    let mut nodes: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut by_file: BTreeMap<String, BTreeSet<Key>> = BTreeMap::new();
    for (mut child, json) in runs {
        child.wait().expect("waiting for dt-validate");
        let diagnostics: Vec<Value> =
            serde_json::from_str(&fs::read_to_string(&json).expect("dt-validate output"))
                .expect("dt-validate JSON");
        for d in diagnostics {
            if d["type"] != "validation" {
                continue;
            }
            let file = d["file"].as_str().unwrap_or_default().to_owned();
            let paths = nodes
                .entry(file.clone())
                .or_insert_with(|| node_paths(&fs::read(&file).expect("reading a blob")));
            let mut node = d["node"].as_str().unwrap_or_default().to_owned();
            let mut property = String::new();
            for segment in d["property_path"].as_array().into_iter().flatten() {
                let Some(name) = segment.as_str() else { break };
                let child = format!("{}/{name}", node.trim_end_matches('/'));
                if paths.contains(&child) {
                    node = child;
                } else {
                    property = name.to_owned();
                    break;
                }
            }
            by_file.entry(file).or_default().insert((node, property));
        }
    }
    by_file
}

#[test]
#[ignore = "needs a kernel tree in DESIGNTREE_LINUX_SRC, cpp, dtc and dt-schema"]
fn g3_corpus() {
    let linux =
        PathBuf::from(std::env::var_os("DESIGNTREE_LINUX_SRC").expect("set DESIGNTREE_LINUX_SRC"));
    let threshold: f64 = std::env::var("DESIGNTREE_G3_THRESHOLD")
        .map(|t| t.parse().expect("a number"))
        .unwrap_or(90.0);
    let work = std::env::temp_dir().join(format!("designtree-g3-{}", std::process::id()));
    fs::create_dir_all(&work).unwrap();

    let schema = match std::env::var_os("DESIGNTREE_DT_SCHEMA") {
        Some(path) => PathBuf::from(path),
        None => {
            let path = work.join("processed-schema.json");
            let bindings = linux.join("Documentation/devicetree/bindings");
            let status = Command::new("dt-mk-schema")
                .arg("-j")
                .arg(&bindings)
                .stdout(fs::File::create(&path).unwrap())
                .stderr(Stdio::null())
                .status()
                .expect("running dt-mk-schema");
            assert!(status.success(), "dt-mk-schema failed");
            path
        }
    };
    let catalog = designtree_bindings::index_kernel_tree(&linux).expect("indexing the bindings");
    let checker = Checker::new(catalog.schemas);

    let entries = corpus();
    let boards: BTreeSet<&str> = entries.iter().map(|e| e.board.as_str()).collect();
    let mut blobs = Vec::new();
    let mut our_base = BTreeMap::new();
    for board in &boards {
        let source = linux.join(board);
        let blob = work.join(format!("base-{}.dtb", our_base.len()));
        fs::write(&blob, kernel_dtb(&linux, &source).expect(board)).unwrap();
        blobs.push(blob.clone());
        let problems = ours(&checker, &linux, &source).expect(board);
        our_base.insert(*board, (blob, problems));
    }

    // Each mutated board is written next to the original, for its includes.
    let mut our_new: Vec<Result<BTreeSet<Key>, String>> = Vec::new();
    for (n, entry) in entries.iter().enumerate() {
        let original = linux.join(&entry.board);
        let source = original.with_file_name(format!(".designtree-g3-{n}.dts"));
        let mut text = fs::read_to_string(&original).unwrap();
        text.push_str(&format!("\n{}\n", entry.snippet));
        fs::write(&source, text).unwrap();
        let result = kernel_dtb(&linux, &source).and_then(|blob| {
            let path = work.join(format!("{n}.dtb"));
            fs::write(&path, blob).unwrap();
            blobs.push(path);
            let base = &our_base[entry.board.as_str()].1;
            Ok(&ours(&checker, &linux, &source)? - base)
        });
        fs::remove_file(&source).unwrap();
        our_new.push(result);
    }

    let reported = theirs(&schema, &work, &blobs);
    let none = BTreeSet::new();
    let reported_for = |blob: &Path| reported.get(&blob.display().to_string()).unwrap_or(&none);

    // Per kind: problems dt-validate adds, how many of those we add, and
    // problems only we add.
    let mut kinds: BTreeMap<&str, (usize, usize, usize)> = BTreeMap::new();
    let mut unused = 0;
    for (n, (entry, ours)) in entries.iter().zip(&our_new).enumerate() {
        let label = format!("{:3} {} {}", n + 1, entry.kind, entry.board);
        let ours = match ours {
            Ok(ours) => ours,
            Err(reason) => {
                println!("ERROR {label}: {reason}");
                continue;
            }
        };
        let base = reported_for(&our_base[entry.board.as_str()].0);
        let theirs: BTreeSet<Key> = reported_for(&work.join(format!("{n}.dtb")))
            .difference(base)
            .cloned()
            .collect();
        if theirs.is_empty() {
            println!("UNUSED {label}: dt-validate reports nothing new");
            unused += 1;
            continue;
        }
        let found = theirs.intersection(ours).count();
        let extra = ours.difference(&theirs).count();
        let counts = kinds.entry(&entry.kind).or_default();
        counts.0 += theirs.len();
        counts.1 += found;
        counts.2 += extra;
        let status = if found == theirs.len() { "ok" } else { "MISS" };
        println!("{status:6}{label}: {}", entry.snippet);
        for (node, property) in theirs.difference(ours) {
            println!("        missed {node}: {property}");
        }
        for (node, property) in ours.difference(&theirs) {
            println!("        extra  {node}: {property}");
        }
    }
    fs::remove_dir_all(&work).ok();

    println!();
    println!("| Kind | dtbs_check | DesignTree | Recall | Extra |");
    println!("| --- | ---: | ---: | ---: | ---: |");
    let percent = |a: usize, b: usize| 100.0 * a as f64 / b.max(1) as f64;
    let (mut total, mut found, mut extra) = (0, 0, 0);
    for (kind, (t, f, e)) in &kinds {
        println!("| {kind} | {t} | {f} | {:.0}% | {e} |", percent(*f, *t));
        total += t;
        found += f;
        extra += e;
    }
    let recall = percent(found, total);
    println!("| **all** | {total} | {found} | **{recall:.0}%** | {extra} |");
    println!();
    println!(
        "G3: recall {recall:.1}% ({found}/{total} problems dtbs_check reports, \
         {} seeded errors, {unused} unused), {extra} extra problems",
        entries.len()
    );
    assert!(
        recall >= threshold,
        "recall {recall:.1}% is below {threshold}%"
    );
}
