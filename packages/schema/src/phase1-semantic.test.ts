import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { ACDPhase1Fixture as Phase1Fixture } from "./generated/phase1-fixture.js";
import { validatePhase1FixtureReferences } from "./phase1-semantic.js";

describe("Phase 1 fixture semantic validation", () => {
  it("reports unresolved net pin references", () => {
    const fixture = {
      parts: [{ id: "part:r1" }],
      mappings: [{ partId: "part:r1", pinPads: [{ pin: "1" }] }],
      placementConstraints: { components: [{ partId: "part:r1" }] },
      bom: [{ partId: "part:r1" }],
      nets: [{ id: "net:test", pins: [{ partId: "part:missing", pin: "1" }] }],
    } as unknown as Phase1Fixture;

    expect(validatePhase1FixtureReferences(fixture)).toContain(
      "reference-integrity: net net:test references unknown part part:missing",
    );
  });

  it("accepts the golden fixture reference graph", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../../../fixtures/phase1/golden-esp32.json", import.meta.url),
        "utf8",
      ),
    ) as Phase1Fixture;
    expect(validatePhase1FixtureReferences(fixture)).toEqual([]);
  });
});
