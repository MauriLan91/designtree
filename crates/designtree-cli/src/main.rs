use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use designtree_bindings::Checker;
use designtree_core::{Graph, ImportOptions};

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
        /// Output file (JSON). Prints to stdout when omitted, unless
        /// --stats is given.
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Print how many schemas were indexed and how many properties
        /// have a resolved type, against the G2 targets.
        #[arg(long)]
        stats: bool,
    },
    /// Import devicetree source (.dts) into a design file.
    ///
    /// `#include` and macros are resolved. Inside a kernel tree the kernel's
    /// include directories are used automatically.
    Import {
        dts: PathBuf,
        /// Output file (JSON). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Kernel source tree whose include directories to use.
        #[arg(long)]
        linux: Option<PathBuf>,
        /// Additional include directory (repeatable), searched after the
        /// kernel ones.
        #[arg(short = 'I', long = "include")]
        include_dirs: Vec<PathBuf>,
    },
    /// Check a devicetree against the binding schemas of a kernel tree,
    /// like `make dtbs_check`. Takes a design file (.json), devicetree
    /// source (.dts, imported first) or a compiled blob (.dtb).
    Check {
        input: PathBuf,
        /// Kernel source tree whose binding schemas to use.
        #[arg(long)]
        linux: PathBuf,
        /// Keep the processed schemas here and reuse them while the
        /// bindings do not change.
        #[arg(long)]
        cache: Option<PathBuf>,
        /// Print the problems as JSON.
        #[arg(long)]
        json: bool,
    },
    /// Check a design file for structural errors.
    Validate { design: PathBuf },
    /// Print the interrupt tree of a design file: each controller with the
    /// devices wired to it, and the devices that have no usable parent.
    Interrupts { design: PathBuf },
    /// Arrange the nodes of a design file automatically.
    Layout {
        design: PathBuf,
        /// Output design file (JSON). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Generate devicetree source from a design file. A design imported
    /// from a board file with includes becomes a board file again: its
    /// includes plus overrides, to be built next to the original like the
    /// kernel does (cpp, then dtc). Use --flatten for a self-contained tree.
    Export {
        design: PathBuf,
        /// Output file (.dts). Prints to stdout when omitted.
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Write the whole tree instead of the board's includes and
        /// overrides.
        #[arg(long)]
        flatten: bool,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Index {
            linux_src,
            output,
            stats,
        } => {
            let catalog = designtree_bindings::index_kernel_tree(&linux_src)?;
            eprintln!(
                "indexed {} bindings ({} skipped)",
                catalog.bindings.len(),
                catalog.skipped.len()
            );
            if stats {
                println!("{}", catalog.stats());
            }
            if stats && output.is_none() {
                return Ok(());
            }
            write_output(output, &serde_json::to_string_pretty(&catalog)?)
        }
        Command::Import {
            dts,
            output,
            linux,
            include_dirs,
        } => {
            let mut options = match linux {
                Some(linux) => ImportOptions::kernel(&linux),
                None => ImportOptions::detect(&dts),
            };
            options.include_dirs.extend(include_dirs);
            let graph = designtree_core::import_dts_file(&dts, &options)?;
            write_output(output, &serde_json::to_string_pretty(&graph)?)
        }
        Command::Check {
            input,
            linux,
            cache,
            json,
        } => check(&input, &linux, cache.as_deref(), json),
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
        Command::Interrupts { design } => {
            let graph = load(&design)?;
            let tree = designtree_core::interrupt_tree(&graph);
            let name = |id: &designtree_core::NodeId| {
                graph
                    .node(id)
                    .map_or_else(|| id.0.clone(), |n| n.full_name())
            };
            fn print(
                tree: &designtree_core::InterruptTree,
                name: &dyn Fn(&designtree_core::NodeId) -> String,
                parent: Option<&designtree_core::NodeId>,
                depth: usize,
            ) {
                for controller in tree
                    .controllers
                    .iter()
                    .filter(|c| c.parent.as_ref() == parent)
                {
                    println!("{}{}", "  ".repeat(depth), name(&controller.node));
                    for device in &controller.devices {
                        // A cascaded controller is printed as a controller below.
                        if !tree.controllers.iter().any(|c| &c.node == device) {
                            println!("{}- {}", "  ".repeat(depth + 1), name(device));
                        }
                    }
                    print(tree, name, Some(&controller.node), depth + 1);
                }
            }
            print(&tree, &name, None, 0);
            for problem in &tree.problems {
                eprintln!("warning: {}: {}", name(&problem.node), problem.message);
            }
            Ok(())
        }
        Command::Layout { design, output } => {
            let mut graph = load(&design)?;
            designtree_core::auto_layout(&mut graph);
            write_output(output, &serde_json::to_string_pretty(&graph)?)
        }
        Command::Export {
            design,
            output,
            flatten,
        } => match if flatten {
            designtree_core::to_dts_flat(&load(&design)?)
        } else {
            designtree_core::to_dts(&load(&design)?)
        } {
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

fn check(input: &Path, linux: &Path, cache: Option<&Path>, json: bool) -> Result<()> {
    let started = Instant::now();
    let catalog = match cache {
        Some(cache) => designtree_bindings::index_kernel_tree_cached(linux, cache)?.0,
        None => designtree_bindings::index_kernel_tree(linux)?,
    };
    let checker = Checker::new(catalog.schemas);
    eprintln!("schemas loaded in {:.0?}", started.elapsed());

    let blob = match input.extension().and_then(|e| e.to_str()) {
        Some("dtb") => fs::read(input).with_context(|| format!("reading {}", input.display()))?,
        other => {
            let graph = match other {
                Some("dts") => {
                    designtree_core::import_dts_file(input, &ImportOptions::kernel(linux))?
                }
                _ => load(input)?,
            };
            match designtree_core::to_dtb(&graph) {
                Ok(dtb) => dtb.blob,
                Err(errors) => {
                    for error in &errors {
                        eprintln!("error: {error}");
                    }
                    bail!("cannot check: {} problem(s) found", errors.len())
                }
            }
        }
    };
    let started = Instant::now();
    let problems = checker.check_dtb(&blob)?;
    eprintln!("checked in {:.0?}", started.elapsed());
    if json {
        println!("{}", serde_json::to_string_pretty(&problems)?);
    } else {
        for p in &problems {
            let property = p
                .property
                .as_deref()
                .map(|p| format!("{p}: "))
                .unwrap_or_default();
            println!("{}: {property}{} ({})", p.node, p.message, p.schema);
        }
    }
    eprintln!("{} problem(s)", problems.len());
    Ok(())
}

fn load(path: &Path) -> Result<Graph> {
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
