// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Binding, Design } from "./model";

export interface CatalogSummary {
  bindings: number;
  compatibles: number;
  categories: string[];
  skipped: number;
}

export interface BuildResult {
  output: string;
  warnings: string;
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
  searchBindings: (query: string, category: string | null, limit = 200) =>
    invoke<Binding[]>("search_bindings", { query, category, limit }),
  validateDesign: (design: Design) => invoke<string[]>("validate_design", { design }),
  autoLayout: (design: Design) => invoke<Design>("auto_layout", { design }),
  exportDts: (design: Design) => invoke<string>("export_dts", { design }),
  saveDesign: (path: string, design: Design) => invoke<void>("save_design", { path, design }),
  openDesign: (path: string) => invoke<Design>("open_design", { path }),
  importDts: (path: string) => invoke<Design>("import_dts", { path }),
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
