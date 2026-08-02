import { describe, expect, it } from "vitest";
import type { PatchEnvelope as Patch } from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { PatchEngine } from "./patch.js";
import type { DesignGraph } from "./semantic.js";

const graph: DesignGraph = {
  schemaVersion: "0.1.0-draft",
  project: {
    id: "project:test",
    type: "Project",
    revision: 0,
    name: "Test",
  },
  entities: [
    {
      id: "project:test",
      type: "Project",
      revision: 0,
      name: "Test",
    },
    {
      id: "requirement:test",
      type: "Requirement",
      revision: 0,
      name: "Requirement",
      links: ["project:test"],
    },
  ],
};

const patch = (overrides: Partial<Patch> = {}): Patch => ({
  patchId: "patch:test:1",
  baseRevision: 0,
  resultRevision: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  operations: [
    {
      op: "replace",
      path: "/entities/@id:requirement:test/name",
      value: "Changed",
    },
  ],
  ...overrides,
});

describe("PatchEngine", () => {
  it("applies ID-addressed operations atomically and deterministically", () => {
    const engine = new PatchEngine();
    const result = engine.apply(graph, 0, patch());

    expect(result.revision).toBe(1);
    expect(result.graph.entities[1]?.name).toBe("Changed");
    expect(result.graph.entities.every((entity) => entity.revision === 1)).toBe(true);
    expect(result.snapshotHash).toBe(engine.apply(graph, 0, patch()).snapshotHash);
  });

  it("stops on revision conflict without mutating the input", () => {
    const engine = new PatchEngine();
    expect(() => engine.apply(graph, 1, patch())).toThrowError(GraphCoreError);
    expect(graph.entities[1]?.name).toBe("Requirement");
  });

  it("returns the existing result for an idempotent resubmission", () => {
    const engine = new PatchEngine();
    const first = engine.apply(graph, 0, patch());
    const second = engine.apply(graph, 0, patch());

    expect(second.replayed).toBe(true);
    expect(second.snapshotHash).toBe(first.snapshotHash);
  });

  it("rejects duplicate entity IDs", () => {
    const engine = new PatchEngine();
    const invalid = structuredClone(graph);
    invalid.entities.push({
      id: "project:test",
      type: "Requirement",
      revision: 0,
      name: "Duplicate",
    });

    expect(() =>
      engine.apply(invalid, 0, {
        ...patch(),
        patchId: "patch:test:duplicate",
        operations: [{ op: "test", path: "/project/id", value: "project:test" }],
      }),
    ).toThrowError(/duplicate entity id/);
  });
});
