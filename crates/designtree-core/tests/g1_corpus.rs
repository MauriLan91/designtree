//! G1 round-trip corpus (see docs/backlog.md): imports kernel board files,
//! exports them, and checks that dtc compiles the export to the same tree
//! the kernel build compiles from the original. Both exports are checked:
//! the board file (includes and overrides, built next to the original) and
//! the flat tree. The blob DesignTree writes itself (for schema checks)
//! must equal the one dtc compiles from the original.
//!
//! Needs a kernel source tree, `cpp` and `dtc`. CI uses a sparse checkout of
//! a pinned tag (`scripts/fetch-kernel-dts.sh`), which is enough:
//!
//! ```sh
//! scripts/fetch-kernel-dts.sh ~/linux-g1
//! DESIGNTREE_LINUX_SRC=~/linux-g1 cargo test -p designtree-core --test g1_corpus -- --ignored --nocapture
//! ```
//!
//! `DESIGNTREE_G1_THRESHOLD` sets the pass rate in percent (default 90);
//! `DESIGNTREE_G1_CORPUS` names another list of board files to check.

mod common;

use std::path::{Path, PathBuf};

use designtree_core::{import_dts_file, to_dtb, to_dts, to_dts_flat, ImportOptions};

/// Preprocesses `source` the way the kernel build does for a file in `dir`.
fn kernel_cpp(linux: &Path, dir: &Path, source: &str) -> Result<String, String> {
    let include = linux.join("scripts/dtc/include-prefixes");
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
        source,
    )
}

/// Checks one board file; true if its export keeps the includes.
fn check(linux: &Path, path: &Path) -> Result<bool, String> {
    let graph =
        import_dts_file(path, &ImportOptions::kernel(linux)).map_err(|e| format!("import: {e}"))?;
    let dir = path.parent().expect("a board file has a directory");
    let source = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let preprocessed = kernel_cpp(linux, dir, &source)?;
    let expected = common::canonical(&preprocessed, Some(dir))?;

    let ours = to_dtb(&graph).map_err(|e| format!("blob: {e:?}"))?.blob;
    let theirs = common::compile(&preprocessed, Some(dir))?;
    if let Some(difference) = common::blob_difference(&theirs, &ours)? {
        return Err(format!("blob: {difference}"));
    }

    let flat = to_dts_flat(&graph).map_err(|e| format!("export: {e:?}"))?;
    let actual = common::canonical(&flat, None).map_err(|e| format!("flat export: {e}"))?;
    if let Some(difference) = common::first_difference(&expected, &actual) {
        return Err(format!("flat export: {difference}"));
    }

    let board = to_dts(&graph).map_err(|e| format!("export: {e:?}"))?;
    let actual = common::canonical(&kernel_cpp(linux, dir, &board)?, Some(dir))
        .map_err(|e| format!("board export: {e}"))?;
    match common::first_difference(&expected, &actual) {
        Some(difference) => Err(format!("board export: {difference}")),
        None => Ok(!graph.includes.is_empty()),
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
    let mut layered = 0;
    for file in &files {
        match check(&linux, &linux.join(file)) {
            Ok(keeps_includes) => {
                passed += 1;
                layered += usize::from(keeps_includes);
                println!("ok    {file}");
            }
            Err(reason) => println!("FAIL  {file}: {reason}"),
        }
    }
    let rate = 100.0 * passed as f64 / files.len() as f64;
    println!(
        "G1: {passed}/{} board files round-trip ({rate:.0}%), \
         {layered} exported as includes and overrides",
        files.len()
    );
    assert!(
        rate >= threshold,
        "pass rate {rate:.0}% is below {threshold}%"
    );
}
