// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { AddressMap, Binding, Design, DtMacro, InterruptTree, Problem, SocDtsi } from "./model";

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

export interface StartupArgs {
  design: Design | null;
  linux_src: string | null;
}

export const backend = {
  startupArgs: () => invoke<StartupArgs>("startup_args"),
  loadKernelBindings: (linuxSrc: string) =>
    invoke<CatalogSummary>("load_kernel_bindings", { linuxSrc }),
  listKernels: () => invoke<KernelInfo[]>("list_kernels"),
  addKernel: (path: string) => invoke<KernelInfo>("add_kernel", { path }),
  removeKernel: (path: string) => invoke<KernelInfo[]>("remove_kernel", { path }),
  searchBindings: (query: string, category: string | null, limit = 200) =>
    invoke<Binding[]>("search_bindings", { query, category, limit }),
  getBindings: (paths: string[]) => invoke<Binding[]>("get_bindings", { paths }),
  bindingsForCompatibles: (compatibles: string[]) =>
    invoke<(Binding | null)[]>("bindings_for_compatibles", { compatibles }),
  searchDtMacros: (query: string, limit = 12) => invoke<DtMacro[]>("search_dt_macros", { query, limit }),
  resolveDtMacros: (names: string[]) => invoke<(number | null)[]>("resolve_dt_macros", { names }),
  interruptTree: (design: Design) => invoke<InterruptTree>("interrupt_tree", { design }),
  addressMap: (design: Design) => invoke<AddressMap>("address_map", { design }),
  validateDesign: (design: Design) => invoke<string[]>("validate_design", { design }),
  checkSchemas: (design: Design) => invoke<Problem[] | null>("check_schemas", { design }),
  autoLayout: (design: Design) => invoke<Design>("auto_layout", { design }),
  exportDts: (design: Design) => invoke<string>("export_dts", { design }),
  saveDesign: (path: string, design: Design) => invoke<void>("save_design", { path, design }),
  openDesign: (path: string) => invoke<Design>("open_design", { path }),
  importDts: (path: string) => invoke<Design>("import_dts", { path }),
  listSocs: () => invoke<SocDtsi[]>("list_socs"),
  newBoard: (soc: string) => invoke<Design>("new_board", { soc }),
  setDtcPath: (path: string | null) => invoke<void>("set_dtc_path", { path }),
  buildDtb: (design: Design, output: string) => invoke<BuildResult>("build_dtb", { design, output }),
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),
};

const DESIGN_FILTER = [{ name: "DesignTree design", extensions: ["json"] }];
const DTB_FILTER = [{ name: "Device tree blob", extensions: ["dtb"] }];
const DTS_FILTER = [{ name: "Devicetree source", extensions: ["dts", "dtsi"] }];

export const dialogs = {
  pickKernelTree: () =>
    open({ directory: true, title: "Select a Linux kernel source tree" }) as Promise<string | null>,
  pickDesignToOpen: () => open({ filters: DESIGN_FILTER }) as Promise<string | null>,
  pickDesignToSave: () => save({ filters: DESIGN_FILTER, defaultPath: "design.json" }),
  pickDtsToOpen: () => open({ filters: DTS_FILTER }) as Promise<string | null>,
  pickDtbToSave: () => save({ filters: DTB_FILTER, defaultPath: "board.dtb" }),
  pickDtc: () => open({ title: "Select the dtc program" }) as Promise<string | null>,
  pickDtsToSave: () => save({ filters: DTS_FILTER, defaultPath: "board.dts" }),
};
