use std::path::Path;

use designtree_bindings::index_dir;

#[test]
fn indexes_fixture_tree() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/bindings");
    let catalog = index_dir(&root).unwrap();
    assert!(catalog.skipped.is_empty(), "{:?}", catalog.skipped);
    assert_eq!(catalog.bindings.len(), 2);

    let uart = catalog.find_compatible("vendor,uart-b1").unwrap();
    assert_eq!(uart.category, "serial");
    assert_eq!(uart.title.as_deref(), Some("Example UART"));
    assert_eq!(
        uart.compatibles,
        [
            "vendor,uart-a",
            "vendor,uart-b",
            "vendor,uart-b1",
            "vendor,uart-b2"
        ]
    );
    let reg = uart.properties.iter().find(|p| p.name == "reg").unwrap();
    assert!(reg.required);
    let clocks = uart.properties.iter().find(|p| p.name == "clocks").unwrap();
    assert!(!clocks.required);
    assert_eq!(clocks.description.as_deref(), Some("Reference clock."));

    let clock = catalog.find_compatible("fixed-clock").unwrap();
    assert_eq!(clock.category, "clock");
    assert!(clock.properties.iter().all(|p| p.required));
}
