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
  });
});
