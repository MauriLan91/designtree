use std::path::Path;

use designtree_bindings::{index_dir, Catalog, PropertySpec, PropertyType};

fn catalog() -> Catalog {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/bindings");
    let catalog = index_dir(&root).unwrap();
    assert!(catalog.skipped.is_empty(), "{:?}", catalog.skipped);
    catalog
}

fn property<'a>(catalog: &'a Catalog, compatible: &str, name: &str) -> &'a PropertySpec {
    let binding = catalog.find_compatible(compatible).unwrap();
    binding.properties.iter().find(|p| p.name == name).unwrap()
}

#[test]
fn indexes_fixture_tree() {
    let catalog = catalog();
    assert_eq!(catalog.bindings.len(), 3);

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
    let reg = property(&catalog, "vendor,uart-a", "reg");
    assert!(reg.required);
    let clocks = property(&catalog, "vendor,uart-a", "clocks");
    assert!(!clocks.required);
    assert_eq!(clocks.description.as_deref(), Some("Reference clock."));

    let clock = catalog.find_compatible("fixed-clock").unwrap();
    assert_eq!(clock.category, "clock");
    assert!(clock.properties.iter().all(|p| p.required));
}

#[test]
fn resolves_types_through_core_and_kernel_schemas() {
    let catalog = catalog();
    let ty = |name| property(&catalog, "vendor,uart-a", name).ty;

    // The binding's own `$ref` to types.yaml.
    assert_eq!(ty("vendor,fifo-size"), Some(PropertyType::Uint32));
    // dt-schema core schemas: reg.yaml, clock/clock.yaml, dt-core.yaml.
    assert_eq!(ty("reg"), Some(PropertyType::Address));
    assert_eq!(ty("clocks"), Some(PropertyType::PhandleArray));
    assert_eq!(ty("compatible"), Some(PropertyType::StringArray));
    // Core pattern properties: `-gpios$` and the `-us$` unit suffix, which
    // beat a type guessed from the bounds.
    assert_eq!(ty("reset-gpios"), Some(PropertyType::PhandleArray));
    assert_eq!(ty("vendor,turnaround-us"), Some(PropertyType::Uint32Array));
    // A kernel schema included through `allOf`.
    let speed = property(&catalog, "vendor,uart-a", "current-speed");
    assert_eq!(speed.ty, Some(PropertyType::Uint32));
    assert_eq!(speed.description.as_deref(), Some("Baud rate."));
    // Guessed from the listed values.
    assert_eq!(ty("vendor,line-mode"), Some(PropertyType::String));

    let cells = property(&catalog, "fixed-clock", "#clock-cells");
    assert_eq!(cells.ty, Some(PropertyType::Uint32));
    let frequency = property(&catalog, "fixed-clock", "clock-frequency");
    assert_eq!(frequency.ty, Some(PropertyType::Uint32));
}

#[test]
fn captures_constraints() {
    let catalog = catalog();
    let fifo = property(&catalog, "vendor,uart-a", "vendor,fifo-size");
    assert_eq!(fifo.enum_values, [16, 64]);
    assert_eq!(fifo.default, Some(16.into()));

    let mode = property(&catalog, "vendor,uart-a", "vendor,line-mode");
    assert_eq!(mode.enum_values, ["rs232", "rs485"]);

    let turnaround = property(&catalog, "vendor,uart-a", "vendor,turnaround-us");
    assert_eq!(turnaround.minimum, Some(1.into()));
    assert_eq!(turnaround.maximum, Some(100.into()));

    let reg = property(&catalog, "vendor,uart-a", "reg");
    assert_eq!(reg.max_items, Some(1));
    // dt-core.yaml bounds every `#...-cells` property.
    let cells = property(&catalog, "fixed-clock", "#clock-cells");
    assert_eq!(cells.maximum, Some(8.into()));
    // A `const` is the only allowed value.
    assert_eq!(cells.enum_values, [0]);
    // dt-core.yaml: `status: oneOf: [type: object, {enum: [...]}]`.
    let status = property(&catalog, "vendor,uart-a", "status");
    assert_eq!(status.enum_values[0], "okay");
}

#[test]
fn serializes_types_with_dt_schema_names() {
    let catalog = catalog();
    let json = serde_json::to_value(property(&catalog, "vendor,uart-a", "clocks")).unwrap();
    assert_eq!(json["type"], "phandle-array");
    assert_eq!(
        PropertyType::from_definition("uint32-matrix"),
        Some(PropertyType::Uint32Matrix)
    );
    assert_eq!(PropertyType::from_definition("node"), None);
}

#[test]
fn reports_g2_stats() {
    let stats = catalog().stats();
    assert_eq!((stats.bindings, stats.skipped), (3, 0));
    assert_eq!(stats.typed, stats.properties);
    assert!(stats.to_string().contains("properties typed:"));
}
