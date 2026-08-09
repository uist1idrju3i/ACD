import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readBoardModel } from "./board.js";
import { rulesForFabProfile } from "./fab-profile-rules.js";
import {
  quantizeBoardGeometry,
  runGeometryChecks,
  type GeometryCheckInput,
} from "./geometry-checks.js";

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
    {
      id: "pad:c1:1",
      polygon: rectangle(0, 0, 1000, 1000),
      netId: "net:c1",
      layer: "F.Cu",
      maskExpansionNm: 0,
    },
    {
      id: "pad:c2:1",
      polygon: rectangle(2000, 0, 3000, 1000),
      netId: "net:c2",
      layer: "F.Cu",
      maskExpansionNm: 0,
    },
  ],
  courtyards: [
    { componentId: "c1", polygon: rectangle(0, 0, 1000, 1000), layer: "F.Cu" },
    { componentId: "c2", polygon: rectangle(2000, 0, 3000, 1000), layer: "F.Cu" },
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

  it("only checks copper pads on the same layer with different nets", () => {
    const checks = runGeometryChecks(
      input({
        pads: [
          {
            id: "pad:shared:1",
            polygon: rectangle(0, 0, 1000, 1000),
            netId: "net:shared",
            layer: "F.Cu",
          },
          {
            id: "pad:shared:2",
            polygon: rectangle(100, 0, 1100, 1000),
            netId: "net:shared",
            layer: "F.Cu",
          },
          {
            id: "pad:other-layer:1",
            polygon: rectangle(100, 0, 1100, 1000),
            netId: "net:other",
            layer: "B.Cu",
          },
        ],
        thresholds: { minimumCopperClearanceNm: 1000 },
      }),
    );
    expect(checks.padClearance).toMatchObject({ status: "passed", findings: [] });
  });

  it("keeps unresolved pad connectivity as unknown", () => {
    const checks = runGeometryChecks(
      input({
        pads: [
          { id: "pad:unknown:1", polygon: rectangle(0, 0, 1000, 1000) },
          {
            id: "pad:known:1",
            polygon: rectangle(100, 0, 1100, 1000),
            netId: "net:known",
            layer: "F.Cu",
          },
        ],
        thresholds: { minimumCopperClearanceNm: 1000 },
      }),
    );
    expect(checks.padClearance).toMatchObject({
      status: "unknown",
      reason: "pad-connectivity-not-provided",
    });
  });

  it("distinguishes fused mask openings from a thin remaining sliver", () => {
    const fused = runGeometryChecks(
      input({
        pads: [
          { ...input().pads[0]!, maskExpansionNm: 600 },
          { ...input().pads[1]!, maskExpansionNm: 600 },
        ],
        thresholds: { minimumMaskSliverNm: 1 },
      }),
    );
    expect(fused.maskSliver.findings[0]?.ruleId).toBe("mask-fusion");
    const sliver = runGeometryChecks(
      input({
        pads: [
          { ...input().pads[0]!, maskExpansionNm: 495 },
          { ...input().pads[1]!, maskExpansionNm: 495 },
        ],
        thresholds: { minimumMaskSliverNm: 11 },
      }),
    );
    expect(sliver.maskSliver.findings[0]?.ruleId).toBe("mask-sliver");
  });

  it("only checks courtyards on the same implementation layer", () => {
    const checks = runGeometryChecks(
      input({
        courtyards: [
          { componentId: "c1", polygon: rectangle(0, 0, 1000, 1000), layer: "F.Cu" },
          { componentId: "c2", polygon: rectangle(900, 0, 1900, 1000), layer: "B.Cu" },
        ],
        thresholds: { minimumCourtyardClearanceNm: 1 },
      }),
    );
    expect(checks.courtyardOverlap).toMatchObject({ status: "passed", findings: [] });
  });

  it("runs copper clearance on the existing golden design graph with typed profile thresholds", async () => {
    const graph = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../../../fixtures/design-graphs/normal-2layer.json"),
        "utf8",
      ),
    );
    const model = readBoardModel(graph);
    const profile = rulesForFabProfile("fab:jlcpcb-class-2layer");
    const checks = runGeometryChecks(quantizeBoardGeometry(model, profile));
    expect(["passed", "failed"]).toContain(checks.padClearance.status);
    expect(checks.padClearance.status).not.toBe("unknown");
    expect(checks.maskSliver.status).toBe("unknown");
    expect(checks.courtyardOverlap.status).toBe("unknown");
  });
});
