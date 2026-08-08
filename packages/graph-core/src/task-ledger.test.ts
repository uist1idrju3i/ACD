import { describe, expect, it } from "vitest";
import { InMemoryEventLog } from "./event-log.js";
import { GraphCoreError } from "./errors.js";
import {
  TaskLedgerRuntime,
  listTaskLedgerAttention,
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
  type: "TaskLedgerEntry",
  revision: 1,
  purpose: "run the task",
  inputRevision: 1,
  dependencyIds: [],
  acceptanceCriteria: ["result is recorded"],
  attemptCount: 0,
  retryBudget: 1,
  budget: { scope: "execution", tokens: 100, amount: 5 },
  approvalState: "not-required",
  status: "pending",
  checkpointIds: [],
  artifactIds: [],
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

  it("uses the schema attemptCount as the attempt measurement", () => {
    const running = transitionTask(entry(), "running", []);
    expect(running.attemptCount).toBe(1);
    expect(running.revision).toBe(2);
    expect(() => transitionTask(running, "completed", [], { resultId: "result:1" })).not.toThrow();
  });

  it("lists blocked, failed, and approval-pending entries in ID order", () => {
    const listed = listTaskLedgerAttention([
      entry({ id: "task:z", status: "failed", stopReason: "tool failed" }),
      entry({ id: "task:m", approvalState: "pending" }),
      entry({ id: "task:a", status: "blocked", stopReason: "waiting for dependency" }),
      entry({ id: "task:ok", status: "pending" }),
    ]);

    expect(listed.map((item) => item.taskId)).toEqual(["task:a", "task:m", "task:z"]);
    expect(listed).toMatchObject([
      {
        taskId: "task:a",
        status: "blocked",
        stopReason: "waiting for dependency",
        waitingReason: null,
      },
      {
        taskId: "task:m",
        status: "pending",
        stopReason: null,
        waitingReason: "approval-pending",
      },
      {
        taskId: "task:z",
        status: "failed",
        stopReason: "tool failed",
        waitingReason: null,
      },
    ]);
  });

  it("restores unfinished dependent entries after a runtime restart", async () => {
    const eventLog = new InMemoryEventLog();
    const runtime = new TaskLedgerRuntime("project:test", "test", eventLog, clock, ids);
    await runtime.create(entry({ id: "task:dependency" }));
    await runtime.create(entry({ id: "task:main", dependencyIds: ["task:dependency"] }));
    await runtime.create(entry({ id: "task:waiting", approvalState: "pending" }));
    await runtime.create(entry({ id: "task:active" }));
    await runtime.transition("task:dependency", "running");
    await runtime.transition("task:dependency", "blocked", {
      stopReason: "dependency tool stopped",
    });
    await runtime.transition("task:waiting", "blocked", {
      stopReason: "approval required",
    });
    await runtime.transition("task:active", "running");

    const restarted = new TaskLedgerRuntime("project:test", "test", eventLog, clock, ids);
    const restored = await restarted.load();

    expect(restored.entries["task:main"]).toMatchObject({
      status: "pending",
      attemptCount: 0,
      dependencyIds: ["task:dependency"],
    });
    expect(restored.entries["task:dependency"]).toMatchObject({
      status: "blocked",
      attemptCount: 1,
      stopReason: "dependency tool stopped",
    });
    expect(restored.entries["task:waiting"]).toMatchObject({
      status: "blocked",
      attemptCount: 0,
      stopReason: "approval required",
    });
    expect(restored.entries["task:active"]).toMatchObject({
      status: "running",
      attemptCount: 1,
    });
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
