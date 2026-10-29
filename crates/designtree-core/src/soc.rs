//! Starting a board from a kernel SoC `.dtsi`.
//!
//! [`list_soc_dtsi`] finds the SoC description files of a kernel tree, and
//! [`new_board`] turns one into an empty board that includes it, so that
//! every node of the SoC shows up as inherited.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::import::{import_dts, ImportError};
use crate::model::Graph;
use crate::preprocess::ImportOptions;

/// A SoC description (`.dtsi`) in a kernel tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SocDtsi {
    /// `arm64`, `arm`, `riscv`, ... (the directory under `arch/`).
    pub arch: String,
    /// The directory under `boot/dts/` (`freescale`, `rockchip`); empty for
    /// files that lie directly in it.
    pub vendor: String,
    /// The file name without `.dtsi`, with the subdirectory in front when
    /// the vendor directory has them (`imx/imx6q`).
    pub name: String,
    /// Path relative to the kernel tree, with `/` separators.
    pub path: String,
}

/// A `.dtsi` is taken for a SoC description when it has a root node with
/// CPUs: board-level and peripheral `.dtsi` files (pin functions, PMICs)
/// do not. A file that includes such a SoC file and adds a root node of its
/// own (a SoM, a SoC variant) counts as well.
fn describes_soc(source: &str) -> bool {
    source.contains("cpus {") && has_root(source)
}

fn has_root(source: &str) -> bool {
    source.lines().any(|l| l.trim_start().starts_with("/ {"))
}

fn collect(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // Symbolic links are skipped so that the walk stays in the tree.
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect(&path, found);
        } else if kind.is_file() && path.extension().is_some_and(|e| e == "dtsi") {
            found.push(path);
        }
    }
}

/// The SoC `.dtsi` files of a kernel tree, sorted by architecture, vendor
/// and name. Empty when the tree has no devicetree sources.
pub fn list_soc_dtsi(linux: &Path) -> Vec<SocDtsi> {
    let mut socs = Vec::new();
    let Ok(archs) = fs::read_dir(linux.join("arch")) else {
        return socs;
    };
    for arch in archs.flatten() {
        let dts_dir = arch.path().join("boot/dts");
        let mut files = Vec::new();
        collect(&dts_dir, &mut files);
        let sources: Vec<_> = files
            .into_iter()
            .filter_map(|f| fs::read_to_string(&f).ok().map(|s| (f, s)))
            .collect();
        let direct: Vec<_> = sources
            .iter()
            .filter(|(_, s)| describes_soc(s))
            .map(|(f, _)| f.clone())
            .collect();
        for (file, source) in sources {
            // rk3399.dtsi only includes rk3399-base.dtsi, which has the CPUs.
            let extends_soc = has_root(&source)
                && direct.iter().any(|d| {
                    d.parent() == file.parent()
                        && d.file_name().is_some_and(|n| {
                            source.contains(&format!("#include \"{}\"", n.to_string_lossy()))
                        })
                });
            if !(describes_soc(&source) || extends_soc) {
                continue;
            }
            let Ok(rel) = file.strip_prefix(&dts_dir) else {
                continue;
            };
            let parts: Vec<_> = rel.iter().map(|p| p.to_string_lossy()).collect();
            let (vendor, rest) = match parts.split_last() {
                Some((_, dirs)) if !dirs.is_empty() => (parts[0].to_string(), parts[1..].join("/")),
                _ => (String::new(), parts.join("/")),
            };
            socs.push(SocDtsi {
                arch: arch.file_name().to_string_lossy().into_owned(),
                vendor,
                name: rest.trim_end_matches(".dtsi").to_string(),
                path: file
                    .strip_prefix(linux)
                    .unwrap_or(&file)
                    .to_string_lossy()
                    .replace('\\', "/"),
            });
        }
    }
    socs.sort_by(|a, b| (&a.arch, &a.vendor, &a.name).cmp(&(&b.arch, &b.vendor, &b.name)));
    socs
}

