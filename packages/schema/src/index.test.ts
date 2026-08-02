import { describe, expect, it } from "vitest";
import { schemaPackageVersion } from "./index.js";

describe("@acd/schema", () => {
  it("exposes the package version", () => {
    expect(schemaPackageVersion).toBe("0.1.0");
  });
});
