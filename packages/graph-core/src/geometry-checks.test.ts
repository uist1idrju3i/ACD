import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readBoardModel, type BoardModel } from "./board.js";
import { GraphCoreError } from "./errors.js";
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

  it("canonicalizes finding subjects before building stable ids", () => {
    const checks = runGeometryChecks(
      input({
        pads: [
          {
            id: "pad:z:1",
            polygon: rectangle(0, 0, 1000, 1000),
            netId: "net:z",
            layer: "F.Cu",
          },
          {
            id: "pad:a:1",
            polygon: rectangle(100, 0, 1100, 1000),
            netId: "net:a",
            layer: "F.Cu",
          },
        ],
        courtyards: [],
        thresholds: { minimumCopperClearanceNm: 1001 },
      }),
    );
    expect(checks.padClearance.findings[0]).toMatchObject({
      id: "finding:pad-clearance:pad:a:1:pad:z:1",
      subjectIds: ["pad:a:1", "pad:z:1"],
    });
  });

  it("keeps integer distance parity at the largest accepted coordinate scale", () => {
    const coordinate = 1_000_000_000_000_000;
    const checks = runGeometryChecks({
      pads: [
        {
          id: "pad:left",
          polygon: rectangle(0, 0, 1, 1),
          netId: "net:left",
          layer: "F.Cu",
        },
        {
          id: "pad:right",
          polygon: rectangle(coordinate, 0, coordinate + 1, 1),
          netId: "net:right",
          layer: "F.Cu",
        },
      ],
      courtyards: [],
      thresholds: { minimumCopperClearanceNm: coordinate + 1 },
    });
    expect(checks.padClearance.findings[0]?.measuredNm).toBe(coordinate - 1);
  });

  it("rotates non-square rect pads before quantization", () => {
    const model: BoardModel = {
      projectId: "project:test",
      outline: { originMm: { xMm: 0, yMm: 0 }, widthMm: 10, heightMm: 10 },
      stackup: { id: "stackup:test", layerCount: 2, thicknessMm: 1, copperLayers: ["F.Cu"] },
      components: [
        {
          id: "component:test",
          role: "device",
          reference: "U1",
          value: "test",
          partId: undefined,
          footprintId: "footprint:test",
          symbol: { libraryId: "lib", name: "test" },
          schematic: { xMm: 0, yMm: 0, rotationDeg: 0 },
          pins: [],
        },
      ],
      footprints: new Map([
        [
          "footprint:test",
          {
            id: "footprint:test",
            libraryId: "lib",
            name: "test",
            pads: [{ number: "1", xMm: 0, yMm: 0, widthMm: 2, heightMm: 1 }],
          },
        ],
      ]),
      pins: new Map(),
      nets: [],
      placements: [
        { componentId: "component:test", xMm: 0, yMm: 0, rotationDeg: 90, layer: "F.Cu" },
      ],
      tracks: [],
      vias: [],
    };
    const polygon = quantizeBoardGeometry(model).pads[0]?.polygon.points;
    expect(polygon).toEqual([
      { xNm: -500000, yNm: 1000000 },
      { xNm: -500000, yNm: -1000000 },
      { xNm: 500000, yNm: -1000000 },
      { xNm: 500000, yNm: 1000000 },
    ]);
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

  it.each([
    [
      "unknown pad shape",
      (attributes: Record<string, unknown>) => {
        attributes.pads = [
          { number: "1", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, shape: { kind: "ellipse" } },
        ];
      },
    ],
    [
      "polygon without points",
      (attributes: Record<string, unknown>) => {
        attributes.pads = [
          { number: "1", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, shape: { kind: "polygon" } },
        ];
      },
    ],
    [
      "courtyard without points",
      (attributes: Record<string, unknown>) => {
        attributes.courtyard = { kind: "polygon" };
      },
    ],
  ])("rejects malformed canonical geometry: %s", async (_name, mutate) => {
    const graph = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../../../fixtures/design-graphs/normal-2layer.json"),
        "utf8",
      ),
    ) as { entities: Array<{ type: string; attributes?: Record<string, unknown> }> };
    const footprint = graph.entities.find((entity) => entity.type === "Footprint");
    expect(footprint?.attributes).toBeDefined();
    mutate(footprint!.attributes!);
    try {
      readBoardModel(graph as never);
      throw new Error("expected malformed geometry to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(GraphCoreError);
      expect((error as GraphCoreError).code).toBe("schema-invalid");
    }
  });
});
