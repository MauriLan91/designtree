//! The TypeScript types of the wire format (`app/src/model.gen.ts`) are
//! generated from the Rust types, so the two cannot drift. This test fails
//! when the checked-in file is stale; regenerate it with
//!
//! ```text
//! UPDATE_TS=1 cargo test -p designtree --test typegen
//! ```

use std::path::PathBuf;

use designtree_bindings::{Binding, DtMacro, PropertySpec, PropertyType};
use designtree_core::{
    Cell, Edge, EdgeKind, Graph, Group, Inherited, MemReserve, Node, NodeId, Position, Problem,
    Property, PropertyValue, Severity, Size, ValueChunk,
};
use ts_rs::{Config, TS};

const HEADER: &str = "\
// Generated from the Rust types by crates/designtree-cli/tests/typegen.rs.
// Do not edit; regenerate with:
//   UPDATE_TS=1 cargo test -p designtree --test typegen
";

fn generate() -> String {
    let cfg = Config::default();
    let decls = [
        NodeId::decl(&cfg),
        Position::decl(&cfg),
        Size::decl(&cfg),
        PropertyValue::decl(&cfg),
        Cell::decl(&cfg),
        ValueChunk::decl(&cfg),
        Property::decl(&cfg),
        Inherited::decl(&cfg),
        Node::decl(&cfg),
        EdgeKind::decl(&cfg),
        Edge::decl(&cfg),
        Group::decl(&cfg),
        MemReserve::decl(&cfg),
        Graph::decl(&cfg),
        Problem::decl(&cfg),
        Severity::decl(&cfg),
        PropertyType::decl(&cfg),
        PropertySpec::decl(&cfg),
        Binding::decl(&cfg),
        DtMacro::decl(&cfg),
    ];
    let mut out = String::from(HEADER);
    for decl in decls {
        out.push_str("\nexport ");
        out.push_str(&decl);
        out.push('\n');
    }
    out
}

#[test]
fn model_gen_ts_is_up_to_date() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../app/src/model.gen.ts");
    let expected = generate();
    if std::env::var_os("UPDATE_TS").is_some() {
        std::fs::write(&path, &expected).unwrap();
        return;
    }
    let actual = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        actual.replace("\r\n", "\n") == expected,
        "app/src/model.gen.ts is stale; regenerate it with:\n  UPDATE_TS=1 cargo test -p designtree --test typegen"
    );
}
