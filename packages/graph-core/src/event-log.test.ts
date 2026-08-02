import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvent, FileEventLog } from "./event-log.js";

describe("FileEventLog", () => {
  it("appends canonical events and verifies payload hashes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-events-"));
    const log = new FileEventLog(join(directory, "events.jsonl"));
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
    await log.verifyReplay();
    expect((await readFile(join(directory, "events.jsonl"), "utf8")).endsWith("\n")).toBe(true);
  });
});
