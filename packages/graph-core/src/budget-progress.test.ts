import { describe, expect, it } from "vitest";
import {
  checkBudget,
  createBudgetUsageSnapshot,
  elapsedSecondsBetween,
  type MonotonicClockPort,
} from "./budget.js";
import { detectNoProgress, type ProgressObservation } from "./progress.js";
import { buildStopRecord, validateStopRecord } from "./stop-record.js";

describe("budget and watchdog core contracts", () => {
  it("uses an injected monotonic clock deterministically", () => {
    let current = 10;
    const clock: MonotonicClockPort = { now: () => current };
    const start = clock.now();
    current = 12;
    expect(elapsedSecondsBetween(start, clock.now())).toBe(2);
    expect(
      checkBudget(
        { scope: "execution", timeSeconds: 2 },
        createBudgetUsageSnapshot({
          scope: "task",
          elapsedSeconds: 0,
        }),
        { elapsedSeconds: 2 },
      ).status,
    ).toBe("would-exceed");
  });

  it("keeps run and task caps independent", () => {
    const usage = createBudgetUsageSnapshot({ scope: "task", externalProcessExecutions: 0 });
    expect(
      checkBudget({ scope: "execution", toolCalls: 3 }, usage, {
        externalProcessExecutions: 1,
      }).status,
    ).toBe("allowed");
    expect(
      checkBudget({ scope: "execution", toolCalls: 1 }, usage, {
        externalProcessExecutions: 1,
      }).status,
    ).toBe("would-exceed");
  });

  it("retains token and money as explicit unknown values", () => {
    const usage = createBudgetUsageSnapshot({ scope: "run" });
    expect(usage.tokens).toEqual({ status: "unknown" });
    expect(usage.money).toEqual({ status: "unknown" });
  });

  const observation = (overrides: Partial<ProgressObservation> = {}): ProgressObservation => ({
    inputHash: "input:a",
    proposalHash: "proposal:a",
    artifactHash: "artifact:a",
    gateResultHash: "gate:a",
    unresolvedFindingCount: 2,
    gateStatus: "failed",
    stateHash: "state:a",
    ...overrides,
  });

  it.each([
    ["same input and proposal", [{}, {}], "repeated-proposal"],
    [
      "unchanged artifact",
      [{ proposalHash: "proposal:a" }, { proposalHash: "proposal:b" }],
      "unchanged-artifact",
    ],
    [
      "unchanged gate result",
      [
        {
          artifactHash: "artifact:a",
          proposalHash: "proposal:a",
          inputHash: "input:a",
          stateHash: "state:a",
        },
        {
          artifactHash: "artifact:b",
          proposalHash: "proposal:b",
          inputHash: "input:b",
          stateHash: "state:b",
        },
      ],
      "unchanged-gate",
    ],
    [
      "state oscillation",
      [{ stateHash: "state:a" }, { stateHash: "state:b" }, { stateHash: "state:a" }],
      "oscillation",
    ],
  ])("detects %s", (_name, changes, expected) => {
    const observations = (changes as Array<Partial<ProgressObservation>>).map(observation);
    expect(
      detectNoProgress(observations, {
        repeatedProposal: 2,
        unchangedArtifact: 2,
        unchangedGate: 2,
        oscillation: 2,
      }),
    ).toContain(expected);
  });

  it("rejects a stop record without required decision context", () => {
    const valid = {
      reasonCode: "budget-exceeded" as const,
      knownFacts: ["task cap reached"],
      uncertainties: ["next operation cost is not executed"],
      options: [{ id: "resume", description: "resume after cap increase" }],
      recommendation: "increase the approved cap",
      resumeCondition: "an approved cap is present",
      resumePosition: { eventPosition: 4 },
      budgetSnapshot: {
        run: createBudgetUsageSnapshot({ scope: "run" }),
        task: createBudgetUsageSnapshot({ scope: "task" }),
      },
      evidenceIds: ["evidence:budget"],
    };
    expect(buildStopRecord(valid)).toEqual(valid);
    expect(() => validateStopRecord({ ...valid, evidenceIds: [] })).toThrow("missing");
  });
});
