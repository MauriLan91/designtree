import { describe, expect, it } from "vitest";
import { aboutText, BUILD } from "./buildInfo";

describe("the About text", () => {
  it("names the build, the kernel and dtc", () => {
    const text = aboutText({ path: "/linux", version: "7.2.0" }, "1.7.0");
    expect(text).toContain(`DesignTree ${BUILD.version}`);
    expect(text).toContain("Kernel: Linux 7.2.0");
    expect(text).toContain("dtc: 1.7.0");
    expect(BUILD.built).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("says what is missing", () => {
    const text = aboutText(null, null);
    expect(text).toContain("Kernel: none loaded");
    expect(text).toContain("dtc: not found");
  });
});
