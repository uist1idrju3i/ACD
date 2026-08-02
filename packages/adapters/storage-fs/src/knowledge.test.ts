import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileKnowledgeRepository } from "./knowledge.js";

const item = {
  id: "knowledge:test",
  type: "KnowledgeItem" as const,
  revision: 0,
  scope: "project-local" as const,
  sourceEventIds: ["event:test"],
  provenance: [{ kind: "fab-rule" as const, locator: "fixture:test" }],
  content: "test",
  status: "candidate" as const,
  appliesWhen: ["profile=test"],
  excludesWhen: ["prototype=2"],
};

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("FileKnowledgeRepository", () => {
  it("persists append-only knowledge revisions", async () => {
    directory = await mkdtemp(join(tmpdir(), "acd-knowledge-"));
    const repository = new FileKnowledgeRepository(join(directory, "knowledge.jsonl"));
    await repository.save(item);
    await repository.save({
      ...item,
      id: "knowledge:test:r1",
      revision: 1,
      previousRevisionId: item.id,
    });
    expect((await repository.list()).map((entry) => entry.id)).toEqual([
      "knowledge:test",
      "knowledge:test:r1",
    ]);
    expect((await repository.get("knowledge:test"))?.revision).toBe(0);
    expect((await readFile(join(directory, "knowledge.jsonl"), "utf8")).split("\n")).toHaveLength(
      3,
    );
  });
});
