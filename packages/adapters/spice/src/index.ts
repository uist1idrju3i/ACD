import type { Phase1Fixture } from "@acd/schema";
import {
  aggregateVerdict,
  ledBranchCurrents,
  sortFindings,
  type RuleFinding,
  type RuleVerdict,
} from "@acd/graph-core";

/**
 * Nominal SPICE analyses derived from the typed fixture. Phase 2 stays at the ideal and
 * linear end of the fidelity ladder: no vendor models, no high-fidelity SI or thermal work.
 */
export type SpiceModel = {
  name: string;
  kind: "ideal" | "linear" | "vendor";
  source: string;
  license: string;
};

export type SpiceAnalysis = {
  id: string;
  title: string;
  subject: string;
  deck: string;
  /** Name printed by the deck's control block, and the band the result must fall in. */
  measurement: { name: string; unit: string; min: number; max: number };
  models: SpiceModel[];
  /** Conditions the analysis assumes rather than derives, recorded as uncertainty. */
  assumptions: string[];
  testItemId?: string;
};

export type SpiceMeasurement = { name: string; value: number };

export type SpiceRun = {
  analysisId: string;
  stdout: string;
  exitCode: number;
};

export type SpiceReport = {
  verdict: RuleVerdict;
  rulesEvaluated: string[];
  findings: RuleFinding[];
};

const i2cBusCapacitancePf = 100;
/** Standard-mode I2C allows 1000 ns from 0.3 Vdd to 0.7 Vdd. */
const i2cRiseTimeLimitNs = 1000;

const resistanceOf = (fixture: Phase1Fixture, partId: string): number | undefined =>
  fixture.parts.find((part) => part.id === partId)?.parameters?.resistanceOhm;

const idealModels = (source: string): SpiceModel[] => [
  {
    name: "ideal-sources-and-linear-passives",
    kind: "ideal",
    source,
    license: "not applicable: no third-party model file is used",
  },
];

const ledBranchDeck = (driveVoltageV: number, seriesOhm: number, forwardVoltageV: number): string =>
  [
    "* ACD LED branch operating point",
    `vdrive drive 0 dc ${driveVoltageV}`,
    `rseries drive anode ${seriesOhm}`,
    `vled anode 0 dc ${forwardVoltageV}`,
    ".control",
    "op",
    "print i(vled)",
    "quit",
    ".endc",
    ".end",
    "",
  ].join("\n");

const i2cRiseDeck = (pullupOhm: number, busCapacitancePf: number, railV: number): string =>
  [
    "* ACD I2C pull-up rise time",
    `vdd vdd 0 dc ${railV}`,
    `rpullup vdd sda ${pullupOhm}`,
    `cbus sda 0 ${busCapacitancePf}p`,
    ".ic v(sda)=0",
    ".control",
    "tran 1n 5u uic",
    `meas tran trise trig v(sda) val=${(railV * 0.3).toFixed(4)} rise=1 targ v(sda) val=${(
      railV * 0.7
    ).toFixed(4)} rise=1`,
    "quit",
    ".endc",
    ".end",
    "",
  ].join("\n");

