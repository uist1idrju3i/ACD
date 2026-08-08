import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GraphCoreError, canonicalize, createEvent } from "@acd/graph-core";
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
    await second.close();
  });

  it("does not let a rejected writer close the existing lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const first = new FileEventLog(path);
    const second = new FileEventLog(path);

    await first.append(event);
    await expect(second.append(event)).rejects.toThrow(/writer lock already held/);
    await second.close();
    await expect(
      first.append({ ...event, eventId: "event:storage:2", resultRevision: 2, baseRevision: 1 }),
    ).resolves.toBeUndefined();

    await first.close();
  });

  it("allows a new writer after the original writer releases the lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const first = new FileEventLog(path);
    const second = new FileEventLog(path);

    await first.append(event);
    await first.close();
    await expect(second.append(event)).resolves.toBeUndefined();

    await second.close();
  });

  it("recovers a crash-truncated trailing partial line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const log = new FileEventLog(path);

    await log.append(event);
    await appendFile(path, '{"eventId":"partial"');

    await expect(log.readAll()).resolves.toEqual([event]);
    expect((await readFile(path, "utf8")).endsWith('{"eventId":"partial"')).toBe(true);
    await expect(log.recover()).resolves.toEqual({
      truncatedBytes: '{"eventId":"partial"'.length,
      finalEventId: event.eventId,
      eventPosition: 1,
    });
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);

    await log.close();
  });

  it("does not mutate the log when a non-owner reads a trailing partial line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const owner = new FileEventLog(path);
    const observer = new FileEventLog(path);

    await owner.append(event);
    await appendFile(path, '{"eventId":"partial"');
    const before = await readFile(path);

    await expect(observer.readAll()).resolves.toEqual([event]);
    await expect(observer.recover()).rejects.toThrow(/writer lock already held/);
    expect(await readFile(path)).toEqual(before);

    await owner.close();
    await observer.close();
  });

  it("stops on corruption in a complete non-trailing line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const log = new FileEventLog(path);
    const secondEvent = {
      ...event,
      eventId: "event:storage:2",
      resultRevision: 2,
      baseRevision: 1,
    };

    await log.append(event);
    await appendFile(path, '{"corrupt":true}\n');
    await appendFile(path, `${canonicalize(secondEvent)}\n`);

    await expect(log.readAll()).rejects.toMatchObject({
      code: "event-replay-failure",
    } satisfies Partial<GraphCoreError>);

    await log.close();
  });

  it("stops on a non-trailing event hash mismatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-event-log-"));
    const path = join(directory, "events.jsonl");
    const log = new FileEventLog(path);
    const tampered = { ...event, payload: { taskId: "tampered" } };

    await log.append(event);
    await appendFile(path, `${canonicalize(tampered)}\n`);

    await expect(log.readAll()).rejects.toMatchObject({
      code: "event-replay-failure",
    } satisfies Partial<GraphCoreError>);

    await log.close();
  });
});
