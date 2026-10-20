//! Embeds the vendored dt-schema core schemas (`dtschema/schemas`).

use std::fmt::Write;
use std::path::Path;
use std::{env, fs};

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("dtschema/schemas");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files: Vec<_> = walkdir::WalkDir::new(&root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "yaml"))
        .map(|e| e.into_path())
        .collect();
    files.sort();

    let mut out = String::from("pub(crate) const CORE_SCHEMAS: &[(&str, &str)] = &[\n");
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        let rel = path
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        writeln!(
            out,
            "    ({rel:?}, include_str!({:?})),",
            path.display().to_string()
        )
        .unwrap();
    }
    out.push_str("];\n");
    let dest = Path::new(&env::var("OUT_DIR").unwrap()).join("core_schemas.rs");
    fs::write(dest, out).unwrap();
}
