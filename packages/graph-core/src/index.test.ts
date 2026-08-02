import { describe, expect, it } from "vitest";
import { graphCorePackageVersion } from "./index.js";

describe("@acd/graph-core", () => {
  it("exposes the package version", () => {
    expect(graphCorePackageVersion).toBe("0.1.0");
  });
});
