//! Tauri shell around the DesignTree crates. Every command takes and returns
//! JSON-serializable values; the front end never sees Rust types directly.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use designtree_bindings::{Binding, Catalog, Checker, DtMacro, LibraryEntry};
use designtree_core::dtc::DtcError;
use designtree_core::{
    AddressMap, BoardLink, Graph, ImportOptions, InterruptTree, PinCheck, Problem, Severity,
};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
struct AppState {
    catalog: RwLock<Catalog>,
    /// Kernel tree of the loaded catalog; its include directories are used
    /// when importing devicetrees from outside a kernel tree.
    linux_src: RwLock<Option<PathBuf>>,
    /// Constants of the kernel's `dt-bindings` headers, for naming cells.
    macros: RwLock<Vec<DtMacro>>,
    /// Configured `dtc` program; `PATH` is searched when unset.
    dtc_path: RwLock<Option<PathBuf>>,
    /// Schema validation with the bindings of the loaded catalog.
    checker: RwLock<Option<Arc<Checker>>>,
}

#[derive(Serialize)]
struct CatalogSummary {
    bindings: usize,
    compatibles: usize,
    categories: Vec<String>,
    skipped: usize,
    /// The kernel tree that was indexed.
    path: PathBuf,
    /// Its version, from the `Makefile`.
    version: Option<String>,
    /// The index came from the cache: no schema was read.
    cached: bool,
}

/// A registered kernel checkout.
#[derive(Serialize)]
struct KernelInfo {
    path: PathBuf,
    version: Option<String>,
}

impl KernelInfo {
    fn new(path: PathBuf) -> Self {
        let version = designtree_bindings::kernel_version(&path);
        Self { path, version }
    }
}

/// The registered kernel checkouts live in one file of the app's config
/// directory, the indexes in its cache directory.
fn kernels_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("kernels.json"))
}

