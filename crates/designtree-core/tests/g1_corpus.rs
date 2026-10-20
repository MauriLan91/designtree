//! G1 round-trip corpus (see docs/backlog.md): imports kernel board files,
//! exports them, and checks that dtc compiles the export to the same tree
//! the kernel build compiles from the original.
//!
//! Needs a kernel source tree, `cpp` and `dtc`:
//!
//! ```sh
//! DESIGNTREE_LINUX_SRC=~/linux cargo test -p designtree-core --test g1_corpus -- --ignored --nocapture
//! ```
//!
//! `DESIGNTREE_G1_THRESHOLD` sets the pass rate in percent (default 90);
//! `DESIGNTREE_G1_CORPUS` names another list of board files to check.

mod common;

use std::path::{Path, PathBuf};

use designtree_core::{import_dts_file, to_dts, ImportOptions};

/// Preprocesses `path` the way the kernel build does.
fn kernel_cpp(linux: &Path, path: &Path) -> Result<String, String> {
    let include = linux.join("scripts/dtc/include-prefixes");
    let source = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let dir = path.parent().expect("a board file has a directory");
    common::run(
        "cpp",
        &[
            "-nostdinc",
            "-I",
            &dir.display().to_string(),
            "-I",
            &include.display().to_string(),
            "-undef",
            "-D__DTS__",
            "-x",
            "assembler-with-cpp",
            "-",
        ],
        &source,
    )
}

fn check(linux: &Path, path: &Path) -> Result<(), String> {
    let graph =
        import_dts_file(path, &ImportOptions::kernel(linux)).map_err(|e| format!("import: {e}"))?;
    let exported = to_dts(&graph).map_err(|e| format!("export: {e:?}"))?;
    let expected = common::canonical(&kernel_cpp(linux, path)?, path.parent())?;
    let actual = common::canonical(&exported, None).map_err(|e| format!("exported source: {e}"))?;
    match common::first_difference(&expected, &actual) {
        Some(difference) => Err(difference),
        None => Ok(()),
    }
}

#[test]
#[ignore = "needs a kernel tree in DESIGNTREE_LINUX_SRC, cpp and dtc"]
fn g1_corpus() {
    let linux =
        PathBuf::from(std::env::var_os("DESIGNTREE_LINUX_SRC").expect("set DESIGNTREE_LINUX_SRC"));
    let threshold: f64 = std::env::var("DESIGNTREE_G1_THRESHOLD")
        .map(|t| t.parse().expect("a number"))
        .unwrap_or(90.0);
    let list = match std::env::var_os("DESIGNTREE_G1_CORPUS") {
        Some(path) => std::fs::read_to_string(path).expect("reading the corpus list"),
        None => include_str!("corpus/g1.txt").to_owned(),
    };
    let files: Vec<&str> = list
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .collect();

    let mut passed = 0;
    for file in &files {
        match check(&linux, &linux.join(file)) {
            Ok(()) => {
                passed += 1;
                println!("ok    {file}");
            }
            Err(reason) => println!("FAIL  {file}: {reason}"),
        }
    }
    let rate = 100.0 * passed as f64 / files.len() as f64;
    println!(
        "G1: {passed}/{} board files round-trip ({rate:.0}%)",
        files.len()
    );
    assert!(
        rate >= threshold,
        "pass rate {rate:.0}% is below {threshold}%"
    );
}
