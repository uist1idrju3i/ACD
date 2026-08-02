import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FixtureFabFeedbackReader, referenceIndexFromPhase1Fixture } from "./index.js";

describe("fixture fab feedback adapter", () => {
  it("reads the recorded report through the schema contract", async () => {
    const reader = new FixtureFabFeedbackReader(
      new URL("../../../../fixtures/phase3/fab-report-prototype-1.json", import.meta.url).pathname,
    );
    const report = await reader.read();
    expect(report.source.kind).toBe("fixture");
    expect(report.source.fixtureDerived).toBe(true);
    expect(report.rawFindings).toHaveLength(3);
  });

  it("builds a reference index from the Phase 1 golden fixture", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../../../../fixtures/phase1/golden-esp32.json", import.meta.url),
        "utf8",
      ),
    ) as {
      fixtureId: string;
      requirement: { provenance: { version: string } };
      parts: { id: string }[];
      mappings: { partId: string; footprintLibraryId: string; footprintName: string }[];
      nets: { id?: string; name?: string }[];
    };
    const index = referenceIndexFromPhase1Fixture(fixture);
    expect(index.entityIds.has("part:r1")).toBe(true);
    expect(index.entityIds.has("footprint:Resistor_SMD:R_0603_1608Metric")).toBe(true);
    expect(index.entityIds.has("net:3v3")).toBe(true);
  });

  it("unifies genuine duplicate findings with different wording", async () => {
    const reader = new FixtureFabFeedbackReader(
      new URL("../../../../fixtures/phase3/fab-report-unification.json", import.meta.url).pathname,
    );
    const report = await reader.read();
    const index = referenceIndexFromPhase1Fixture(
      JSON.parse(
        await readFile(
          new URL("../../../../fixtures/phase1/golden-esp32.json", import.meta.url),
          "utf8",
        ),
      ) as {
        fixtureId: string;
        requirement: { provenance: { version: string } };
        parts: { id: string }[];
        mappings: { partId: string; footprintLibraryId: string; footprintName: string }[];
        nets: { id?: string; name?: string }[];
      },
    );
    const result = (await import("@acd/graph-core")).intakeFabFeedback(report, index);
    expect(result.evidence.value.countBefore).toBe(2);
    expect(result.evidence.value.countAfter).toBe(1);
    expect(result.findings[0]?.duplicateFindingIds).toEqual(["UNIFY-2"]);
  });
});
