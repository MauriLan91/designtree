//! Generated SoC-like boards of a chosen size, for the G5 benchmark (US-11.1).
//!
//! The board is written as DTS and imported, so a benchmark runs the same
//! code paths as a real board: a clock controller, an interrupt controller
//! and pin controller that every peripheral references, a memory-mapped bus
//! with `ranges`, and I2C/SPI controllers with devices behind them.

use std::fmt::Write;

/// Devicetree source of a board with about `nodes` nodes (never fewer).
pub fn synthetic_board_dts(nodes: usize) -> String {
    let mut out = String::from(
        "/dts-v1/;\n\n/ {\n\t#address-cells = <1>;\n\t#size-cells = <1>;\n\
         \tcompatible = \"designtree,g5-board\";\n\tmodel = \"G5 benchmark board\";\n\n\
         \tcpus {\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\n",
    );
    // The root, cpus and its 4 cpus, memory, osc, soc, ccu, gic and pio.
    let mut count = 12;
    for cpu in 0..4 {
        let _ = write!(
            out,
            "\t\tcpu@{cpu} {{\n\t\t\tcompatible = \"arm,cortex-a55\";\n\t\t\tdevice_type = \"cpu\";\n\
             \t\t\treg = <{cpu}>;\n\t\t\tclocks = <&ccu 0>;\n\t\t}};\n\n"
        );
    }
    out.push_str(
        "\t};\n\n\tmemory@40000000 {\n\t\tdevice_type = \"memory\";\n\t\treg = <0x40000000 0x80000000>;\n\t};\n\n\
         \tosc: oscillator {\n\t\tcompatible = \"fixed-clock\";\n\t\t#clock-cells = <0>;\n\
         \t\tclock-frequency = <24000000>;\n\t};\n\n\
         \tsoc {\n\t\tcompatible = \"simple-bus\";\n\t\t#address-cells = <1>;\n\t\t#size-cells = <1>;\n\
         \t\tranges = <0x0 0x01000000 0x30000000>;\n\n\
         \t\tccu: clock-controller@0 {\n\t\t\tcompatible = \"designtree,g5-ccu\";\n\t\t\treg = <0x0 0x1000>;\n\
         \t\t\tclocks = <&osc>;\n\t\t\t#clock-cells = <1>;\n\t\t\t#reset-cells = <1>;\n\t\t};\n\n\
         \t\tgic: interrupt-controller@1000 {\n\t\t\tcompatible = \"arm,gic-400\";\n\
         \t\t\treg = <0x1000 0x1000>, <0x2000 0x2000>;\n\t\t\tinterrupt-controller;\n\
         \t\t\t#interrupt-cells = <3>;\n\t\t\t#address-cells = <0>;\n\t\t};\n\n\
         \t\tpio: pinctrl@4000 {\n\t\t\tcompatible = \"designtree,g5-pinctrl\";\n\t\t\treg = <0x4000 0x400>;\n\
         \t\t\tclocks = <&ccu 1>;\n\t\t\tgpio-controller;\n\t\t\t#gpio-cells = <3>;\n\t\t};\n",
    );
    let mut i = 0usize;
    while count < nodes {
        let address = 0x10000 + i * 0x1000;
        let irq = 32 + i % 200;
        let clock = 2 + i % 250;
        // Every fourth peripheral is a bus controller with devices behind it.
        if i % 4 == 3 {
            let (kind, compatible, devices) = if i % 8 == 3 {
                ("i2c", "designtree,g5-i2c", 3)
            } else {
                ("spi", "designtree,g5-spi", 2)
            };
            let _ = write!(
                out,
                "\n\t\t{kind}{i}: {kind}@{address:x} {{\n\t\t\tcompatible = \"{compatible}\";\n\
                 \t\t\treg = <0x{address:x} 0x400>;\n\t\t\tinterrupts = <0 {irq} 4>;\n\
                 \t\t\tinterrupt-parent = <&gic>;\n\t\t\tclocks = <&ccu {clock}>;\n\
                 \t\t\tresets = <&ccu {clock}>;\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n"
            );
            count += 1;
            for d in 0..devices {
                if count >= nodes {
                    break;
                }
                let at = if kind == "i2c" { 0x20 + d } else { d };
                let _ = write!(
                    out,
                    "\n\t\t\tdevice@{at:x} {{\n\t\t\t\tcompatible = \"designtree,g5-{kind}-device\";\n\
                     \t\t\t\treg = <0x{at:x}>;\n\t\t\t\tinterrupts-extended = <&pio 1 {d} 2>;\n\t\t\t}};\n"
                );
                count += 1;
            }
            out.push_str("\t\t};\n");
        } else {
            let _ = write!(
                out,
                "\n\t\tdev{i}: peripheral@{address:x} {{\n\t\t\tcompatible = \"designtree,g5-peripheral\";\n\
                 \t\t\treg = <0x{address:x} 0x400>;\n\t\t\tinterrupts = <0 {irq} 4>;\n\
                 \t\t\tinterrupt-parent = <&gic>;\n\t\t\tclocks = <&ccu {clock}>;\n\
                 \t\t\tresets = <&ccu {clock}>;\n\t\t\tstatus = \"okay\";\n\t\t}};\n"
            );
            count += 1;
        }
        i += 1;
    }
    out.push_str("\t};\n};\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{import_dts, validate, ImportOptions};
    use std::path::Path;

    #[test]
    fn the_board_has_the_requested_size_and_is_valid() {
        for nodes in [20, 1000] {
            let dts = synthetic_board_dts(nodes);
            let graph = import_dts(&dts, Path::new("g5.dts"), &ImportOptions::default()).unwrap();
            assert!(
                (nodes..nodes + 4).contains(&graph.nodes.len()),
                "{nodes} requested, {} generated",
                graph.nodes.len()
            );
            assert_eq!(validate(&graph), vec![]);
        }
    }
}
