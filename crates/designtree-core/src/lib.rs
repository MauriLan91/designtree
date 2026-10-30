//! Core data model of DesignTree.
//!
//! A design is a [`Graph`] of devicetree nodes. Two kinds of edges connect
//! them: *child* edges build the devicetree hierarchy, *reference* edges
//! become phandle properties (`clocks = <&osc 0>;`). Groups are a purely
//! visual concept and never affect the generated source.

pub mod dtc;
pub mod dts;
pub mod import;
pub mod interrupts;
pub mod layout;
pub mod model;
pub mod parse;
mod preprocess;
pub mod problems;
pub mod soc;
pub mod validate;

pub use dts::{to_dts, to_dts_flat, to_dts_flat_mapped, NodeSpan, SourceMap};
pub use import::{import_dts, import_dts_file, ImportError};
pub use interrupts::{interrupt_tree, InterruptController, InterruptProblem, InterruptTree};
pub use layout::auto_layout;
pub use model::*;
pub use preprocess::ImportOptions;
pub use problems::{parse_problems, Problem, Severity};
pub use soc::{list_soc_dtsi, new_board, SocDtsi};
pub use validate::{validate, ValidationError};
