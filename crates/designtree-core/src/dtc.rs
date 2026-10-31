//! Compiling devicetree source to a binary blob with the `dtc` program.
//!
//! `dtc` is run without a shell: the source goes in on stdin and the blob
//! comes back on stdout, so no path ever reaches `dtc`'s command line. The
//! blob is written to a temporary file next to the target and renamed, so a
//! failed build never leaves a truncated `.dtb` behind.

use std::ffi::OsString;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use thiserror::Error;

/// Program name looked up in `PATH` when no path is configured.
pub const DEFAULT_DTC: &str = "dtc";

#[derive(Debug, Error)]
pub enum DtcError {
    #[error(
        "`{0}` was not found. Install the device-tree-compiler package or set the path to dtc."
    )]
    NotFound(String),
    #[error("cannot run `{program}`: {source}")]
    Spawn { program: String, source: io::Error },
    /// dtc rejected the source; the message is its own diagnostics.
    #[error("dtc failed:\n{0}")]
    Failed(String),
    #[error("cannot write {}: {source}", path.display())]
    Write { path: PathBuf, source: io::Error },
}

/// What a successful build produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DtcOutput {
    /// dtc's warnings, empty when there were none.
    pub warnings: String,
}

/// Compiles `dts` to a `.dtb` at `output`, using `dtc` from `PATH` or the
/// program at `dtc` when given. The blob carries `__symbols__` (`-@`), so
/// overlays can be applied to it.
pub fn compile_dtb(dts: &str, output: &Path, dtc: Option<&Path>) -> Result<DtcOutput, DtcError> {
    let program: OsString = dtc.map_or_else(|| DEFAULT_DTC.into(), |p| p.as_os_str().to_owned());
    let name = program.to_string_lossy().into_owned();
    let mut child = Command::new(&program)
        .args(["-@", "-I", "dts", "-O", "dtb", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|source| match source.kind() {
            io::ErrorKind::NotFound => DtcError::NotFound(name.clone()),
            _ => DtcError::Spawn {
                program: name.clone(),
                source,
            },
        })?;

    // Feed stdin from a thread: dtc may fill its output pipes before it has
    // read everything.
    let mut stdin = child.stdin.take().expect("piped stdin");
    let source = dts.to_owned();
    let writer = thread::spawn(move || stdin.write_all(source.as_bytes()));
    let result = child.wait_with_output().map_err(|source| DtcError::Spawn {
        program: name.clone(),
        source,
    })?;
    // A write error (broken pipe) means dtc stopped reading; its own
    // diagnostics below explain why.
    let _ = writer.join();

    let stderr = String::from_utf8_lossy(&result.stderr).trim().to_owned();
    if !result.status.success() {
        return Err(DtcError::Failed(if stderr.is_empty() {
            format!("{name} exited with {}", result.status)
        } else {
            stderr
        }));
    }
    write_atomically(output, &result.stdout).map_err(|source| DtcError::Write {
        path: output.to_owned(),
        source,
    })?;
    Ok(DtcOutput { warnings: stderr })
}

fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let written = std::fs::write(&tmp, bytes).and_then(|()| std::fs::rename(&tmp, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dtc_available() -> bool {
        Command::new(DEFAULT_DTC).arg("--version").output().is_ok()
    }

    /// Skips unless dtc is installed; CI sets `DESIGNTREE_REQUIRE_DTC`.
    fn require_dtc() -> bool {
        if dtc_available() {
            return true;
        }
        assert!(
            std::env::var_os("DESIGNTREE_REQUIRE_DTC").is_none(),
            "dtc is required (DESIGNTREE_REQUIRE_DTC is set) but was not found"
        );
        eprintln!("dtc not found, skipping");
        false
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("designtree-dtc-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_program_is_reported_clearly() {
        let dir = temp_dir("missing");
        let err = compile_dtb(
            "/dts-v1/; / {};",
            &dir.join("a.dtb"),
            Some(Path::new("/nonexistent/dtc")),
        )
        .unwrap_err();
        assert!(matches!(err, DtcError::NotFound(_)), "{err}");
        assert!(err.to_string().contains("not found"));
        assert!(!dir.join("a.dtb").exists());
    }

    #[test]
    fn compiles_a_tree() {
        if !require_dtc() {
            return;
        }
        let dir = temp_dir("ok");
        let out = dir.join("board.dtb");
        compile_dtb("/dts-v1/; / { model = \"x\"; };", &out, None).unwrap();
        let blob = std::fs::read(&out).unwrap();
        assert_eq!(&blob[..4], &[0xd0, 0x0d, 0xfe, 0xed], "FDT magic");
        assert!(!dir.join("board.dtb.tmp").exists());
    }

    #[test]
    fn syntax_errors_come_back_and_leave_no_file() {
        if !require_dtc() {
            return;
        }
        let dir = temp_dir("bad");
        let out = dir.join("bad.dtb");
        let err = compile_dtb("/dts-v1/; / { oops", &out, None).unwrap_err();
        match err {
            DtcError::Failed(msg) => assert!(!msg.is_empty()),
            other => panic!("unexpected {other}"),
        }
        assert!(!out.exists());
    }

    #[test]
    fn warnings_are_returned() {
        if !require_dtc() {
            return;
        }
        let dir = temp_dir("warn");
        // A unit address without a reg property draws a warning.
        let out = compile_dtb(
            "/dts-v1/; / { #address-cells = <1>; #size-cells = <1>; n@10 {}; };",
            &dir.join("w.dtb"),
            None,
        )
        .unwrap();
        assert!(!out.warnings.is_empty());
    }
}
