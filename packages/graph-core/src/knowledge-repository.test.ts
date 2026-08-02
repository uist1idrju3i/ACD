import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeRepository } from "./knowledge-repository.js";

const item = {
  id: "knowledge:test",
  knowledgeId: "knowledge:test",
  type: "KnowledgeItem" as const,
  revision: 0,
  scope: "project-local" as const,
  sourceEventIds: ["event:test"],
  provenance: [{ kind: "fab-rule" as const, locator: "fixture:test" }],
  content: "test",
  status: "candidate" as const,
  appliesWhen: [{ field: "fabProfileId", operator: "equals", value: "profile=test" } as const],
  excludesWhen: [{ field: "fabProfileId", operator: "notEquals", value: "profile=test" } as const],
};

describe("InMemoryKnowledgeRepository", () => {
  it("makes identical saves idempotent and rejects conflicting IDs", async () => {
    const repository = new InMemoryKnowledgeRepository();
    await repository.save(item);
    await repository.save(structuredClone(item));
    await expect(repository.save({ ...item, content: "different" })).rejects.toThrow(
      /already exists/,
    );
    expect((await repository.list()).map((entry) => entry.id)).toEqual(["knowledge:test"]);
  });
});