/** Derives the nominal analyses. Returns an empty list when the fixture declares nothing to solve. */
export const buildSpiceAnalyses = (fixture: Phase1Fixture): SpiceAnalysis[] => {
  const analyses: SpiceAnalysis[] = [];
  const source = `fixture ${fixture.fixtureId}: declared part parameters and net voltages`;

  for (const branch of ledBranchCurrents(fixture)) {
    if (
      branch.driveVoltageV === undefined ||
      branch.currentMa === undefined ||
      branch.minMa === undefined ||
      branch.maxMa === undefined
    ) {
      continue;
    }
    const seriesOhm = branch.seriesResistorRefs
      .map((reference) => fixture.parts.find((part) => part.reference === reference))
      .map((part) => part?.parameters?.resistanceOhm)
      .filter((value): value is number => value !== undefined)
      .reduce((total, value) => total + value, 0);
    const forwardVoltageV =
      fixture.parts.find((part) => part.id === branch.partId)?.parameters?.forwardVoltageV ?? 0;
    analyses.push({
      id: `spice:led-branch-${branch.reference.toLowerCase()}`,
      title: `${branch.reference} branch operating point`,
      subject: branch.partId,
      deck: ledBranchDeck(branch.driveVoltageV, seriesOhm, forwardVoltageV),
      measurement: {
        name: "i(vled)",
        unit: "A",
        min: branch.minMa / 1000,
        max: branch.maxMa / 1000,
      },
      models: idealModels(source),
      assumptions: [
        "the LED is modelled as an ideal forward voltage source, not a diode model",
        "no temperature or tolerance spread is applied",
      ],
      testItemId: `test:led-current-${branch.reference.toLowerCase()}`,
    });
  }

  const i2cNets = fixture.nets.filter((net) => net.role === "i2c");
  const rail = fixture.nets.find(
    (net) => net.class === "power" && net.nominalVoltageV !== undefined,
  );
  for (const net of i2cNets) {
    const pullup = net.pins
      .map((pin) => resistanceOf(fixture, pin.partId))
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];
    if (pullup === undefined || rail?.nominalVoltageV === undefined) continue;
    analyses.push({
      id: `spice:i2c-rise-${net.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      title: `${net.name} pull-up rise time`,
      subject: net.id,
      deck: i2cRiseDeck(pullup, i2cBusCapacitancePf, rail.nominalVoltageV),
      measurement: { name: "trise", unit: "s", min: 0, max: i2cRiseTimeLimitNs / 1e9 },
      models: idealModels(source),
      assumptions: [
        `bus capacitance is assumed to be ${i2cBusCapacitancePf} pF; the assembled board is not measured here`,
        "open-drain drivers are modelled as an ideal release at t=0",
      ],
      testItemId: "test:i2c-rise-time",
    });
  }
  return analyses;
};

const numberPattern = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i;

/** Reads a printed operating point or a `meas` result out of ngspice batch output. */
export const parseMeasurement = (stdout: string, name: string): number | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^${escaped}\\s*=\\s*${numberPattern.source}`, "im"),
    new RegExp(`^\\s*\\d+\\s+${escaped}\\s+${numberPattern.source}`, "im"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(stdout);
    const value = match?.[1];
    if (value !== undefined) return Number(value);
  }
  return undefined;
};

const convergenceFailed = (stdout: string): boolean =>
  /doAnalyses: (TRAN|DC)|no convergence|singular matrix|iteration limit reached/i.test(stdout);

export const spiceRuleIds: readonly string[] = [
  "spice-convergence",
  "spice-margin",
  "spice-model-provenance",
];

/**
 * Three-valued evaluation of the runs. A missing measurement or a non-converged run is
 * unknown, never a pass, so an unusable simulation widens verification instead of closing it.
 */
export const evaluateSpiceRuns = (
  analyses: readonly SpiceAnalysis[],
  runs: readonly SpiceRun[],
): SpiceReport => {
  const findings: RuleFinding[] = [];
  for (const analysis of analyses) {
    const run = runs.find((candidate) => candidate.analysisId === analysis.id);
    const basis = `ngspice batch run of ${analysis.id}`;
    if (run === undefined || run.exitCode !== 0 || convergenceFailed(run.stdout)) {
      findings.push({
        ruleId: "spice-convergence",
        status: "unknown",
        entity: analysis.id,
        expected: "the analysis converges and exits cleanly",
        observed:
          run === undefined ? "no run recorded" : `exit ${run.exitCode}, no converged result`,
        basis,
      });
      continue;
    }
    findings.push({
      ruleId: "spice-convergence",
      status: "pass",
      entity: analysis.id,
      expected: "the analysis converges and exits cleanly",
      observed: "converged",
      basis,
    });
    const value = parseMeasurement(run.stdout, analysis.measurement.name);
    const { min, max, unit, name } = analysis.measurement;
    findings.push(
      value === undefined
        ? {
            ruleId: "spice-margin",
            status: "unknown",
            entity: analysis.id,
            expected: `${name} within ${min}-${max} ${unit}`,
            observed: `${name} was not reported by the engine`,
            basis,
          }
        : {
            ruleId: "spice-margin",
            status: value >= min && value <= max ? "pass" : "fail",
            entity: analysis.id,
            expected: `${name} within ${min}-${max} ${unit}`,
            observed: `${value} ${unit}`,
            basis,
          },
    );
    const vendor = analysis.models.filter((model) => model.kind === "vendor");
    findings.push({
      ruleId: "spice-model-provenance",
      status: vendor.length === 0 ? "pass" : "unknown",
      entity: analysis.id,
      expected: "every model has a recorded source and a license permitting this use",
      observed:
        vendor.length === 0
          ? analysis.models.map((model) => `${model.name} (${model.kind})`).join(", ")
          : `vendor models are user-supplied inputs and are not evidence: ${vendor
              .map((model) => model.name)
              .join(", ")}`,
      basis,
    });
  }
  const sorted = sortFindings(findings);
  return { verdict: aggregateVerdict(sorted), rulesEvaluated: [...spiceRuleIds], findings: sorted };
};

/** Margin of a measurement against its band, reported as Evidence rather than a verdict. */
export const measurementMargin = (
  analysis: SpiceAnalysis,
  value: number,
): { toMin: number; toMax: number } => ({
  toMin: value - analysis.measurement.min,
  toMax: analysis.measurement.max - value,
});
