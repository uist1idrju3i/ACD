import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import {
  buildSpiceAnalyses,
  evaluateSpiceRuns,
  measurementMargin,
  parseMeasurement,
  spiceRuleIds,
  type SpiceAnalysis,
  type SpicePlan,
} from "./index.js";

const goldenPath = fileURLToPath(
  new URL("../../../../fixtures/phase1/golden-esp32.json", import.meta.url),
);
const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Phase1Fixture;
const plan = buildSpiceAnalyses(golden);
const analyses = plan.analyses;
const engineVersion = "44.2";
const only = (entry: SpiceAnalysis): SpicePlan => ({ analyses: [entry], unresolved: [] });

const analysis = (id: string): SpiceAnalysis => {
  const found = analyses.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no analysis ${id}`);
  return found;
};

const opOutput = "No. of Data Rows : 1\ni(vled) = 3.93939e-03\nngspice-44.2 done\n";
const tranOutput =
  "No. of Data Rows : 5011\ntrise               =  3.982297e-07 targ=  5.658671e-07\nngspice-44.2 done\n";

describe("spice analyses", () => {
  it("derives the LED branch and I2C rise time analyses from the fixture", () => {
    expect(analyses.map((entry) => entry.id).sort()).toEqual([
      "spice:i2c-rise-i2c-scl",
      "spice:i2c-rise-i2c-sda",
      "spice:led-branch-d1",
    ]);
  });

  it("builds a deck that names the measurement it prints", () => {
    const led = analysis("spice:led-branch-d1");
    expect(led.deck).toContain("rseries drive anode 330");
    expect(led.deck).toContain("print i(vled)");
    expect(led.measurement).toEqual({ name: "i(vled)", unit: "A", min: 0.001, max: 0.02 });

    const bus = analysis("spice:i2c-rise-i2c-sda");
    expect(bus.deck).toContain("rpullup vdd sda 4700");
    expect(bus.deck).toContain("tran 1n 5u uic");
    expect(bus.measurement.max).toBe(1e-6);
  });

  it("records model provenance and the assumptions the analysis does not derive", () => {
    for (const entry of analyses) {
      expect(entry.models.every((model) => model.kind !== "vendor")).toBe(true);
      expect(entry.models.every((model) => model.license.length > 0)).toBe(true);
      expect(entry.assumptions.length).toBeGreaterThan(0);
    }
  });

  it("parses an operating point and a measure result", () => {
    expect(parseMeasurement(opOutput, "i(vled)")).toBeCloseTo(0.00393939, 8);
    expect(parseMeasurement(tranOutput, "trise")).toBeCloseTo(3.982297e-7, 12);
    expect(parseMeasurement(opOutput, "trise")).toBeUndefined();
  });

  it("passes when every analysis converges inside its band", () => {
    const report = evaluateSpiceRuns(
      plan,
      [
        { analysisId: "spice:led-branch-d1", stdout: opOutput, exitCode: 0 },
        { analysisId: "spice:i2c-rise-i2c-sda", stdout: tranOutput, exitCode: 0 },
        { analysisId: "spice:i2c-rise-i2c-scl", stdout: tranOutput, exitCode: 0 },
      ],
      engineVersion,
    );
    expect(report.verdict).toBe("pass");
    expect([...new Set(report.findings.map((finding) => finding.ruleId))].sort()).toEqual(
      // Derivation only reports the analyses a fixture does not support.
      [...spiceRuleIds].filter((ruleId) => ruleId !== "spice-analysis-derivation").sort(),
    );
  });

  it("fails when a measurement leaves its band", () => {
    const report = evaluateSpiceRuns(
      only(analysis("spice:led-branch-d1")),
      [
        {
          analysisId: "spice:led-branch-d1",
          stdout: "i(vled) = 2.75000e-02\nngspice-44.2 done\n",
          exitCode: 0,
        },
      ],
      engineVersion,
    );
    expect(report.verdict).toBe("fail");
    expect(report.findings.find((finding) => finding.ruleId === "spice-margin")?.status).toBe(
      "fail",
    );
  });

  it("blocks on a non-converged run, a missing run and a missing measurement", () => {
    expect(
      evaluateSpiceRuns(
        only(analysis("spice:led-branch-d1")),
        [
          {
            analysisId: "spice:led-branch-d1",
            stdout: "doAnalyses: TRAN: Timestep too small\n",
            exitCode: 1,
          },
        ],
        engineVersion,
      ).verdict,
    ).toBe("blocked");
    expect(
      evaluateSpiceRuns(only(analysis("spice:led-branch-d1")), [], engineVersion).verdict,
    ).toBe("blocked");
    expect(
      evaluateSpiceRuns(
        only(analysis("spice:led-branch-d1")),
        [{ analysisId: "spice:led-branch-d1", stdout: "ngspice-44.2 done\n", exitCode: 0 }],
        engineVersion,
      ).verdict,
    ).toBe("blocked");
  });

  it("treats a vendor model as unusable evidence", () => {
    const vendor: SpiceAnalysis = {
      ...analysis("spice:led-branch-d1"),
      models: [
        {
          name: "vendor.lib",
          kind: "vendor",
          source: "user-supplied",
          license: "not redistributable",
        },
      ],
    };
    const report = evaluateSpiceRuns(
      only(vendor),
      [{ analysisId: vendor.id, stdout: opOutput, exitCode: 0 }],
      engineVersion,
    );
    expect(report.verdict).toBe("blocked");
  });

  it("blocks when the engine does not report its version", () => {
    const runs = [{ analysisId: "spice:led-branch-d1", stdout: opOutput, exitCode: 0 }];
    const report = evaluateSpiceRuns(only(analysis("spice:led-branch-d1")), runs);
    expect(report.verdict).toBe("blocked");
    expect(
      report.findings.find((finding) => finding.ruleId === "spice-engine-version")?.status,
    ).toBe("unknown");
  });

  it("blocks when an analysis cannot be derived instead of skipping it", () => {
    const undeclared = JSON.parse(JSON.stringify(golden)) as Phase1Fixture;
    undeclared.nets = undeclared.nets.map((net) =>
      net.class === "power" ? { ...net, nominalVoltageV: undefined } : net,
    ) as Phase1Fixture["nets"];
    const derived = buildSpiceAnalyses(undeclared);
    expect(derived.unresolved.length).toBeGreaterThan(0);
    expect(derived.unresolved.every((finding) => finding.status === "unknown")).toBe(true);
    expect(evaluateSpiceRuns(derived, [], engineVersion).verdict).toBe("blocked");
  });

  it("takes the rail from the net the pull-up is tied to", () => {
    const bus = analysis("spice:i2c-rise-i2c-sda");
    expect(bus.deck).toContain("vdd vdd 0 dc 3.3");
    expect(bus.assumptions.some((entry) => entry.includes("3V3"))).toBe(true);
  });

  it("reports the margin to each side of the band", () => {
    expect(measurementMargin(analysis("spice:led-branch-d1"), 0.00393939)).toEqual({
      toMin: 0.00393939 - 0.001,
      toMax: 0.02 - 0.00393939,
    });
  });
});
