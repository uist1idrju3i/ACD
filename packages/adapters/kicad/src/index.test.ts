import { describe, expect, it } from "vitest";
import { kicadAdapterPackageVersion } from "./index.js";

describe("@acd/adapter-kicad", () => {
  it("exposes the package version", () => {
    expect(kicadAdapterPackageVersion).toBe("0.1.0");
  });
});
