//! Tauri shell around the DesignTree crates. Every command takes and returns
//! JSON-serializable values; the front end never sees Rust types directly.

use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use designtree_bindings::{Binding, Catalog};
use designtree_core::dtc::DtcError;
use designtree_core::{Graph, ImportOptions, Problem};
use serde::Serialize;
use tauri::State;

#[derive(Default)]
struct AppState {
    catalog: RwLock<Catalog>,
    /// Kernel tree of the loaded catalog; its include directories are used
    /// when importing devicetrees from outside a kernel tree.
    linux_src: RwLock<Option<PathBuf>>,
    /// Configured `dtc` program; `PATH` is searched when unset.
    dtc_path: RwLock<Option<PathBuf>>,
}

#[derive(Serialize)]
struct CatalogSummary {
    bindings: usize,
    compatibles: usize,
    categories: Vec<String>,
    skipped: usize,
}

/// Indexes the binding schemas of a kernel tree and keeps them in memory.
#[tauri::command]
fn load_kernel_bindings(
    linux_src: PathBuf,
    state: State<AppState>,
) -> Result<CatalogSummary, String> {
    let catalog = designtree_bindings::index_kernel_tree(&linux_src).map_err(|e| e.to_string())?;
    let mut categories: Vec<String> = catalog
        .bindings
        .iter()
        .map(|b| b.category.clone())
        .collect();
    categories.sort();
    categories.dedup();
    let summary = CatalogSummary {
        bindings: catalog.bindings.len(),
        compatibles: catalog.bindings.iter().map(|b| b.compatibles.len()).sum(),
        categories,
        skipped: catalog.skipped.len(),
    };
    *state.catalog.write().unwrap() = catalog;
    *state.linux_src.write().unwrap() = Some(linux_src);
    Ok(summary)
}

/// Searches the loaded catalog by compatible string, title or path.
#[tauri::command]
fn search_bindings(
    query: String,
    category: Option<String>,
    limit: usize,
    state: State<AppState>,
) -> Vec<Binding> {
    let query = query.to_lowercase();
    let catalog = state.catalog.read().unwrap();
    catalog
        .bindings
        .iter()
        .filter(|b| category.as_ref().is_none_or(|c| &b.category == c))
        .filter(|b| {
            query.is_empty()
                || b.path.contains(&query)
                || b.compatibles.iter().any(|c| c.contains(&query))
                || b.title
                    .as_ref()
                    .is_some_and(|t| t.to_lowercase().contains(&query))
        })
        .take(limit)
        .cloned()
        .collect()
}

#[derive(Serialize)]
struct StartupArgs {
    /// Design file given on the command line (`designtree-app board.json`).
    design: Option<Graph>,
    /// Kernel tree to index at startup, from `DESIGNTREE_LINUX_SRC`.
    linux_src: Option<PathBuf>,
}

#[tauri::command]
fn startup_args() -> Result<StartupArgs, String> {
    let design = match std::env::args_os().nth(1) {
        Some(path) => Some(open_design(PathBuf::from(path))?),
        None => None,
    };
    Ok(StartupArgs {
        design,
        linux_src: std::env::var_os("DESIGNTREE_LINUX_SRC").map(PathBuf::from),
    })
}

#[tauri::command]
fn validate_design(design: Graph) -> Vec<String> {
    designtree_core::validate(&design)
        .iter()
        .map(ToString::to_string)
        .collect()
}

/// Arranges nodes and bus groups; the caller keeps its own copy for undo.
#[tauri::command]
fn auto_layout(mut design: Graph) -> Graph {
    designtree_core::auto_layout(&mut design);
    design
}

#[tauri::command]
fn export_dts(design: Graph) -> Result<String, Vec<String>> {
    designtree_core::to_dts(&design)
        .map_err(|errors| errors.iter().map(ToString::to_string).collect())
}

#[tauri::command]
fn save_design(path: PathBuf, design: Graph) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&design).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_design(path: PathBuf) -> Result<Graph, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Imports devicetree source with `#include` resolved: from the kernel tree
/// the file lies in, else from the kernel tree of the loaded catalog.
/// Errors carry file, line and column. Runs off the UI thread, since
/// large boards pull in many files.
#[tauri::command(async)]
fn import_dts(path: PathBuf, state: State<AppState>) -> Result<Graph, String> {
    let fallback = state.linux_src.read().unwrap().clone();
    let options = ImportOptions::detect_or(&path, fallback.as_deref());
    designtree_core::import_dts_file(&path, &options).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct BuildResult {
    /// The `.dtb`, when the build succeeded.
    output: Option<PathBuf>,
    /// dtc's messages that are not about a single node, or all of them
    /// when none could be parsed.
    log: String,
    /// dtc's errors and warnings, attached to nodes where possible.
    problems: Vec<Problem>,
}

/// Sets the `dtc` program used by `build_dtb`; `None` goes back to `PATH`.
#[tauri::command]
fn set_dtc_path(path: Option<PathBuf>, state: State<AppState>) {
    *state.dtc_path.write().unwrap() = path;
}

/// Compiles the whole tree (includes flattened, so no preprocessor is
/// needed) to a `.dtb` at `output`. A failed build is not an `Err`: dtc's
/// errors come back as problems so the UI can show them on the nodes.
/// Runs off the UI thread.
#[tauri::command(async)]
fn build_dtb(
    design: Graph,
    output: PathBuf,
    state: State<AppState>,
) -> Result<BuildResult, String> {
    let (dts, map) = designtree_core::to_dts_flat_mapped(&design).map_err(|errors| {
        errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    })?;
    let dtc = state.dtc_path.read().unwrap().clone().or_else(|| {
        std::env::var_os("DESIGNTREE_DTC")
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
    });
    match designtree_core::dtc::compile_dtb(&dts, &output, dtc.as_deref()) {
        Ok(built) => Ok(BuildResult {
            output: Some(output),
            problems: designtree_core::parse_problems(&built.warnings, &map),
            log: built.warnings,
        }),
        Err(DtcError::Failed(log)) => Ok(BuildResult {
            output: None,
            problems: designtree_core::parse_problems(&log, &map),
            log,
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_text(path: PathBuf, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            startup_args,
            load_kernel_bindings,
            search_bindings,
            validate_design,
            auto_layout,
            export_dts,
            save_design,
            open_design,
            import_dts,
            write_text,
            set_dtc_path,
            build_dtb,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DesignTree");
}
