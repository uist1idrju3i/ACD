import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import { electricalLintRuleIds } from "./electrical-lint.js";
import {
  buildTestPlan,
  generateTestItems,
  testPlanRuleIds,
  unresolvedTestPlanFindings,
  type TestItem,
} from "./test-items.js";

const goldenPath = fileURLToPath(
  new URL("../../../fixtures/phase1/golden-esp32.json", import.meta.url),
);
const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Phase1Fixture;

const gateMatrixPath = fileURLToPath(new URL("../../../schemas/gate-matrix.json", import.meta.url));
const gateIds = (
  JSON.parse(await readFile(gateMatrixPath, "utf8")) as { gates: { id: string }[] }
).gates.map((gate) => gate.id);

const clone = (fixture: Phase1Fixture): Phase1Fixture =>
  JSON.parse(JSON.stringify(fixture)) as Phase1Fixture;

const plan = (fixture: Phase1Fixture): ReturnType<typeof buildTestPlan> =>
  buildTestPlan(fixture, electricalLintRuleIds, gateIds);

const item = (items: TestItem[], id: string): TestItem => {
  const found = items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no generated test item ${id}`);
  return found;
};

describe("test item generation", () => {
  it("passes the golden fixture with every rule evaluated", () => {
    const report = plan(golden);
    expect(unresolvedTestPlanFindings(report)).toEqual([]);
    expect(report.verdict).toBe("pass");
    expect([...new Set(report.findings.map((finding) => finding.ruleId))].sort()).toEqual(
      [...testPlanRuleIds].sort(),
    );
  });

  it("produces the same plan for the same input", () => {
    expect(JSON.stringify(generateTestItems(golden, electricalLintRuleIds))).toBe(
      JSON.stringify(generateTestItems(clone(golden), electricalLintRuleIds)),
    );
  });

  it("gives every item a method, conditions, an acceptance criterion and a deciding gate", () => {
    for (const generated of generateTestItems(golden, electricalLintRuleIds)) {
      expect(generated.id).toMatch(/^test:/);
      expect(generated.conditions.length).toBeGreaterThan(0);
      expect(generated.expected.length).toBeGreaterThan(0);
      expect(generated.verifiedBy).toMatch(/^gate:/);
      expect(generated.sources.length).toBeGreaterThan(0);
    }
  });

  it("derives the LED current band from the same topology trace as the lint", () => {
    const led = item(generateTestItems(golden, electricalLintRuleIds), "test:led-current-d1");
    expect(led.method).toBe("measurement");
    expect(led.expected).toContain("mA rating");
    expect(led.sources).toContain("rule:led-series-current");
  });

  it("routes measurement items to the physical completion gate", () => {
    const items = generateTestItems(golden, electricalLintRuleIds);
    expect(item(items, "test:supply-current-budget").verifiedBy).toBe("gate:physical-completion");
    expect(item(items, "test:net-voltage-3v3").expected).toBe("3.135-3.465 V");
    expect(item(items, `test:lint-i2c-pullup`).verifiedBy).toBe("gate:electrical-lint");
  });

  it("generates the test item a rationale assumption names", () => {
    const items = generateTestItems(golden, electricalLintRuleIds);
    expect(item(items, "test:i2c-rise-time").sources).toContain("rationale:i2c-sensor");
    expect(item(items, "test:status-led-visibility").conditions).toContain("tuning permitted");
  });

  it("blocks instead of certifying an acceptance criterion with no declared verification", () => {
    const undeclared = clone(golden);
    delete undeclared.requirement.acceptanceVerifiedBy;
    const report = plan(undeclared);
    expect(report.verdict).toBe("blocked");
    expect(
      report.findings.filter(
        (finding) =>
          finding.ruleId === "test-item-requirement-coverage" && finding.status === "unknown",
      ),
    ).toHaveLength(golden.requirement.acceptanceCriteria.length);
    expect(
      generateTestItems(undeclared, electricalLintRuleIds).some((generated) =>
        generated.id.startsWith("test:acceptance-"),
      ),
    ).toBe(false);
  });

  it("fails when the declared verification is neither a gate nor a generated item", () => {
    const dangling = clone(golden);
    dangling.requirement.acceptanceVerifiedBy = [
      "test:never-generated",
      "gate:component-selection",
      "gate:routing",
    ];
    const failing = plan(dangling).findings.filter((finding) => finding.status === "fail");
    expect(failing.map((finding) => finding.ruleId)).toEqual(["test-item-requirement-coverage"]);
  });

  it("blocks when a generated item has no resolvable acceptance band", () => {
    const undeclared = clone(golden);
    undeclared.parts = undeclared.parts.map((part) =>
      part.id === "part:d1" ? { ...part, parameters: { source: "injected" } } : part,
    ) as Phase1Fixture["parts"];
    const report = plan(undeclared);
    expect(report.verdict).toBe("blocked");
    expect(
      report.findings.filter(
        (finding) => finding.status === "unknown" && finding.entity === "test:led-current-d1",
      ),
    ).toHaveLength(1);
  });

  it("blocks when a confirmed assumption records no evidence", () => {
    const unsupported = clone(golden);
    const rationale = unsupported.rationales?.find(
      (candidate) => candidate.id === "rationale:board-and-supply",
    );
    if (!rationale) throw new Error("fixture has no rationale:board-and-supply");
    rationale.assumptions = [{ statement: "load fits the supply", status: "confirmed" }];
    const report = plan(unsupported);
    expect(report.verdict).toBe("blocked");
    expect(
      report.findings.filter(
        (finding) =>
          finding.ruleId === "test-item-assumption-coverage" && finding.status === "unknown",
      ),
    ).toHaveLength(1);
  });

  it("blocks when an open assumption names no test item", () => {
    const unnamed = clone(golden);
    const rationale = unnamed.rationales?.find(
      (candidate) => candidate.id === "rationale:i2c-sensor",
    );
    if (!rationale) throw new Error("fixture has no rationale:i2c-sensor");
    rationale.assumptions = [{ statement: "rise time", status: "unconfirmed" }];
    const report = plan(unnamed);
    expect(report.verdict).toBe("blocked");
    expect(
      report.findings.filter(
        (finding) =>
          finding.ruleId === "test-item-assumption-coverage" && finding.status === "unknown",
      ),
    ).toHaveLength(1);
  });

  it("keeps a fallback test item id stable when an earlier assumption is confirmed", () => {
    const withFallbacks = clone(golden);
    const rationale = withFallbacks.rationales?.find(
      (candidate) => candidate.id === "rationale:i2c-sensor",
    );
    if (!rationale) throw new Error("fixture has no rationale:i2c-sensor");
    rationale.assumptions = [
      { statement: "first", status: "unconfirmed" },
      { statement: "second", status: "unconfirmed" },
    ];
    const before = generateTestItems(withFallbacks, electricalLintRuleIds).map((entry) => entry.id);
    rationale.assumptions = [
      { statement: "first", status: "confirmed", evidenceLink: "gate:electrical-lint" },
      { statement: "second", status: "unconfirmed" },
    ];
    const after = generateTestItems(withFallbacks, electricalLintRuleIds).map((entry) => entry.id);
    expect(before).toContain("test:i2c-sensor-2");
    expect(after).toContain("test:i2c-sensor-2");
  });
});
