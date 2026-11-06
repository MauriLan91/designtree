//! The sample designs in `examples/`, the tutorial's checkpoints among them,
//! stay valid and build with dtc without warnings.

#[allow(dead_code)]
mod common;

use std::path::PathBuf;

use designtree_core::dtc::compile_dtb;
use designtree_core::{interrupt_tree, to_dts, validate, Graph};

fn examples() -> Vec<(String, Graph)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples");
    let mut designs: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .map(|p| {
            let text = std::fs::read_to_string(&p).unwrap();
            let name = p.file_name().unwrap().to_string_lossy().into_owned();
            let graph = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, graph)
        })
        .collect();
    designs.sort_by(|a, b| a.0.cmp(&b.0));
    designs
}

#[test]
fn tutorial_checkpoints_are_all_there() {
    let names: Vec<_> = examples().into_iter().map(|(n, _)| n).collect();
    for step in 1..=5 {
        let prefix = format!("first-board-{step}-");
        assert!(
            names.iter().any(|n| n.starts_with(&prefix)),
            "{prefix}* missing in {names:?}"
        );
    }
}

#[test]
fn examples_are_valid() {
    for (name, graph) in examples() {
        assert!(
            validate(&graph).is_empty(),
            "{name}: {:?}",
            validate(&graph)
        );
        let irq = interrupt_tree(&graph);
        assert!(irq.problems.is_empty(), "{name}: {:?}", irq.problems);
    }
}

#[test]
fn examples_build_without_warnings() {
    if !common::dtc_available() {
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
        );
        return;
    }
    for (name, graph) in examples() {
        let dts = to_dts(&graph).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let out = std::env::temp_dir().join(format!(
            "designtree-example-{}-{name}.dtb",
            std::process::id()
        ));
        let built = compile_dtb(&dts, &out, None).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(built.warnings.is_empty(), "{name}: {}", built.warnings);
        let _ = std::fs::remove_file(out);
    }
}
