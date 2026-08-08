import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "./event-log.js";
import { GraphCoreError } from "./errors.js";
import {
  TaskLedgerRuntime,
  transitionTask,
  type ClockPort,
  type IdPort,
  type TaskLedgerEntry,
} from "./task-ledger.js";

const clock: ClockPort = { now: () => "2026-01-01T00:00:00.000Z" };
const ids: IdPort = (() => {
  let sequence = 0;
  return { next: (prefix: string) => `${prefix}:task-ledger:${++sequence}` };
})();

const entry = (overrides: Partial<TaskLedgerEntry> = {}): TaskLedgerEntry => ({
  id: "task:main",
  purpose: "run the task",
  inputRevision: 1,
  dependencyIds: [],
  acceptanceCriteria: ["result is recorded"],
  attemptCount: 0,
  retryBudget: 1,
  budget: { scope: "execution", tokens: 100, amount: 5 },
  approvalState: "not-required",
  status: "pending",
  artifactIds: [],
  measurements: {
    attempts: 0,
    clockSeconds: 0,
    toolCalls: 0,
    tokens: "unknown",
    money: "unknown",
  },
  ...overrides,
});

describe("task ledger", () => {
  it("blocks running until dependencies and approval are ready", () => {
    const dependency = entry({ id: "task:dependency", status: "pending" });
    expect(() =>
      transitionTask(entry({ dependencyIds: [dependency.id] }), "running", [dependency]),
    ).toThrow(/cannot run/);
    expect(() => transitionTask(entry({ approvalState: "pending" }), "running", [])).toThrow(
      /cannot run/,
    );
  });

  it("rejects invalid transitions and requires stop reasons", () => {
    expect(() => transitionTask(entry({ status: "completed" }), "running", [])).toThrow(
      GraphCoreError,
    );
    expect(() => transitionTask(entry(), "blocked", [])).toThrow(/stop reason/);
  });

  it("retains token and money measurements as unknown", () => {
    const running = transitionTask(entry(), "running", []);
    expect(running.measurements).toEqual({
      attempts: 1,
      clockSeconds: 0,
      toolCalls: 0,
      tokens: "unknown",
      money: "unknown",
    });
    expect(() => transitionTask(running, "completed", [], { resultId: "result:1" })).not.toThrow();
  });

  it("reconstructs state from events and stops on held-state mismatch", async () => {
    const eventLog = new InMemoryEventLog();
    const runtime = new TaskLedgerRuntime("project:test", "test", eventLog, clock, ids);
    await runtime.create(entry());
    await runtime.transition("task:main", "running");
    const completed = await runtime.transition("task:main", "completed", {
      resultId: "result:1",
    });
    expect(completed.entries["task:main"]?.status).toBe("completed");

    const restarted = new TaskLedgerRuntime("project:test", "test", eventLog, clock, ids);
    expect((await restarted.load()).entries["task:main"]?.resultId).toBe("result:1");
    await expect(
      restarted.assertConsistent({
        revision: 3,
        entries: { "task:main": { ...completed.entries["task:main"]!, resultId: "result:stale" } },
      }),
    ).rejects.toThrow(/differs from event replay/);
  });
});