/// An empty board that includes the SoC `.dtsi` at `soc` (a path relative
/// to the kernel tree, as listed by [`list_soc_dtsi`]).
///
/// The board is imported from a stub placed next to the `.dtsi`, so that
/// the include is the bare file name, as in the kernel's own boards.
pub fn new_board(linux: &Path, soc: &str) -> Result<Graph, ImportError> {
    let err = |message: &str| ImportError::new(soc.to_string(), 1, message.to_string());
    let linux = linux
        .canonicalize()
        .map_err(|e| err(&format!("kernel tree: {e}")))?;
    let file = linux
        .join(soc)
        .canonicalize()
        .map_err(|e| err(&e.to_string()))?;
    // The path comes from the UI: only .dtsi files under arch/*/boot/dts.
    let in_dts_dir = file.strip_prefix(linux.join("arch")).ok().is_some_and(|p| {
        p.components()
            .nth(1)
            .is_some_and(|c| c.as_os_str() == "boot")
    });
    if !in_dts_dir || file.extension().is_none_or(|e| e != "dtsi") {
        return Err(err("not a .dtsi under arch/*/boot/dts"));
    }
    let name = file.file_name().unwrap().to_string_lossy();
    let source = format!("/dts-v1/;\n\n#include \"{name}\"\n");
    import_dts(
        &source,
        &file.with_file_name("new-board.dts"),
        &ImportOptions::kernel(&linux),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A kernel tree with one SoC and one non-SoC `.dtsi`.
    fn tree() -> tempfile_dir::Dir {
        let dir = tempfile_dir::Dir::new();
        let dts = dir.path().join("arch/arm64/boot/dts/acme");
        fs::create_dir_all(&dts).unwrap();
        fs::create_dir_all(dir.path().join("scripts/dtc/include-prefixes")).unwrap();
        fs::write(
            dts.join("acme1.dtsi"),
            "/ {\n\tcompatible = \"acme,acme1\";\n\t#address-cells = <1>;\n\t#size-cells = <1>;\n\tcpus {\n\t\t#address-cells = <1>;\n\t\t#size-cells = <0>;\n\t\tcpu@0 {\n\t\t\tdevice_type = \"cpu\";\n\t\t\treg = <0>;\n\t\t};\n\t};\n\tsoc {\n\t\tuart0: serial@1000 {\n\t\t\treg = <0x1000 0x100>;\n\t\t};\n\t};\n};\n",
        )
        .unwrap();
        fs::write(
            dts.join("acme1-pinfunc.dtsi"),
            "&uart0 {\n\tstatus = \"okay\";\n};\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn lists_only_soc_files() {
        let dir = tree();
        let socs = list_soc_dtsi(dir.path());
        assert_eq!(
            socs,
            vec![SocDtsi {
                arch: "arm64".into(),
                vendor: "acme".into(),
                name: "acme1".into(),
                path: "arch/arm64/boot/dts/acme/acme1.dtsi".into(),
            }]
        );
    }

    #[test]
    fn new_board_inherits_the_soc() {
        let dir = tree();
        let graph = new_board(dir.path(), "arch/arm64/boot/dts/acme/acme1.dtsi").unwrap();
        assert_eq!(graph.includes, vec!["#include \"acme1.dtsi\"".to_string()]);
        let uart = graph
            .nodes
            .iter()
            .find(|n| n.id.0 == "/soc/serial@1000")
            .unwrap();
        assert!(uart.inherited.is_some());
        assert!(graph.nodes.iter().all(|n| n.inherited.is_some()));
    }

    #[test]
    fn new_board_rejects_other_paths() {
        let dir = tree();
        fs::write(dir.path().join("secret.dtsi"), "/ { };").unwrap();
        assert!(new_board(dir.path(), "secret.dtsi").is_err());
        assert!(new_board(dir.path(), "../secret.dtsi").is_err());
        assert!(new_board(dir.path(), "arch/arm64/boot/dts/acme/missing.dtsi").is_err());
    }

    /// A temporary directory removed on drop (the crate has no tempfile
    /// dependency).
    mod tempfile_dir {
        use std::path::{Path, PathBuf};

        pub struct Dir(PathBuf);

        impl Dir {
            pub fn new() -> Self {
                let nonce = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos();
                let path = std::env::temp_dir()
                    .join(format!("designtree-soc-{}-{nonce}", std::process::id()));
                std::fs::create_dir_all(&path).unwrap();
                Self(path)
            }

            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
}