fn read_kernels(app: &AppHandle) -> Vec<PathBuf> {
    let Ok(file) = kernels_file(app) else {
        return Vec::new();
    };
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_kernels(app: &AppHandle, kernels: &[PathBuf]) -> Result<(), String> {
    let file = kernels_file(app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(kernels).map_err(|e| e.to_string())?;
    fs::write(file, text).map_err(|e| e.to_string())
}

/// The user's settings (US-15.5), one JSON object in the app's config
/// directory. The front end owns their shape and validates what it reads, so
/// the backend only checks that it stores a small JSON object.
fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// Far more than any real settings file; a bigger one is refused rather
/// than written.
const MAX_SETTINGS_BYTES: usize = 256 * 1024;

/// The stored settings, or `null` when there are none or they do not parse.
#[tauri::command]
fn read_settings(app: AppHandle) -> serde_json::Value {
    settings_file(&app)
        .ok()
        // Checked before reading, so a huge or odd file is never loaded.
        .filter(|file| {
            fs::metadata(file).is_ok_and(|m| m.is_file() && m.len() <= MAX_SETTINGS_BYTES as u64)
        })
        .and_then(|file| fs::read_to_string(file).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or(serde_json::Value::Null)
}

/// Replaces the stored settings. Written to a temporary file and renamed, so
/// a crash never leaves half a file behind.
#[tauri::command]
fn write_settings(settings: serde_json::Value, app: AppHandle) -> Result<(), String> {
    if !settings.is_object() {
        return Err("settings must be a JSON object".into());
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    if text.len() > MAX_SETTINGS_BYTES {
        return Err("settings are too large".into());
    }
    let file = settings_file(&app)?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

/// The absolute path of `path`, when it is a kernel source tree (it has
/// binding schemas). Registered paths are always in this form, so that one
/// checkout is not listed twice.
fn kernel_tree(path: &std::path::Path) -> Result<PathBuf, String> {
    let absolute = path
        .canonicalize()
        .map_err(|e| format!("`{}`: {e}", path.display()))?;
    if !absolute.join(designtree_bindings::BINDINGS_DIR).is_dir() {
        return Err(format!(
            "`{}` does not look like a Linux source tree (missing {})",
            path.display(),
            designtree_bindings::BINDINGS_DIR
        ));
    }
    Ok(absolute)
}

fn register_kernel(app: &AppHandle, path: &PathBuf) -> Result<(), String> {
    let mut kernels = read_kernels(app);
    if !kernels.contains(path) {
        kernels.push(path.clone());
        write_kernels(app, &kernels)?;
    }
    Ok(())
}

/// The registered kernel checkouts with their versions; those that are no
/// longer there are listed without a version.
#[tauri::command]
fn list_kernels(app: AppHandle) -> Vec<KernelInfo> {
    read_kernels(&app)
        .into_iter()
        .map(KernelInfo::new)
        .collect()
}

/// Registers a kernel checkout.
#[tauri::command]
fn add_kernel(path: PathBuf, app: AppHandle) -> Result<KernelInfo, String> {
    let path = kernel_tree(&path)?;
    register_kernel(&app, &path)?;
    Ok(KernelInfo::new(path))
}

/// Forgets a kernel checkout (its files and its cached index stay).
#[tauri::command]
fn remove_kernel(path: PathBuf, app: AppHandle) -> Result<Vec<KernelInfo>, String> {
    let mut kernels = read_kernels(&app);
    kernels.retain(|k| k != &path);
    write_kernels(&app, &kernels)?;
    Ok(kernels.into_iter().map(KernelInfo::new).collect())
}

/// Indexes the binding schemas of a kernel tree, from the cache when they
/// have not changed, keeps them in memory, and registers the checkout.
/// Runs off the UI thread: a first index reads thousands of files.
#[tauri::command(async)]
fn load_kernel_bindings(
    linux_src: PathBuf,
    app: AppHandle,
    state: State<AppState>,
) -> Result<CatalogSummary, String> {
    let linux_src = kernel_tree(&linux_src)?;
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let (catalog, status) = designtree_bindings::index_kernel_tree_cached(&linux_src, &cache_dir)
        .map_err(|e| e.to_string())?;
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
        version: designtree_bindings::kernel_version(&linux_src),
        cached: status == designtree_bindings::CacheStatus::Hit,
        path: linux_src.clone(),
    };
    *state.macros.write().unwrap() = designtree_bindings::index_dt_macros(&linux_src);
    let mut catalog = catalog;
    let checker = Arc::new(Checker::new(std::mem::take(&mut catalog.schemas)));
    *state.checker.write().unwrap() = Some(checker.clone());
    std::thread::spawn(move || checker.warm_up());
    *state.catalog.write().unwrap() = catalog;
    *state.linux_src.write().unwrap() = Some(linux_src.clone());
    // A checkout that cannot be remembered is still loaded.
    let _ = register_kernel(&app, &linux_src);
    Ok(summary)
}

/// Searches the loaded catalog by compatible string, title or path; best
/// match first, each with the compatible that matched listed first.
#[tauri::command]
fn search_bindings(
    query: String,
    category: Option<String>,
    limit: usize,
    state: State<AppState>,
) -> Vec<Binding> {
    let catalog = state.catalog.read().unwrap();
    // One schema per result, with its best-matching compatible first: the
    // search lists every compatible, and a schema can have over a hundred.
    let mut seen = std::collections::HashSet::new();
    catalog
        .search(&query, category.as_deref(), usize::MAX)
        .iter()
        .filter(|hit| seen.insert(hit.binding.path.as_str()))
        .take(limit)
        .map(|hit| hit.to_binding())
        .collect()
}

/// The library entries matching `query`, one per compatible (US-18.1).
/// Without a limit the whole library comes back for the virtualized list.
#[tauri::command]
fn library_entries(
    query: String,
    category: Option<String>,
    limit: Option<usize>,
    state: State<AppState>,
) -> Vec<LibraryEntry> {
    let catalog = state.catalog.read().unwrap();
    catalog
        .search(&query, category.as_deref(), limit.unwrap_or(usize::MAX))
        .iter()
        .map(|hit| hit.to_entry())
        .collect()
}

/// The bindings with the given schema paths (favorites, recents), in that
/// order; paths the loaded kernel does not have are left out.
#[tauri::command]
fn get_bindings(paths: Vec<String>, state: State<AppState>) -> Vec<Binding> {
    let catalog = state.catalog.read().unwrap();
    catalog.by_paths(&paths).into_iter().cloned().collect()
}

/// The binding documenting each compatible string, in that order (`None`
/// for an undocumented one).
#[tauri::command]
fn bindings_for_compatibles(
    compatibles: Vec<String>,
    state: State<AppState>,
) -> Vec<Option<Binding>> {
    let catalog = state.catalog.read().unwrap();
    compatibles
        .iter()
        .map(|c| catalog.find_compatible(c).cloned())
        .collect()
}

/// Constants of the loaded kernel tree whose name contains `query`
/// (case-insensitive), names that start with it first.
#[tauri::command]
fn search_dt_macros(query: String, limit: usize, state: State<AppState>) -> Vec<DtMacro> {
    let query = query.to_uppercase();
    let macros = state.macros.read().unwrap();
    let (mut prefix, mut inner) = (Vec::new(), Vec::new());
    let mut seen = std::collections::HashSet::new();
    for m in macros.iter() {
        let starts = m.name.starts_with(&query);
        if !(starts || m.name.contains(&query)) {
            continue;
        }
        // Several headers can define the same name; the first one counts.
        if !seen.insert(m.name.as_str()) {
            continue;
        }
        if starts {
            prefix.push(m);
        } else {
            inner.push(m);
        }
        if prefix.len() >= limit {
            break;
        }
    }
    prefix.extend(inner);
    prefix.into_iter().take(limit).cloned().collect()
}

/// The values of constants by exact name; `None` for an unknown name.
#[tauri::command]
fn resolve_dt_macros(names: Vec<String>, state: State<AppState>) -> Vec<Option<u32>> {
    let macros = state.macros.read().unwrap();
    names
        .iter()
        .map(|name| macros.iter().find(|m| &m.name == name).map(|m| m.value))
        .collect()
}

#[derive(Serialize)]
struct StartupArgs {
    /// Design file given on the command line (`designtree-app board.json`).
    design: Option<Graph>,
    /// Its path.
    design_path: Option<PathBuf>,
    /// Kernel tree to index at startup, from `DESIGNTREE_LINUX_SRC`.
    linux_src: Option<PathBuf>,
}

#[tauri::command]
fn startup_args() -> Result<StartupArgs, String> {
    let design_path = std::env::args_os().nth(1).map(PathBuf::from);
    let design = match &design_path {
        Some(path) => Some(open_design(path.clone())?),
        None => None,
    };
    Ok(StartupArgs {
        design,
        design_path,
        linux_src: std::env::var_os("DESIGNTREE_LINUX_SRC").map(PathBuf::from),
    })
}

/// How this copy was installed, so that an update notice can say how to
/// update: the package manager owns `/usr`, an AppImage is replaced by hand.
#[tauri::command]
fn install_kind() -> &'static str {
    if std::env::var_os("APPIMAGE").is_some() {
        return "appimage";
    }
    let in_usr = std::env::current_exe().is_ok_and(|exe| exe.starts_with("/usr"));
    if in_usr && Path::new("/var/lib/pacman/local").is_dir() {
        "pacman"
    } else if in_usr && Path::new("/var/lib/dpkg/status").is_file() {
        "deb"
    } else {
        "other"
    }
}

#[tauri::command]
fn validate_design(design: Graph) -> Vec<String> {
    designtree_core::validate(&design)
        .iter()
        .map(ToString::to_string)
        .collect()
}

/// Checks every node against its binding schemas, like `make dtbs_check`.
/// Empty until a kernel tree is loaded, and for a design that cannot be
/// compiled (the DTS preview shows why). Runs off the UI thread.
#[tauri::command(async)]
fn check_schemas(design: Graph, state: State<AppState>) -> Result<Option<Vec<Problem>>, String> {
    let Some(checker) = state.checker.read().unwrap().clone() else {
        return Ok(None);
    };
    // A design with structural errors has no blob; the DTS preview shows why.
    let Ok(dtb) = designtree_core::to_dtb(&design) else {
        return Ok(None);
    };
    let problems = checker.check_dtb(&dtb.blob).map_err(|e| e.to_string())?;
    Ok(Some(
        problems
            .into_iter()
            .map(|p| Problem {
                severity: Severity::Error,
                message: format!("{p}"),
                line: None,
                node: dtb.node_at(&p.node).cloned(),
            })
            .collect(),
    ))
}

/// Which controller each device interrupts, and what is missing.
#[tauri::command]
fn interrupt_tree(design: Graph) -> InterruptTree {
    designtree_core::interrupt_tree(&design)
}

/// What claims each connector pin of the board view, and the pins claimed
/// twice.
#[tauri::command]
fn pin_check(design: Graph) -> PinCheck {
    designtree_core::pin_check(&design)
}

/// Which controller drives which peripheral, for the board view.
#[tauri::command]
fn board_links(design: Graph) -> Vec<BoardLink> {
    designtree_core::board_links(&design)
}

/// The regions of every bus with their CPU addresses, overlaps and
/// unreachable regions.
#[tauri::command]
fn address_map(design: Graph) -> AddressMap {
    designtree_core::address_map(&design)
}

/// Arranges nodes and bus groups; the caller keeps its own copy for undo.
#[tauri::command]
fn auto_layout(mut design: Graph) -> Graph {
    designtree_core::auto_layout(&mut design);
    design
}

/// Lines of the source that define or change a node.
#[derive(Serialize)]
struct Span {
    node: String,
    first_line: u32,
    last_line: u32,
}

fn spans(spans: impl IntoIterator<Item = designtree_core::NodeSpan>) -> Vec<Span> {
    spans
        .into_iter()
        .map(|s| Span {
            node: s.node.0,
            first_line: s.first_line,
            last_line: s.last_line,
        })
        .collect()
}

#[derive(Serialize)]
struct MappedSource {
    dts: String,
    spans: Vec<Span>,
}

/// The design as DTS, with the lines of each node for the editor.
#[tauri::command]
fn export_dts_mapped(design: Graph) -> Result<MappedSource, Vec<String>> {
    let (dts, map) = designtree_core::to_dts_mapped(&design)
        .map_err(|errors| errors.iter().map(ToString::to_string).collect::<Vec<_>>())?;
    Ok(MappedSource {
        dts,
        spans: spans(map.spans),
    })
}

#[derive(Serialize)]
struct EditedDesign {
    design: Graph,
    spans: Vec<Span>,
}

/// Where the edited source fails to import.
#[derive(Serialize)]
struct SourceError {
    /// The included file the error is in; `None` for the edited text.
    file: Option<String>,
    line: u32,
    column: u32,
    message: String,
}

/// The design the edited source `text` of `design` describes. Runs off the
/// UI thread, since includes are read again.
#[tauri::command(async)]
fn apply_source(
    text: String,
    design: Graph,
    state: State<AppState>,
) -> Result<EditedDesign, SourceError> {
    let kernel = state.linux_src.read().unwrap().clone();
    match designtree_core::apply_source(&text, &design, kernel.as_deref()) {
        Ok((design, map)) => Ok(EditedDesign {
            design,
            spans: spans(map),
        }),
        Err(e) => Err(SourceError {
            file: (!e.file.is_empty()).then_some(e.file),
            line: e.line,
            column: e.column,
            message: e.message,
        }),
    }
}

/// The whole tree; for an overlay, its base with the overlay applied.
#[tauri::command]
fn export_dts_flat(design: Graph) -> Result<String, Vec<String>> {
    designtree_core::to_dts_flat(&design)
        .map_err(|errors| errors.iter().map(ToString::to_string).collect())
}

/// A new overlay for the design file (.json) or devicetree source at
/// `base`.
#[tauri::command(async)]
fn new_overlay(base: PathBuf, state: State<AppState>) -> Result<Graph, String> {
    let fallback = state.linux_src.read().unwrap().clone();
    let options = ImportOptions::detect_or(&base, fallback.as_deref());
    designtree_core::new_overlay(&base, &options).map_err(|e| e.to_string())
}

/// The board view's background image (US-14.1) as a `data:` URL. A
/// relative path is relative to the design file. Only images are read: the
/// path comes from the design file, which may come from someone else.
#[tauri::command(async)]
fn read_board_image(path: PathBuf, design_path: Option<PathBuf>) -> Result<String, String> {
    let mime = match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => {
            return Err(format!(
                "{} is not a PNG, JPEG, WebP, GIF or SVG image",
                path.display()
            ))
        }
    };
    let path = match design_path.as_deref().and_then(Path::parent) {
        Some(dir) if path.is_relative() => dir.join(&path),
        _ => path,
    };
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(format!("data:{mime};base64,{}", base64(&bytes)))
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
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

/// SoC `.dtsi` files of the loaded kernel tree, for starting a board.
#[tauri::command(async)]
fn list_socs(state: State<AppState>) -> Result<Vec<designtree_core::SocDtsi>, String> {
    let linux = loaded_kernel_tree(&state)?;
    Ok(designtree_core::list_soc_dtsi(&linux))
}

/// An empty board that includes the SoC `.dtsi` `soc` of the loaded kernel
/// tree.
#[tauri::command(async)]
fn new_board(soc: String, state: State<AppState>) -> Result<Graph, String> {
    let linux = loaded_kernel_tree(&state)?;
    designtree_core::new_board(&linux, &soc).map_err(|e| e.to_string())
}

fn loaded_kernel_tree(state: &AppState) -> Result<PathBuf, String> {
    state
        .linux_src
        .read()
        .unwrap()
        .clone()
        .ok_or_else(|| "Load a kernel source tree first".to_string())
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
fn set_dtc_path(path: Option<PathBuf>, state: State<AppState>) -> Result<(), String> {
    // The path comes from the settings file too, so check it names a program
    // file; it is still run without a shell, with the source on stdin.
    if let Some(p) = &path {
        if !p.is_absolute() || !p.is_file() {
            return Err(format!("`{}` is not a program file", p.display()));
        }
    }
    *state.dtc_path.write().unwrap() = path;
    Ok(())
}

/// The dtc to run: the path set in the app, else `DESIGNTREE_DTC`, else
/// `None` for `dtc` from `PATH`.
fn dtc_program(state: &AppState) -> Option<PathBuf> {
    state.dtc_path.read().unwrap().clone().or_else(|| {
        std::env::var_os("DESIGNTREE_DTC")
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
    })
}

/// The version of the dtc builds use, or `None` when it cannot be run.
#[tauri::command(async)]
fn dtc_version(state: State<AppState>) -> Option<String> {
    designtree_core::dtc::dtc_version(dtc_program(&state).as_deref()).ok()
}

/// Compiles the whole tree (includes flattened, so no preprocessor is
/// needed) to a `.dtb` at `output`, or an overlay to a `.dtbo`. A failed build is not an `Err`: dtc's
/// errors come back as problems so the UI can show them on the nodes.
/// Runs off the UI thread.
#[tauri::command(async)]
fn build_dtb(
    design: Graph,
    output: PathBuf,
    state: State<AppState>,
) -> Result<BuildResult, String> {
    let joined = |errors: Vec<designtree_core::ValidationError>| {
        errors
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    };
    let (dts, map) = if design.overlay.is_some() {
        // Lines of the overlay are not mapped to nodes; dtc's messages
        // still show in the build log.
        let dts = designtree_core::to_dts(&design).map_err(joined)?;
        (dts, designtree_core::SourceMap::default())
    } else {
        designtree_core::to_dts_flat_mapped(&design).map_err(joined)?
    };
    let dtc = dtc_program(&state);
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
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            startup_args,
            install_kind,
            load_kernel_bindings,
            list_kernels,
            add_kernel,
            remove_kernel,
            search_bindings,
            library_entries,
            dtc_version,
            read_settings,
            write_settings,
            get_bindings,
            bindings_for_compatibles,
            search_dt_macros,
            resolve_dt_macros,
            validate_design,
            export_dts_flat,
            export_dts_mapped,
            apply_source,
            new_overlay,
            check_schemas,
            interrupt_tree,
            pin_check,
            board_links,
            address_map,
            auto_layout,
            save_design,
            open_design,
            read_board_image,
            import_dts,
            list_socs,
            new_board,
            write_text,
            set_dtc_path,
            build_dtb,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DesignTree");
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64_matches_rfc_4648() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(super::base64(input.as_bytes()), expected);
        }
    }
}
