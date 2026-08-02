import { describe, expect, it } from "vitest";
import { GraphCoreError } from "./errors.js";
import { assertFreshResult } from "./verification.js";

describe("verification freshness", () => {
  it("rejects a result from an older revision", () => {
    expect(() => assertFreshResult(2, 1)).toThrowError(GraphCoreError);
    try {
      assertFreshResult(2, 1);
    } catch (error) {
      expect(error).toMatchObject({ code: "stale-result" });
    }
  });
});
