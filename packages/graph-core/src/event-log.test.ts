import { describe, expect, it } from "vitest";
import { createEvent, InMemoryEventLog, verifyReplay } from "./event-log.js";

describe("FileEventLog", () => {
  it("appends canonical events and verifies payload hashes", async () => {
    const log = new InMemoryEventLog();
    const event = createEvent({
      eventId: "event:test:1",
      type: "patch.accepted",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 0,
      resultRevision: 1,
      payload: { patchId: "patch:test:1" },
    });

    await log.append(event);
    verifyReplay(await log.readAll());
    expect((await log.readAll())[0]?.payloadHash).toMatch(/^sha256:/);
    expect(await log.readFrom(1)).toEqual({ position: 1, events: [] });
    await expect(log.readFrom(-1)).rejects.toMatchObject({ code: "event-replay-failure" });
    await expect(log.readFrom(2)).rejects.toMatchObject({ code: "event-replay-failure" });
  });

  it("derives revisions from the previous result and preserves them for stops", () => {
    const progress = createEvent({
      eventId: "event:test:progress",
      type: "patch.accepted",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 0,
      resultRevision: 1,
      payload: { patchId: "patch:test:progress" },
    });
    const stopped = createEvent({
      eventId: "event:test:stopped",
      type: "run.stopped",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 1,
      resultRevision: 1,
      payload: { reason: "failed" },
    });
    const rejected = createEvent({
      eventId: "event:test:rejected",
      type: "patch.rejected",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 1,
      resultRevision: 1,
      payload: { patchId: "patch:test:rejected" },
    });
    const next = createEvent({
      eventId: "event:test:next",
      type: "patch.accepted",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 1,
      resultRevision: 2,
      payload: { patchId: "patch:test:next" },
    });

    expect(() => verifyReplay([progress, stopped, rejected, next])).not.toThrow();
    expect(() => verifyReplay([{ ...stopped, resultRevision: 2 }])).toThrow(/event revision gap/);
  });
});
