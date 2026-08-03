import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  applyFixturePatch,
  evaluateFixtureGates,
  inadmissibleReason,
  sha256,
  unresolvedFindings,
  type FixturePatchOperation,
} from "../packages/graph-core/src/index.js";
import type { ACDPhase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";

/**
 * Regenerates the recorded repair proposals used by the offline repair loop.
 * Candidate proposals are authored here; the prompt hash and the response hash are
 * derived from the deterministic gate findings so a hand-edited recording is refused.
 */

const root = resolve(import.meta.dirname, "..");
const gateIds = (
  JSON.parse(await readFile(join(root, "schemas/gate-matrix.json"), "utf8")) as {
    gates: { id: string }[];
  }
).gates.map((gate) => gate.id);
const golden = JSON.parse(
  await readFile(join(root, "fixtures/phase1/golden-esp32.json"), "utf8"),
) as ACDPhase1Fixture;

const partIndex = (id: string): number => {
  const index = golden.parts.findIndex((part) => part.id === id);
  if (index < 0) throw new Error(`no part ${id}`);
  return index;
};

const parameter = (id: string, name: string): string =>
  `/parts/${partIndex(id)}/parameters/${name}`;

type Candidate = {
  proposalId: string;
  targets: string[];
  rationale: string;
  operations: FixturePatchOperation[];
};

type Case = {
  caseId: string;
  description: string;
  injection: FixturePatchOperation[];
  expectedRuleIds: string[];
  candidates: Candidate[];
};

const cases: Case[] = [
  {
    caseId: "case:led-overcurrent",
    description: "Series resistor lowered to 47 ohm, driving the status LED past its rating",
    injection: [{ op: "replace", path: parameter("part:r3", "resistanceOhm"), value: 47 }],
    expectedRuleIds: ["led-series-current"],
    candidates: [
      {
        proposalId: "proposal:led-drop-forward-voltage",
        targets: ["part:d1"],
        rationale: "Claim a higher LED forward voltage so the computed current falls",
        operations: [{ op: "replace", path: parameter("part:d1", "forwardVoltageV"), value: 3.2 }],
      },
      {
        proposalId: "proposal:led-restore-series-resistance",
        targets: ["part:r3"],
        rationale: "Return the series resistor to 330 ohm, inside the 1-20 mA window",
        operations: [{ op: "replace", path: parameter("part:r3", "resistanceOhm"), value: 330 }],
      },
    ],
  },
  {
    caseId: "case:i2c-pullup-out-of-range",
    description: "I2C pull-ups raised to 100 kohm, too weak for the declared bus",
    injection: [
      { op: "replace", path: parameter("part:r8", "resistanceOhm"), value: 100000 },
      { op: "replace", path: parameter("part:r9", "resistanceOhm"), value: 100000 },
    ],
    expectedRuleIds: ["i2c-pullup"],
    candidates: [
      {
        proposalId: "proposal:i2c-restore-sda-pullup",
        targets: ["part:r8"],
        rationale: "Return the SDA pull-up to 4.7 kohm",
        operations: [{ op: "replace", path: parameter("part:r8", "resistanceOhm"), value: 4700 }],
      },
      {
        proposalId: "proposal:i2c-restore-scl-pullup",
        targets: ["part:r9"],
        rationale: "Return the SCL pull-up to 4.7 kohm",
        operations: [{ op: "replace", path: parameter("part:r9", "resistanceOhm"), value: 4700 }],
      },
    ],
  },
  {
    caseId: "case:capacitor-underrated",
    description: "Input bulk capacitor rated below the derating requirement of its rail",
    injection: [{ op: "replace", path: parameter("part:c4", "ratedVoltageV"), value: 6.3 }],
    expectedRuleIds: ["capacitor-voltage-derating"],
    candidates: [
      {
        proposalId: "proposal:capacitor-restore-rating",
        targets: ["part:c4"],
        rationale: "Select a 16 V part so the rating clears 1.5x the rail voltage",
        operations: [{ op: "replace", path: parameter("part:c4", "ratedVoltageV"), value: 16 }],
      },
    ],
  },
  {
    caseId: "case:usb-cc-termination",
    description: "USB-C CC pulldown changed to 10 kohm, breaking sink advertisement",
    injection: [{ op: "replace", path: parameter("part:r6", "resistanceOhm"), value: 10000 }],
    expectedRuleIds: ["usb-cc-termination"],
    candidates: [
      {
        proposalId: "proposal:usb-cc-restore-pulldown",
        targets: ["part:r6"],
        rationale: "Return CC1 to the 5.1 kohm sink pulldown",
        operations: [{ op: "replace", path: parameter("part:r6", "resistanceOhm"), value: 5100 }],
      },
    ],
  },
];

const promptHashOf = (fixture: ACDPhase1Fixture): string =>
  sha256(
    unresolvedFindings(evaluateFixtureGates(fixture, gateIds)).map((finding) => [
      finding.ruleId,
      finding.entity,
      finding.status,
    ]),
  );

const recordings: Record<string, unknown>[] = [];
const summary: Record<string, unknown>[] = [];

for (const entry of cases) {
  let fixture = applyFixturePatch(golden, entry.injection);
  const detected = unresolvedFindings(evaluateFixtureGates(fixture, gateIds));
  if (detected.length === 0) throw new Error(`${entry.caseId} injected no detectable defect`);
  const missing = entry.expectedRuleIds.filter(
    (ruleId) => !detected.some((finding) => finding.ruleId === ruleId),
  );
  if (missing.length > 0) throw new Error(`${entry.caseId} did not trigger ${missing.join(", ")}`);

  const remaining = [...entry.candidates];
  const recorded: string[] = [];
  while (remaining.length > 0) {
    const promptHash = promptHashOf(fixture);
    const before = unresolvedFindings(evaluateFixtureGates(fixture, gateIds)).length;
    let applied: Candidate | undefined;
    for (const candidate of remaining) {
      const after = unresolvedFindings(
        evaluateFixtureGates(applyFixturePatch(fixture, candidate.operations), gateIds),
      ).length;
      recordings.push({
        proposalId: candidate.proposalId,
        promptHash,
        origin: "recorded-llm",
        targets: candidate.targets,
        rationale: candidate.rationale,
        operations: candidate.operations,
        provenance: {
          source: "fixture-owned recorded proposal, authored offline without a live model call",
          responseHash: sha256({
            targets: candidate.targets,
            rationale: candidate.rationale,
            operations: candidate.operations,
          }),
        },
      });
      const admissible = inadmissibleReason(fixture, candidate.operations) === undefined;
      if (admissible && after < before && applied === undefined) applied = candidate;
    }
    if (!applied) break;
    fixture = applyFixturePatch(fixture, applied.operations);
    recorded.push(applied.proposalId);
    remaining.splice(remaining.indexOf(applied), 1);
  }
  const left = unresolvedFindings(evaluateFixtureGates(fixture, gateIds));
  if (left.length > 0) {
    throw new Error(`${entry.caseId} is not repairable by its candidates: ${left.length} left`);
  }
  summary.push({
    caseId: entry.caseId,
    description: entry.description,
    injection: entry.injection,
    expectedRuleIds: entry.expectedRuleIds,
    repairSequence: recorded,
  });
}

const outDir = join(root, "fixtures/phase2");
await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "repair-cases.json"),
  `${JSON.stringify({ schemaVersion: "phase2-repair-cases/1", cases: summary }, null, 2)}\n`,
);
await writeFile(
  join(outDir, "repair-recordings.json"),
  `${JSON.stringify(
    {
      schemaVersion: "phase2-repair-recordings/1",
      note: "Offline repair proposals replayed by the recorded proposer. Regenerate with pnpm phase2:record-repairs.",
      proposals: recordings,
    },
    null,
    2,
  )}\n`,
);
console.log(`recorded ${recordings.length} proposals for ${summary.length} cases`);
