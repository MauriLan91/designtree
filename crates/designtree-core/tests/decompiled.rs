//! A decompiled blob, or the blob itself, imports with its references
//! restored and builds back into the same blob (US-1.6, US-1.7).

mod common;

use std::path::Path;

use designtree_core::{import_dtb, import_dts, to_dts_flat, EdgeKind, Graph, ImportOptions};

/// Compiles `dts` as DesignTree builds (`dtc -@`), decompiles the blob,
/// imports that, and checks that its export compiles to the same bytes.
fn round_trip(fixture: &str) -> Option<Graph> {
    if !common::dtc_available() {
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
        );
        eprintln!("dtc not found, skipping");
        return None;
    }
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(fixture);
    let source = std::fs::read_to_string(&path).unwrap();
    let build = |dts: &str| {
        common::run_bytes(
            "dtc",
            &["-q", "-@", "-I", "dts", "-O", "dtb", "-"],
            dts.as_bytes(),
        )
        .unwrap()
    };
    let original = build(&source);
    let decompiled = String::from_utf8(
        common::run_bytes("dtc", &["-q", "-I", "dtb", "-O", "dts", "-"], &original).unwrap(),
    )
    .unwrap();
    let options = ImportOptions::default();
    let graph =
        import_dts(&decompiled, Path::new("board.dts"), &options).unwrap_or_else(|e| panic!("{e}"));
    // Opening the blob itself (US-1.7) gives the same tree.
    let opened =
        import_dtb(&original, Path::new("board.dtb"), &options).unwrap_or_else(|e| panic!("{e}"));
    for graph in [&graph, &opened] {
        let exported = to_dts_flat(graph).unwrap_or_else(|e| panic!("{e:?}"));
        assert!(
            build(&exported) == original,
            "the rebuilt blob differs from the original; export:\n{exported}"
        );
    }
    assert_eq!(edges(&graph), edges(&opened));
    Some(graph)
}

fn edges(graph: &Graph) -> Vec<String> {
    graph.edges.iter().map(|e| format!("{e:?}")).collect()
}

#[test]
fn a_decompiled_board_builds_back_into_the_same_blob() {
    let Some(graph) = round_trip("phandles.dts") else {
        return;
    };
    let references = graph
        .edges
        .iter()
        .filter(|e| matches!(e.kind, EdgeKind::Reference { .. }))
        .count();
    // interrupt-parent, clocks (2 + 1), pinctrl-0, vcc-supply.
    assert_eq!(references, 6);
    // Numbered by dtc in the same order, so nothing is pinned.
    assert!(graph.nodes.iter().all(|n| n.phandle.is_none()));
    assert!(!graph.nodes.iter().any(|n| n.name.starts_with("__")));
}

#[test]
fn the_board_fixture_builds_back_into_the_same_blob() {
    round_trip("board.dts");
}
