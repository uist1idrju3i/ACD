import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalize, createEvent } from "@acd/graph-core";
import { FileEventLog } from "./event-log.js";

const event = createEvent({
  eventId: "event:storage:1",
  type: "task.created",
  occurredAt: "2026-01-01T00:00:00.000Z",
  actor: "test",
  projectId: "project:test",
  baseRevision: 0,
  resultRevision: 1,
  payload: { taskId: "task:1" },
});

describe("FileEventLog", () => {
  it("writes one newline-terminated event and rejects a second writer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const first = new FileEventLog(path);
    const second = new FileEventLog(path);

    await first.append(event);
    await expect(second.append(event)).rejects.toThrow(/writer lock already held/);
    await second.close();
    await first.append({
      ...event,
      eventId: "event:storage:2",
      resultRevision: 2,
      baseRevision: 1,
    });
    expect(await readFile(path, "utf8")).toBe(
      `${canonicalize(event)}\n${canonicalize({
        ...event,
        eventId: "event:storage:2",
        resultRevision: 2,
        baseRevision: 1,
      })}\n`,
    );

    await first.close();
    await second.append(event);
    await second.close();
  });
});
