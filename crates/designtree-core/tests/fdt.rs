//! The blob DesignTree writes holds the tree dtc compiles from the same
//! source.

mod common;

use std::path::Path;

use designtree_core::{import_dts_file, to_dtb, ImportOptions, PropertyValue};

#[test]
fn blob_matches_dtc() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board.dts");
    let source = std::fs::read_to_string(&path).unwrap();
    let mut graph =
        import_dts_file(&path, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"));
    let dtb = to_dtb(&graph).unwrap_or_else(|e| panic!("{e:?}"));
    assert_eq!(&dtb.blob[..4], &[0xd0, 0x0d, 0xfe, 0xed]);
    assert_eq!(dtb.node_at("/").map(|id| id.0.as_str()), Some("/"));

    if !common::dtc_available() {
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
        );
        eprintln!("dtc not found, skipping blob check");
        return;
    }
    let expected = common::compile(&source, None).unwrap();
    if let Some(difference) = common::blob_difference(&expected, &dtb.blob).unwrap() {
        panic!("{difference}");
    }

    // The comparison does see a changed value.
    let node = graph
        .nodes
        .iter_mut()
        .find(|n| !n.properties.is_empty())
        .unwrap();
    node.properties[0].value = PropertyValue::Strings(vec!["changed".into()]);
    let changed = to_dtb(&graph).unwrap().blob;
    assert!(common::blob_difference(&expected, &changed)
        .unwrap()
        .is_some());
}
