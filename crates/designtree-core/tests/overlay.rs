//! An overlay design exports a `.dtso` that dtc compiles and that, applied
//! to the base with fdtoverlay, gives the tree the design shows.

mod common;

use std::path::Path;
use std::process::Command;

use designtree_core::{
    import_dts_file, overlay_on, to_dts, to_dts_flat, validate, Edge, EdgeKind, Graph,
    ImportOptions, Node, NodeId, Position, Property, PropertyValue, ValidationError, ValueChunk,
};

fn base() -> Graph {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/overlay-base.dts");
    import_dts_file(&path, &ImportOptions::default()).unwrap_or_else(|e| panic!("{e}"))
}

fn node<'a>(graph: &'a mut Graph, path: &str) -> &'a mut Node {
    graph
        .nodes
        .iter_mut()
        .find(|n| n.id.0 == path)
        .unwrap_or_else(|| panic!("no node {path}"))
}

fn new_node(id: &str, name: &str, unit: Option<&str>, label: Option<&str>) -> Node {
    Node {
        id: NodeId(id.into()),
        name: name.into(),
        unit_address: unit.map(Into::into),
        label: label.map(Into::into),
        extra_labels: vec![],
        omit_if_no_ref: false,
        compatible: vec![],
        properties: vec![],
        inherited: None,
        position: Position::default(),
    }
}

fn child(from: &str, to: &str) -> Edge {
    Edge {
        from: NodeId(from.into()),
        to: NodeId(to.into()),
        kind: EdgeKind::Child,
    }
}

fn set(node: &mut Node, name: &str, value: PropertyValue) {
    node.properties.retain(|p| p.name != name);
    node.properties.push(Property {
        name: name.into(),
        value,
    });
}

/// The base with an overlay that enables a controller, adds a device on
/// it, changes an unlabeled node and the root, and adds a top-level node
/// that references a base node.
fn edited() -> Graph {
    let mut graph = overlay_on(&base(), "overlay-base.dts");
    set(
        node(&mut graph, "/soc/i2c@1000"),
        "status",
        PropertyValue::Strings(vec!["okay".into()]),
    );
    set(
        node(&mut graph, "/soc/gpio@2000"),
        "gpio-line-names",
        PropertyValue::Strings(vec!["led".into()]),
    );
    set(
        node(&mut graph, "/"),
        "chassis-type",
        PropertyValue::Strings(vec!["embedded".into()]),
    );

    let mut eeprom = new_node(
        "/soc/i2c@1000/eeprom@50",
        "eeprom",
        Some("50"),
        Some("eeprom"),
    );
    eeprom.compatible = vec!["atmel,24c02".into()];
    set(&mut eeprom, "reg", PropertyValue::Cells(vec![0x50]));
    graph.nodes.push(eeprom);
    graph
        .edges
        .push(child("/soc/i2c@1000", "/soc/i2c@1000/eeprom@50"));

    let mut sensor = new_node("/sensor", "sensor", None, None);
    sensor.compatible = vec!["vendor,sensor".into()];
    graph.nodes.push(sensor);
    graph.edges.push(child("/", "/sensor"));
    graph.edges.push(Edge {
        from: NodeId("/sensor".into()),
        to: NodeId("/oscillator".into()),
        kind: EdgeKind::Reference {
            property: "clocks".into(),
            args: vec![],
        },
    });
    graph
}

#[test]
fn a_new_overlay_exports_nothing() {
    let graph = overlay_on(&base(), "overlay-base.dts");
    assert_eq!(to_dts(&graph).unwrap(), "/dts-v1/;\n/plugin/;\n\n");
}

#[test]
fn overlay_writes_only_changes() {
    let dts = to_dts(&edited()).unwrap_or_else(|e| panic!("{e:?}"));
    assert!(dts.starts_with("/dts-v1/;\n/plugin/;\n"), "{dts}");
    assert!(
        dts.contains("&{/} {\n\tchassis-type = \"embedded\";"),
        "{dts}"
    );
    assert!(dts.contains("&i2c1 {\n\tstatus = \"okay\";"), "{dts}");
    assert!(dts.contains("eeprom: eeprom@50 {"), "{dts}");
    assert!(
        dts.contains("\tgpio@2000 {\n\t\tgpio-line-names = \"led\";"),
        "{dts}"
    );
    assert!(dts.contains("clocks = <&osc>;"), "{dts}");
    assert!(
        !dts.contains("clock-frequency"),
        "base values are not repeated: {dts}"
    );
}

#[test]
fn deletions_are_refused() {
    let mut graph = overlay_on(&base(), "overlay-base.dts");
    node(&mut graph, "/soc/i2c@1000")
        .properties
        .retain(|p| p.name != "status");
    graph.deleted_nodes.push("/soc/gpio@2000".into());
    node(&mut graph, "/soc").extra_labels.push("bus".into());
    node(&mut graph, "/oscillator").omit_if_no_ref = true;
    set(
        node(&mut graph, "/"),
        "serial",
        PropertyValue::Mixed(vec![ValueChunk::Path {
            target: "/soc/gpio@2000".into(),
        }]),
    );
    let errors = validate(&graph);
    let cannot = |what: &str| {
        errors.iter().any(
            |e| matches!(e, ValidationError::OverlayCannot { what: w, .. } if w.contains(what)),
        )
    };
    assert!(cannot("delete the property `status`"), "{errors:?}");
    assert!(cannot("delete a node"), "{errors:?}");
    assert!(cannot("add the label `bus`"), "{errors:?}");
    assert!(cannot("/omit-if-no-ref/"), "{errors:?}");
    assert!(cannot("by path"), "{errors:?}");
    assert!(to_dts(&graph).is_err());
}

fn tools_available() -> bool {
    let found =
        common::dtc_available() && Command::new("fdtoverlay").arg("--help").output().is_ok();
    if !found {
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc and fdtoverlay are required (DESIGNTREE_REQUIRE_DTC is set) but were not found"
        );
        eprintln!("dtc or fdtoverlay not found, skipping");
    }
    found
}

#[test]
fn applied_overlay_matches_the_design() {
    if !tools_available() {
        return;
    }
    let graph = edited();
    let dir = std::env::temp_dir().join(format!("designtree-overlay-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let compile = |dts: &str| {
        common::run_bytes(
            "dtc",
            &["-q", "-@", "-I", "dts", "-O", "dtb", "-"],
            dts.as_bytes(),
        )
    };

    // The base as the app builds it.
    let base_dtb = dir.join("base.dtb");
    designtree_core::dtc::compile_dtb(&to_dts_flat(&base()).unwrap(), &base_dtb, None).unwrap();
    let dtbo = compile(&to_dts(&graph).unwrap()).unwrap_or_else(|e| panic!("{e}"));
    std::fs::write(dir.join("overlay.dtbo"), &dtbo).unwrap();
    let applied = dir.join("applied.dtb");
    let status = Command::new("fdtoverlay")
        .arg("-i")
        .arg(dir.join("base.dtb"))
        .arg("-o")
        .arg(&applied)
        .arg(dir.join("overlay.dtbo"))
        .status()
        .unwrap();
    assert!(status.success(), "fdtoverlay failed");

    // The design's whole tree, as the preview of the applied overlay shows it.
    let expected = compile(&to_dts_flat(&graph).unwrap()).unwrap();
    let applied = std::fs::read(&applied).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    if let Some(difference) = common::blob_difference(&expected, &applied).unwrap() {
        panic!("{difference}");
    }
}
