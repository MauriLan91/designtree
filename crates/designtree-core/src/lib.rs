//! Core data model of DesignTree.
//!
//! A design is a [`Graph`] of devicetree nodes. Two kinds of edges connect
//! them: *child* edges build the devicetree hierarchy, *reference* edges
//! become phandle properties (`clocks = <&osc 0>;`). Groups are a purely
//! visual concept and never affect the generated source.

pub mod dts;
pub mod import;
pub mod model;
pub mod parse;
mod preprocess;
pub mod validate;

pub use dts::to_dts;
pub use import::{import_dts, import_dts_file, ImportError};
pub use model::*;
pub use preprocess::ImportOptions;
pub use validate::{validate, ValidationError};
