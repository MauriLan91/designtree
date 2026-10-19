//! Imports a devicetree, exports it again and checks with `dtc` that both
//! sources describe the same tree.

use std::path::Path;
use std::process::Command;

use designtree_core::{import_dts, to_dts};

/// Compiles DTS to sorted DTS with `dtc`, then drops what legitimately
/// differs: assigned phandle numbers and how cells are grouped in `<...>`.
fn canonical(dts: &str) -> String {
    let dir = std::env::temp_dir().join(format!("designtree-round-trip-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("in.dts");
    std::fs::write(&file, dts).unwrap();
    let output = Command::new("dtc")
        .args(["-q", "-I", "dts", "-O", "dts", "-s"])
        .arg(&file)
        .output()
        .expect("running dtc");
    assert!(
        output.status.success(),
        "dtc failed:\n{}\n{dts}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .filter(|line| !line.trim_start().starts_with("phandle = "))
        .collect::<Vec<_>>()
        .join("\n")
        .replace(">, <", " ")
        .replace('&', " &")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn dtc_available() -> bool {
    let available = Command::new("dtc").arg("--version").output().is_ok();
    if !available {
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
        );
        eprintln!("dtc not found, skipping round-trip check");
    }
    available
}

#[test]
fn board_survives_import_and_export() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/board.dts");
    let source = std::fs::read_to_string(&path).unwrap();
    let graph = import_dts(&source, "board.dts").unwrap_or_else(|e| panic!("{e}"));
    let exported = to_dts(&graph).unwrap_or_else(|e| panic!("{e:?}"));

    // The design file format must carry everything the import produced.
    let json = serde_json::to_string(&graph).unwrap();
    assert_eq!(
        serde_json::from_str::<designtree_core::Graph>(&json).unwrap(),
        graph
    );

    if dtc_available() {
        assert_eq!(
            canonical(&exported),
            canonical(&source),
            "exported:\n{exported}"
        );
    }
}
