// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Span } from "./components/DtsEditor";
import type { AddressMap, Binding, BoardLink, Design, DtMacro, InterruptTree, LibraryEntry, PinCheck, Problem, Property, SocDtsi } from "./model";

export interface CatalogSummary {
  bindings: number;
  compatibles: number;
  categories: string[];
  skipped: number;
  path: string;
  /** From the kernel's Makefile; null when it has none. */
  version: string | null;
  /** The index came from the cache. */
  cached: boolean;
}

export interface KernelInfo {
  path: string;
  version: string | null;
}

export interface BuildResult {
  /** The .dtb, when the build succeeded. */
  output: string | null;
  log: string;
  problems: Problem[];
}

export const inTauri = isTauri();

export interface MappedSource {
  dts: string;
  spans: Span[];
}

export interface EditedDesign {
  design: Design;
  spans: Span[];
}

export interface StartupArgs {
  design: Design | null;
  design_path: string | null;
  linux_src: string | null;
}

export const backend = {
  startupArgs: () => invoke<StartupArgs>("startup_args"),
  installKind: () => invoke<"pacman" | "deb" | "appimage" | "other">("install_kind"),
  loadKernelBindings: (linuxSrc: string) =>
    invoke<CatalogSummary>("load_kernel_bindings", { linuxSrc }),
  listKernels: () => invoke<KernelInfo[]>("list_kernels"),
  addKernel: (path: string) => invoke<KernelInfo>("add_kernel", { path }),
  removeKernel: (path: string) => invoke<KernelInfo[]>("remove_kernel", { path }),
  searchBindings: (query: string, category: string | null, limit = 200) =>
    invoke<Binding[]>("search_bindings", { query, category, limit }),
  /** One entry per compatible; all of them without a limit (US-18.1). */
  libraryEntries: (query: string, category: string | null, limit?: number) =>
    invoke<LibraryEntry[]>("library_entries", { query, category, limit: limit ?? null }),
  /** The basic devicetree nodes, without a kernel (US-18.3). */
  basicBindings: () => invoke<Binding[]>("basic_bindings"),
  getBindings: (paths: string[]) => invoke<Binding[]>("get_bindings", { paths }),
  bindingsForCompatibles: (compatibles: string[]) =>
    invoke<(Binding | null)[]>("bindings_for_compatibles", { compatibles }),
  searchDtMacros: (query: string, limit = 12) => invoke<DtMacro[]>("search_dt_macros", { query, limit }),
  resolveDtMacros: (names: string[]) => invoke<(number | null)[]>("resolve_dt_macros", { names }),
  interruptTree: (design: Design) => invoke<InterruptTree>("interrupt_tree", { design }),
  pinCheck: (design: Design) => invoke<PinCheck>("pin_check", { design }),
  boardLinks: (design: Design) => invoke<BoardLink[]>("board_links", { design }),
  addressMap: (design: Design) => invoke<AddressMap>("address_map", { design }),
  validateDesign: (design: Design) => invoke<string[]>("validate_design", { design }),
  checkSchemas: (design: Design) => invoke<Problem[] | null>("check_schemas", { design }),
  autoLayout: (design: Design) => invoke<Design>("auto_layout", { design }),
  exportDtsFlat: (design: Design) => invoke<string>("export_dts_flat", { design }),
  parseProperties: (text: string) => invoke<Property[]>("parse_properties", { text }),
  exportDtsMapped: (design: Design) => invoke<MappedSource>("export_dts_mapped", { design }),
  /** Rejects with a `SourceError` when the text does not import. */
  applySource: (text: string, design: Design) => invoke<EditedDesign>("apply_source", { text, design }),
  newOverlay: (base: string) => invoke<Design>("new_overlay", { base }),
  readBoardImage: (path: string, designPath: string | null) =>
    invoke<string>("read_board_image", { path, designPath }),
  saveDesign: (path: string, design: Design) => invoke<void>("save_design", { path, design }),
  openDesign: (path: string) => invoke<Design>("open_design", { path }),
  importDts: (path: string) => invoke<Design>("import_dts", { path }),
  listSocs: () => invoke<SocDtsi[]>("list_socs"),
  newBoard: (soc: string) => invoke<Design>("new_board", { soc }),
  setDtcPath: (path: string | null) => invoke<void>("set_dtc_path", { path }),
  /** The stored settings, or null; validated by `parseSettings`. */
  readSettings: () => invoke<unknown>("read_settings"),
  writeSettings: (settings: object) => invoke<void>("write_settings", { settings }),
  /** The version of the dtc builds use; null when it cannot be run. */
  dtcVersion: () => invoke<string | null>("dtc_version"),
  buildDtb: (design: Design, output: string) => invoke<BuildResult>("build_dtb", { design, output }),
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),
};

