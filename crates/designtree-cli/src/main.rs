use std::fs;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use designtree_core::Graph;

/// DesignTree: build Linux devicetrees as node graphs.
#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Index the binding schemas of a Linux source tree into an element library.
    Index {
        /// Path to a Linux kernel source checkout.
        linux_src: PathBuf,
        /// Output file (JSON). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Import devicetree source (.dts) into a design file.
    Import {
        dts: PathBuf,
        /// Output file (JSON). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Check a design file for structural errors.
    Validate { design: PathBuf },
    /// Arrange the nodes of a design file automatically.
    Layout {
        design: PathBuf,
        /// Output design file (JSON). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Generate devicetree source from a design file.
    Export {
        design: PathBuf,
        /// Output file (.dts). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Index { linux_src, output } => {
            let catalog = designtree_bindings::index_kernel_tree(&linux_src)?;
            eprintln!(
                "indexed {} bindings ({} skipped)",
                catalog.bindings.len(),
                catalog.skipped.len()
            );
            write_output(output, &serde_json::to_string_pretty(&catalog)?)
        }
        Command::Import { dts, output } => {
            let source =
                fs::read_to_string(&dts).with_context(|| format!("reading {}", dts.display()))?;
            let graph = designtree_core::import_dts(&source, &dts.display().to_string())?;
            write_output(output, &serde_json::to_string_pretty(&graph)?)
        }
        Command::Validate { design } => {
            let errors = designtree_core::validate(&load(&design)?);
            if errors.is_empty() {
                println!("ok");
                return Ok(());
            }
            for error in &errors {
                eprintln!("error: {error}");
            }
            bail!("{} problem(s) found", errors.len())
        }
        Command::Layout { design, output } => {
            let mut graph = load(&design)?;
            designtree_core::auto_layout(&mut graph);
            write_output(output, &serde_json::to_string_pretty(&graph)?)
        }
        Command::Export { design, output } => match designtree_core::to_dts(&load(&design)?) {
            Ok(dts) => write_output(output, &dts),
            Err(errors) => {
                for error in &errors {
                    eprintln!("error: {error}");
                }
                bail!("cannot export: {} problem(s) found", errors.len())
            }
        },
    }
}

fn load(path: &PathBuf) -> Result<Graph> {
    let text = fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

fn write_output(path: Option<PathBuf>, content: &str) -> Result<()> {
    match path {
        Some(path) => {
            fs::write(&path, content).with_context(|| format!("writing {}", path.display()))
        }
        None => {
            print!("{content}");
            Ok(())
        }
    }
}
