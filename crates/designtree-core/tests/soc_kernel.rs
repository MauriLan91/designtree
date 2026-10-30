//! Starting a board from SoC `.dtsi` files of a real kernel tree.
//!
//!     DESIGNTREE_LINUX_SRC=~/linux-g1 cargo test -p designtree-core --test soc_kernel -- --ignored --nocapture

use std::path::PathBuf;

use designtree_core::{list_soc_dtsi, new_board, to_dts};

#[test]
#[ignore = "needs a kernel tree in DESIGNTREE_LINUX_SRC"]
fn new_board_from_listed_socs() {
    let linux =
        PathBuf::from(std::env::var_os("DESIGNTREE_LINUX_SRC").expect("DESIGNTREE_LINUX_SRC"));
    let socs = list_soc_dtsi(&linux);
    assert!(socs.len() > 50, "only {} SoC files found", socs.len());
    for wanted in ["freescale/imx8mp", "rockchip/rk3399", "nxp/imx/imx6q"] {
        println!(
            "{wanted}: {}",
            socs.iter()
                .any(|s| format!("{}/{}", s.vendor, s.name) == wanted)
        );
    }
    let mut failed = Vec::new();
    for soc in &socs {
        match new_board(&linux, &soc.path) {
            Ok(graph) => {
                assert!(
                    graph.nodes.iter().all(|n| n.inherited.is_some()),
                    "{}",
                    soc.path
                );
                // An unmodified board exports as just the include.
                let dts = to_dts(&graph).unwrap();
                assert!(
                    dts.contains(&format!(
                        "#include \"{}\"",
                        soc.path.rsplit('/').next().unwrap()
                    )),
                    "{}",
                    soc.path
                );
            }
            Err(e) => failed.push(format!("{}: {e}", soc.path)),
        }
    }
    println!("{} SoC files, {} failed", socs.len(), failed.len());
    for f in failed.iter().take(10) {
        println!("  {f}");
    }
    // Some files only work in the board that defines the labels they refer to.
    assert!(failed.len() * 5 < socs.len(), "too many failures");
}
