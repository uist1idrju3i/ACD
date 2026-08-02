import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PatchEnvelope as Patch } from "@acd/schema";
import { FileRepository } from "./repository.js";

const graph = {
  schemaVersion: "0.1.0-draft" as const,
  project: { id: "project:storage", type: "Project" as const, revision: 0 },
  entities: [{ id: "project:storage", type: "Project" as const, revision: 0 }],
};

const patch: Patch = {
  patchId: "patch:storage:1",
  baseRevision: 0,
  resultRevision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  operations: [{ op: "replace", path: "/project/revision", value: 1 }],
};

describe("FileRepository", () => {
  it("recognizes persisted patch IDs after a restart without duplicate side effects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-storage-"));
    const first = new FileRepository(directory, graph);
    await first.apply(patch);
    const patchesBefore = await readFile(join(directory, "patches.jsonl"), "utf8");
    const eventsBefore = await readFile(join(directory, "events.jsonl"), "utf8");

    const restarted = new FileRepository(directory, graph);
    const result = await restarted.apply(patch);

    expect(result.replayed).toBe(true);
    expect(await readFile(join(directory, "patches.jsonl"), "utf8")).toBe(patchesBefore);
    expect(await readFile(join(directory, "events.jsonl"), "utf8")).toBe(eventsBefore);
  });
});
