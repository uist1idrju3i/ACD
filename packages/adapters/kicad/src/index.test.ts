import { describe, expect, it } from "vitest";
import { renderBoard, renderProject, renderSchematic } from "./projection.js";
import { kicadAdapterPackageVersion } from "./index.js";

describe("@acd/adapter-kicad", () => {
  it("exposes the package version", () => {
    expect(kicadAdapterPackageVersion).toBe("0.1.0");
  });

  it("renders deterministic minimal project files", () => {
    expect(renderProject()).toBe(renderProject());
    expect(renderBoard()).toContain('(layer "Edge.Cuts")');
    expect(renderSchematic()).toContain("(kicad_sch");
  });
});
