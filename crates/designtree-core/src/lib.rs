//! Core data model of DesignTree.
//!
//! A design is a [`Graph`] of devicetree nodes. Two kinds of edges connect
//! them: *child* edges build the devicetree hierarchy, *reference* edges
//! become phandle properties (`clocks = <&osc 0>;`). Groups are a purely
//! visual concept and never affect the generated source.

pub mod address_map;
pub mod dtc;
pub mod dts;
pub mod fdt;
pub mod import;
pub mod interrupts;
pub mod layout;
pub mod model;
pub mod overlay;
pub mod parse;
mod preprocess;
pub mod problems;
pub mod soc;
pub mod text_edit;
pub mod validate;

pub use address_map::{address_map, AddressMap, AddressProblem, Bus, Region};
pub use dts::{to_dts, to_dts_flat, to_dts_flat_mapped, to_dts_mapped, NodeSpan, SourceMap};
pub use fdt::{to_dtb, Dtb};
pub use import::{import_dts, import_dts_file, import_dts_mapped, ImportError};
pub use interrupts::{interrupt_tree, InterruptController, InterruptProblem, InterruptTree};
pub use layout::auto_layout;
pub use model::*;
pub use overlay::{new_overlay, overlay_on, OverlayError};
pub use preprocess::ImportOptions;
pub use problems::{parse_problems, Problem, Severity};
pub use soc::{list_soc_dtsi, new_board, SocDtsi};
pub use text_edit::apply_source;
pub use validate::{validate, ValidationError};
