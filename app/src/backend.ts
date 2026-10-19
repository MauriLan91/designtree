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
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),
};

const DESIGN_FILTER = [{ name: "DesignTree design", extensions: ["json"] }];

export const dialogs = {
  pickKernelTree: () =>
    open({ directory: true, title: "Select a Linux kernel source tree" }) as Promise<string | null>,
  pickDesignToOpen: () => open({ filters: DESIGN_FILTER }) as Promise<string | null>,
  pickDesignToSave: () => save({ filters: DESIGN_FILTER, defaultPath: "design.json" }),
  pickDtsToSave: () =>
    save({ filters: [{ name: "Devicetree source", extensions: ["dts"] }], defaultPath: "board.dts" }),
};
