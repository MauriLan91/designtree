//! Imports a devicetree, exports it again and checks with `dtc` that both
//! sources describe the same tree.

mod common;

use std::path::Path;

use designtree_core::{import_dts_file, to_dts, ImportOptions};

#[test]
fn board_survives_import_and_export() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board.dts");
    let source = std::fs::read_to_string(&path).unwrap();
    let graph = import_dts_file(&path, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let exported = to_dts(&graph).unwrap_or_else(|e| panic!("{e:?}"));

    // The design file format must carry everything the import produced.
    let json = serde_json::to_string(&graph).unwrap();
    assert_eq!(
        serde_json::from_str::<designtree_core::Graph>(&json).unwrap(),
        graph
    );

    if !common::dtc_available() {
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
        );
        eprintln!("dtc not found, skipping round-trip check");
        return;
    }
    let expected = common::canonical(&source, None).unwrap();
    let actual = common::canonical(&exported, None).unwrap();
    if let Some(difference) = common::first_difference(&expected, &actual) {
        panic!("{difference}\nexported:\n{exported}");
    }
}
