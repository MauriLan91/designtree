//! dtc's messages about a generated tree end up on the right node.

#[allow(dead_code)]
mod common;

use designtree_core::dtc::{compile_dtb, DtcError};
use designtree_core::{parse_problems, to_dts_flat_mapped, Graph, Severity};

fn graph() -> Graph {
    serde_json::from_str(
        r##"{
            "nodes": [
                {"id": "root", "name": "/", "properties": [
                    {"name": "#address-cells", "value": {"type": "cells", "value": [1]}},
                    {"name": "#size-cells", "value": {"type": "cells", "value": [1]}}]},
                {"id": "bad", "name": "device", "unit_address": "10"},
                {"id": "fine", "name": "other"}
            ],
            "edges": [
                {"from": "root", "to": "bad", "kind": "child"},
                {"from": "root", "to": "fine", "kind": "child"}
            ]
        }"##,
    )
    .unwrap()
}

fn skip_without_dtc() -> bool {
    if common::dtc_available() {
        return false;
    }
    assert!(
        std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
        "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
    );
    true
}

#[test]
fn warning_lands_on_the_node_it_is_about() {
    if skip_without_dtc() {
        return;
    }
    let (dts, map) = to_dts_flat_mapped(&graph()).unwrap();
    let out = std::env::temp_dir().join(format!("designtree-problems-{}.dtb", std::process::id()));
    let built = compile_dtb(&dts, &out, None).unwrap();
    let problems = parse_problems(&built.warnings, &map);
    assert!(!problems.is_empty(), "no warnings in {:?}", built.warnings);
    assert!(problems.iter().all(|p| p.severity == Severity::Warning));
    assert!(
        problems.iter().any(|p| p.node == Some("bad".into())),
        "{problems:?}"
    );
    assert!(problems.iter().all(|p| p.node != Some("fine".into())));
    let _ = std::fs::remove_file(out);
}

#[test]
fn errors_are_located_and_leave_no_file() {
    if skip_without_dtc() {
        return;
    }
    let (dts, map) = to_dts_flat_mapped(&graph()).unwrap();
    // The design validator rejects unknown labels, so break the source by hand.
    let broken = dts.replacen("other {", "other {\n\t\tlink = <&missing>;", 1);
    let out = std::env::temp_dir().join(format!("designtree-problems2-{}.dtb", std::process::id()));
    let Err(DtcError::Failed(stderr)) = compile_dtb(&broken, &out, None) else {
        panic!("expected a failure");
    };
    let problems = parse_problems(&stderr, &map);
    assert!(problems.iter().any(|p| p.severity == Severity::Error));
    assert!(!out.exists());
}
