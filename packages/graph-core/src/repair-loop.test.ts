import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import { unresolvedFindings } from "./findings.js";
import {
  applyFixturePatch,
  evaluateFixtureGates,
  inadmissibleReason,
  recordedProposer,
  runRepairLoop,
  type FixturePatchOperation,
  type RecordedProposal,
} from "./repair-loop.js";

const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8")) as unknown;

const golden = (await read("../../../fixtures/phase1/golden-esp32.json")) as Phase1Fixture;
const cases = (await read("../../../fixtures/phase2/repair-cases.json")) as {
  cases: { caseId: string; injection: FixturePatchOperation[]; expectedRuleIds: string[] }[];
};
const recordings = (await read("../../../fixtures/phase2/repair-recordings.json")) as {
  proposals: RecordedProposal[];
};

const gateIds = (
  (await read("../../../schemas/gate-matrix.json")) as { gates: { id: string }[] }
).gates.map((gate) => gate.id);

const proposer = recordedProposer(recordings.proposals);
const partIndex = (id: string): number => golden.parts.findIndex((part) => part.id === id);

describe("repair loop", () => {
  it("leaves a passing fixture untouched", () => {
    const result = runRepairLoop({ fixture: golden, proposer, gateIds });
    expect(result.status).toBe("already-passing");
    expect(result.appliedProposalIds).toEqual([]);
  });

  it.each(cases.cases.map((entry) => [entry.caseId, entry] as const))(
    "detects and repairs %s",
    (_caseId, entry) => {
      const injected = applyFixturePatch(golden, entry.injection);
      const detected = unresolvedFindings(evaluateFixtureGates(injected, gateIds));
      for (const ruleId of entry.expectedRuleIds) {
        expect(detected.map((finding) => finding.ruleId)).toContain(ruleId);
      }
      const result = runRepairLoop({ fixture: injected, proposer, gateIds });
      expect(result.status).toBe("repaired");
      expect(unresolvedFindings(evaluateFixtureGates(result.fixture, gateIds))).toEqual([]);
    },
  );

  it("repairs the same way every time", () => {
    const entry = cases.cases[0];
    if (!entry) throw new Error("no repair cases");
    const injected = applyFixturePatch(golden, entry.injection);
    const first = runRepairLoop({ fixture: injected, proposer, gateIds });
    const second = runRepairLoop({ fixture: injected, proposer, gateIds });
    expect(first.appliedProposalIds).toEqual(second.appliedProposalIds);
    expect(JSON.stringify(first.fixture)).toBe(JSON.stringify(second.fixture));
  });

  it("refuses a proposal that rewrites a datasheet-sourced parameter", () => {
    const falsify: FixturePatchOperation[] = [
      {
        op: "replace",
        path: `/parts/${partIndex("part:d1")}/parameters/forwardVoltageV`,
        value: 3.2,
      },
    ];
    expect(inadmissibleReason(golden, falsify)).toContain("datasheet-sourced");

    const injected = applyFixturePatch(golden, [
      { op: "replace", path: `/parts/${partIndex("part:r3")}/parameters/resistanceOhm`, value: 47 },
    ]);
    const result = runRepairLoop({ fixture: injected, proposer, gateIds });
    const rejected = result.iterations
      .flatMap((iteration) => iteration.attempts)
      .filter((attempt) => !attempt.accepted);
    expect(rejected.map((attempt) => attempt.proposalId)).toContain(
      "proposal:led-drop-forward-voltage",
    );
    expect(result.appliedProposalIds).toEqual(["proposal:led-restore-series-resistance"]);
  });

  it("refuses a proposal that rewrites order-relevant sourcing state", () => {
    expect(
      inadmissibleReason(golden, [
        { op: "replace", path: "/bom/0/availability", value: "in-stock" },
      ]),
    ).toContain("order-relevant");
    expect(
      inadmissibleReason(golden, [
        { op: "replace", path: `/parts/0/provenance/contentHash`, value: "sha256:0" },
      ]),
    ).toContain("provenance");
  });

  it("refuses an ancestor rewrite that would carry a protected field with it", () => {
    const led = partIndex("part:d1");
    expect(inadmissibleReason(golden, [{ op: "replace", path: `/parts/${led}`, value: {} }])).toBe(
      `/parts/${led} rewrites part provenance`,
    );
    expect(
      inadmissibleReason(golden, [
        { op: "replace", path: `/parts/${led}/parameters`, value: { source: "injected" } },
      ]),
    ).toContain("datasheet-sourced");
    expect(inadmissibleReason(golden, [{ op: "remove", path: "/bom/0" }])).toContain(
      "order-relevant",
    );
  });

  it("records the findings the proposer was given, not the state after the repair", () => {
    const injected = applyFixturePatch(golden, [
      { op: "replace", path: `/parts/${partIndex("part:r3")}/parameters/resistanceOhm`, value: 47 },
    ]);
    const before = unresolvedFindings(evaluateFixtureGates(injected, gateIds));
    const result = runRepairLoop({ fixture: injected, proposer, gateIds });
    expect(result.status).toBe("repaired");
    const first = result.iterations[0];
    if (!first) throw new Error("the loop recorded no iteration");
    expect(first.unresolved).toEqual(before);
  });

  it("stops instead of guessing when no recorded proposal matches", () => {
    const injected = applyFixturePatch(golden, [
      { op: "remove", path: `/parts/${partIndex("part:r8")}/parameters/resistanceOhm` },
    ]);
    const result = runRepairLoop({ fixture: injected, proposer, gateIds });
    expect(result.status).toBe("not-repaired");
    expect(result.stopReason).toContain("no accepted repair");
  });

  it("refuses a recording whose response hash does not match its content", () => {
    const tampered = recordings.proposals.map((proposal, index) =>
      index === 0 ? { ...proposal, operations: [] } : proposal,
    );
    const injected = applyFixturePatch(golden, [
      { op: "replace", path: `/parts/${partIndex("part:r3")}/parameters/resistanceOhm`, value: 47 },
    ]);
    expect(() =>
      runRepairLoop({ fixture: injected, proposer: recordedProposer(tampered), gateIds }),
    ).toThrowError(/does not match its response hash/);
  });

  it("rejects a patch that does not apply", () => {
    expect(() =>
      applyFixturePatch(golden, [{ op: "replace", path: "/parts/999/parameters/x", value: 1 }]),
    ).toThrowError(/invalid array segment|path not found/);
  });
});
