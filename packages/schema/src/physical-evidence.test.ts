import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { evaluatePhysicalEvidence } from "./physical-evidence.js";
import { physicalEvidenceSamplePath } from "./paths.js";
import type { ACDPhase1PhysicalEvidence as PhysicalEvidence } from "./generated/physical-evidence.js";

describe("physical evidence contract", () => {
  it("validates the pending sample but refuses Gate 13", async () => {
    const sample = JSON.parse(await readFile(physicalEvidenceSamplePath, "utf8"));
    const verdict = await evaluatePhysicalEvidence(sample);
    expect(verdict.valid).toBe(true);
    expect(verdict.passed).toBe(false);
  });

  it("requires real, calibrated, passing evidence", async () => {
    const sample = JSON.parse(
      await readFile(physicalEvidenceSamplePath, "utf8"),
    ) as PhysicalEvidence;
    sample.status = "passed";
    sample.provenance.mode = "real";
    sample.assembly.status = "assembled";
    sample.instruments[0]!.calibrationStatus = "valid";
    sample.conditions = { ambient: "23 C", supply: "USB 5 V" };
    for (const test of sample.testItems) {
      test.observed = test.expected;
      test.pass = true;
    }
    const verdict = await evaluatePhysicalEvidence(sample);
    expect(verdict.passed).toBe(true);
  });
});