const DESIGN_FILTER = [{ name: "DesignTree design", extensions: ["json"] }];
const DTB_FILTER = [{ name: "Device tree blob", extensions: ["dtb"] }];
const DTS_FILTER = [{ name: "Devicetree source", extensions: ["dts", "dtsi"] }];
const DTSO_FILTER = [{ name: "Devicetree overlay source", extensions: ["dtso"] }];
const DTBO_FILTER = [{ name: "Devicetree overlay blob", extensions: ["dtbo"] }];
const BASE_FILTER = [{ name: "Design or devicetree source", extensions: ["json", "dts"] }];

type Filter = { name: string; extensions: string[] };

// The folder of the last file picked, where the next dialog starts (US-15.9).
let lastFolder: string | null = null;
const folderOf = (path: string) => path.replace(/[/\\][^/\\]*$/, "") || "/";
function remember<T extends string | null>(path: T): T {
  if (path) lastFolder = folderOf(path);
  return path;
}
/** Where a dialog starts: the file `near` names, else `name` in the last folder used. */
const startAt = (name: string, near?: string | null) => near ?? (lastFolder ? `${lastFolder}/${name}` : name);

/** A save dialog whose path gets the filter's first extension when it has
 * none of them: the backend writes only the kinds of file the app makes. */
async function saveAs(filters: Filter[], name: string, near?: string | null): Promise<string | null> {
  const path = remember(await save({ filters, defaultPath: startAt(name, near) }));
  if (!path) return null;
  const extensions = filters.flatMap((f) => f.extensions);
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext && extensions.includes(ext) ? path : `${path}.${extensions[0]}`;
}

async function openFile(options: Parameters<typeof open>[0]): Promise<string | null> {
  return remember((await open({ defaultPath: lastFolder ?? undefined, ...options })) as string | null);
}

export const dialogs = {
  pickKernelTree: () =>
    open({ directory: true, title: "Select a Linux kernel source tree" }) as Promise<string | null>,
  pickDesignToOpen: () => openFile({ filters: DESIGN_FILTER }),
  /** `current`: the design's file, which the dialog starts at. */
  pickDesignToSave: (current?: string | null) => saveAs(DESIGN_FILTER, "design.json", current),
  pickDtsToOpen: () => openFile({ filters: DTS_FILTER }),
  pickDtbToSave: () => saveAs(DTB_FILTER, "board.dtb"),
  pickDtc: () => open({ title: "Select the dtc program" }) as Promise<string | null>,
  pickDtsToSave: () => saveAs(DTS_FILTER, "board.dts"),
  pickOverlayBase: () => openFile({ filters: BASE_FILTER, title: "Select the base the overlay applies to" }),
  pickDtsoToSave: () => saveAs(DTSO_FILTER, "overlay.dtso"),
  pickDtboToSave: () => saveAs(DTBO_FILTER, "overlay.dtbo"),
  pickBoardImage: () =>
    open({
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
      title: "Select a board photo or schematic",
    }) as Promise<string | null>,
};
