import { describe, expect, it } from "vitest";
import { runGeometryChecks, type GeometryCheckInput } from "./geometry-checks.js";

const rectangle = (left: number, top: number, right: number, bottom: number) => ({
  points: [
    { xNm: left, yNm: top },
    { xNm: right, yNm: top },
    { xNm: right, yNm: bottom },
    { xNm: left, yNm: bottom },
  ],
});

const input = (overrides: Partial<GeometryCheckInput> = {}): GeometryCheckInput => ({
  pads: [
    { id: "pad:c1:1", polygon: rectangle(0, 0, 1000, 1000), maskExpansionNm: 0 },
    { id: "pad:c2:1", polygon: rectangle(2000, 0, 3000, 1000), maskExpansionNm: 0 },
  ],
  courtyards: [
    { componentId: "c1", polygon: rectangle(0, 0, 1000, 1000) },
    { componentId: "c2", polygon: rectangle(2000, 0, 3000, 1000) },
  ],
  thresholds: {
    minimumCopperClearanceNm: 1000,
    minimumMaskSliverNm: 1000,
    minimumCourtyardClearanceNm: 1000,
  },
  ...overrides,
});

describe("integer geometry checks", () => {
  it("does not report an exact threshold as a violation", () => {
    const checks = runGeometryChecks(input());
    expect(checks.padClearance.status).toBe("passed");
    expect(checks.maskSliver.status).toBe("passed");
    expect(checks.courtyardOverlap.status).toBe("passed");
  });

  it("reports a one-nanometre threshold breach", () => {
    const checks = runGeometryChecks(
      input({
        thresholds: {
          minimumCopperClearanceNm: 1001,
          minimumMaskSliverNm: 1001,
          minimumCourtyardClearanceNm: 1001,
        },
      }),
    );
    expect(checks.padClearance.status).toBe("failed");
    expect(checks.maskSliver.status).toBe("failed");
    expect(checks.courtyardOverlap.status).toBe("failed");
    expect(checks.padClearance.findings[0]?.measuredNm).toBe(1000);
  });

  it("returns unknown when canonical geometry or thresholds are absent", () => {
    const checks = runGeometryChecks(
      input({
        pads: [{ id: "pad:c1:1", polygon: rectangle(0, 0, 1000, 1000) }],
        courtyards: [],
        thresholds: {},
      }),
    );
    expect(checks.padClearance).toMatchObject({
      status: "unknown",
      reason: "canonical-data-not-provided",
    });
    expect(checks.maskSliver.status).toBe("unknown");
    expect(checks.courtyardOverlap.status).toBe("unknown");
  });
});
