import { describe, expect, it } from "vitest";
import {
  CheckpointRuntime,
  InMemoryCheckpointStore,
  ResumeOrchestrator,
  assessCheckpointStaleness,
  type Checkpoint,
  type CheckpointClock,
  type CheckpointIds,
} from "./checkpoint.js";
import { InMemoryEventLog, createEvent } from "./event-log.js";

const clock: CheckpointClock = { now: () => "2026-01-01T00:00:00.000Z" };
const ids: CheckpointIds = (() => {
  let sequence = 0;
  return { next: (prefix: string) => `${prefix}:checkpoint:${++sequence}` };
})();

const checkpoint = (overrides: Partial<Checkpoint> = {}): Checkpoint => ({
  id: "checkpoint:1",
  type: "Checkpoint",
  revision: 0,
  gate: "gate:a",
  inputRevision: 1,
  inputHash: "hash:input:1",
  graphRevision: 1,
  toolVersion: "tool:1",
  modelVersion: "model:1",
  libraryVersion: "library:1",
  containerVersion: "container:1",
  provenance: [{ kind: "tool-output", locator: "tool://run/1" }],
  measurementSystemQualification: { status: "qualified" },
  fabProfileId: "fab:1",
  manufacturingProfileId: "manufacturing:1",
  knowledgeItemStatuses: [{ knowledgeItemId: "knowledge:1", status: "approved" }],
  artifactHashes: ["hash:artifact:1"],
  verificationResultIds: ["verification:1"],
  eventPosition: 0,
  executionEnvironment: { os: "linux" },
  ...overrides,
});

describe("checkpoint runtime", () => {
  it("reports changed and unknown invalidation inputs structurally", () => {
    const result = assessCheckpointStaleness(checkpoint(), {
      inputRevision: 2,
      inputHash: "hash:input:1",
    });

    expect(result).toEqual({
      stale: true,
      reasons: [
        {
          field: "inputRevision",
          kind: "changed",
          checkpointValue: 1,
          currentValue: 2,
        },
        {
          field: "graphRevision",
          kind: "unknown",
          checkpointValue: 1,
          currentValue: undefined,
        },
        {
          field: "toolVersion",
          kind: "unknown",
          checkpointValue: "tool:1",
          currentValue: undefined,
        },
        {
          field: "modelVersion",
          kind: "unknown",
          checkpointValue: "model:1",
          currentValue: undefined,
        },
        {
          field: "libraryVersion",
          kind: "unknown",
          checkpointValue: "library:1",
          currentValue: undefined,
        },
        {
          field: "containerVersion",
          kind: "unknown",
          checkpointValue: "container:1",
          currentValue: undefined,
        },
        {
          field: "provenance",
          kind: "unknown",
          checkpointValue: checkpoint().provenance,
          currentValue: undefined,
        },
        {
          field: "measurementSystemQualification",
          kind: "unknown",
          checkpointValue: checkpoint().measurementSystemQualification,
          currentValue: undefined,
        },
        {
          field: "fabProfileId",
          kind: "unknown",
          checkpointValue: "fab:1",
          currentValue: undefined,
        },
        {
          field: "manufacturingProfileId",
          kind: "unknown",
          checkpointValue: "manufacturing:1",
          currentValue: undefined,
        },
        {
          field: "knowledgeItemStatuses",
          kind: "unknown",
          checkpointValue: checkpoint().knowledgeItemStatuses,
          currentValue: undefined,
        },
      ],
    });
  });

  it("writes a checkpoint event at a gate boundary", async () => {
    const eventLog = new InMemoryEventLog();
    const store = new InMemoryCheckpointStore();
    const runtime = new CheckpointRuntime("project:test", "test", eventLog, store, clock, ids);

    const created = await runtime.create(checkpoint());

    expect(created.eventPosition).toBe(0);
    expect((await store.readAll()).map((item) => item.id)).toEqual([created.id]);
    expect((await eventLog.readAll()).map((event) => event.type)).toEqual(["checkpoint.created"]);
  });

  it("resumes from the last verified fresh checkpoint and is idempotent", async () => {
    const eventLog = new InMemoryEventLog();
    const store = new InMemoryCheckpointStore();
    await eventLog.append(
      createEvent({
        eventId: "event:verification:1",
        type: "verification.completed",
        occurredAt: clock.now(),
        actor: "test",
        projectId: "project:test",
        baseRevision: 0,
        resultRevision: 1,
        payload: { verificationResultId: "verification:1", status: "passed" },
      }),
    );
    await store.write(checkpoint({ eventPosition: 1 }));
    const orchestrator = new ResumeOrchestrator(
      "project:test",
      "test",
      eventLog,
      store,
      clock,
      ids,
    );

    const first = await orchestrator.resume("resume:1", checkpoint(), [
      { id: "gate:a" },
      { id: "gate:b" },
      { id: "gate:c" },
    ]);
    const second = await orchestrator.resume("resume:1", checkpoint(), [
      { id: "gate:a" },
      { id: "gate:b" },
      { id: "gate:c" },
    ]);

    expect(first).toMatchObject({
      checkpoint: { id: "checkpoint:1" },
      skippedStageIds: ["gate:a"],
      rerunStageIds: ["gate:b", "gate:c"],
      idempotent: false,
    });
    expect(second).toMatchObject({ resumeId: "resume:1", idempotent: true });
    expect((await eventLog.readAll()).filter((event) => event.type === "run.resumed")).toHaveLength(
      1,
    );
  });
});
