import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import {
  designRationaleRuleIds,
  evaluateDesignRationale,
  rationaleSubjects,
  unresolvedRationaleFindings,
} from "./design-rationale.js";
import { lintElectricalTopology } from "./electrical-lint.js";

const goldenPath = fileURLToPath(
  new URL("../../../fixtures/phase1/golden-esp32.json", import.meta.url),
);
const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Phase1Fixture;

const clone = (fixture: Phase1Fixture): Phase1Fixture =>
  JSON.parse(JSON.stringify(fixture)) as Phase1Fixture;

const rationalesOf = (fixture: Phase1Fixture): NonNullable<Phase1Fixture["rationales"]> => {
  const { rationales } = fixture;
  if (!rationales) throw new Error("fixture has no rationales");
  return rationales;
};

const findRationale = (
  fixture: Phase1Fixture,
  id: string,
): NonNullable<Phase1Fixture["rationales"]>[number] => {
  const rationale = rationalesOf(fixture).find((candidate) => candidate.id === id);
  if (!rationale) throw new Error(`fixture has no rationale ${id}`);
  return rationale;
};

const rulesOf = (fixture: Phase1Fixture, status: "fail" | "unknown"): string[] => [
  ...new Set(
    evaluateDesignRationale(fixture)
      .findings.filter((finding) => finding.status === status)
      .map((finding) => finding.ruleId),
  ),
];

describe("design rationale", () => {
  it("passes the golden fixture with every rule evaluated", () => {
    const report = evaluateDesignRationale(golden);
    expect(unresolvedRationaleFindings(report)).toEqual([]);
    expect(report.verdict).toBe("pass");
    expect([...new Set(report.findings.map((finding) => finding.ruleId))].sort()).toEqual(
      [...designRationaleRuleIds].sort(),
    );
  });

  it("is deterministic for the same input", () => {
    expect(JSON.stringify(evaluateDesignRationale(golden))).toBe(
      JSON.stringify(evaluateDesignRationale(clone(golden))),
    );
  });

  it("covers the requirement, every functional block and every part", () => {
    const subjects = rationaleSubjects(golden);
    expect(subjects).toContain(golden.requirement.id);
    expect(subjects).toContain("block:i2c-sensor");
    expect(subjects).toContain("part:u1");
    expect(
      evaluateDesignRationale(golden).coverage.every((entry) => entry.rationaleIds.length > 0),
    );
  });

  it("fails when a selected part has no rationale", () => {
    const uncovered = clone(golden);
    findRationale(uncovered, "rationale:status-led").appliesTo = ["block:status-led", "part:r3"];
    expect(rulesOf(uncovered, "fail")).toEqual(["rationale-coverage"]);
    expect(
      evaluateDesignRationale(uncovered).findings.find(
        (finding) => finding.status === "fail" && finding.entity === "part:d1",
      ),
    ).toBeDefined();
  });

  it("fails when a rationale applies to an unknown subject", () => {
    const dangling = clone(golden);
    findRationale(dangling, "rationale:status-led").appliesTo.push("part:does-not-exist");
    expect(rulesOf(dangling, "fail")).toEqual(["rationale-reference-integrity"]);
  });

  it("blocks when an unconfirmed assumption has no test item and no tuning flag", () => {
    const unplanned = clone(golden);
    const rationale = findRationale(unplanned, "rationale:status-led");
    rationale.tuningNeeded = false;
    rationale.assumptions = [{ statement: "brightness is sufficient", status: "unconfirmed" }];
    const report = evaluateDesignRationale(unplanned);
    expect(report.verdict).toBe("blocked");
    expect(rulesOf(unplanned, "unknown")).toEqual(["rationale-assumption-verifiable"]);
  });

  it("blocks when a confirmed assumption cites no evidence", () => {
    const uncited = clone(golden);
    findRationale(uncited, "rationale:usb-power-input").assumptions = [
      { statement: "Rd advertises the default sink current", status: "confirmed" },
    ];
    expect(evaluateDesignRationale(uncited).verdict).toBe("blocked");
  });

  it("rejects a rationale cited as its own evidence", () => {
    const circular = clone(golden);
    findRationale(circular, "rationale:esp32-compute").evidenceLinks = [
      "rationale:board-and-supply",
    ];
    expect(rulesOf(circular, "fail")).toEqual(["rationale-not-evidence"]);
  });

  it("rejects a rationale cited as evidence even when the id does not resolve", () => {
    const invented = clone(golden);
    findRationale(invented, "rationale:esp32-compute").evidenceLinks = ["rationale:invented"];
    expect(rulesOf(invented, "fail")).toEqual(["rationale-not-evidence"]);
  });

  it("does not let an LLM-proposed rationale change a deterministic gate result", () => {
    const proposed = clone(golden);
    rationalesOf(proposed).push({
      ...findRationale(proposed, "rationale:status-led"),
      id: "rationale:llm-proposed-led",
      origin: "llm-proposed",
      decision: "The 22 ohm resistor is fine because the LED is only briefly on.",
    });
    proposed.parts = proposed.parts.map((part) =>
      part.id === "part:r3"
        ? { ...part, parameters: { source: "injected", resistanceOhm: 22 } }
        : part,
    ) as Phase1Fixture["parts"];
    expect(lintElectricalTopology(proposed).verdict).toBe("fail");
    expect(evaluateDesignRationale(proposed).verdict).toBe("pass");
  });

  it("fails every subject when the fixture records no rationale", () => {
    const bare = clone(golden);
    delete bare.rationales;
    const report = evaluateDesignRationale(bare);
    expect(report.verdict).toBe("fail");
    expect(report.findings.every((finding) => finding.ruleId === "rationale-coverage")).toBe(true);
  });
});
