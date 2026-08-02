import { describe, expect, it } from "vitest";
import {
  assertKnowledgeApplicationsComplete,
  createTargetDesignKnowledgeContext,
  evaluateKnowledgeApplications,
  recordKnowledgeApplications,
} from "./knowledge-application.js";
import type { KnowledgeItem } from "./knowledge-lifecycle.js";

const item = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id: "knowledge:test",
  type: "KnowledgeItem",
  revision: 0,
  knowledgeId: "knowledge:test",
  scope: "project-local",
  sourceEventIds: ["event:test"],
  provenance: [
    {
      kind: "fab-rule",
      locator: "report:test",
      capturedAt: "2026-01-01T00:00:00.000Z",
      capturedBy: "fab:jlcpcb-class-2layer",
      contentHash: "sha256:" + "a".repeat(64),
      designRevision: "prototype-1",
      fabProfileId: "fab:jlcpcb-class-2layer",
    },
  ],
  content: "mask clearance",
  status: "adopted",
  appliesWhen: [
    { field: "fabProfileId", operator: "equals", value: "fab:jlcpcb-class-2layer" },
    {
      field: "footprintId",
      operator: "equals",
      value: "footprint:Resistor_SMD:R_0603_1608Metric",
    },
  ],
  excludesWhen: [
    { field: "fabProfileId", operator: "notEquals", value: "fab:jlcpcb-class-2layer" },
  ],
  ...overrides,
});

const context = createTargetDesignKnowledgeContext({
  designRevision: "prototype-2",
  fabProfileId: "fab:jlcpcb-class-2layer",
  footprintIds: ["R_0603_1608Metric"],
  ruleIds: [],
  classifications: [],
  reproductionConditions: [],
  partIds: ["part:r2"],
});

describe("knowledge application", () => {
  it("evaluates deterministically and honors adopted-only and excludesWhen", () => {
    const adopted = evaluateKnowledgeApplications([item()], context);
    expect(adopted.decisions[0]?.status).toBe("pass");
    expect(evaluateKnowledgeApplications([item()], context)).toEqual(adopted);
    expect(
      evaluateKnowledgeApplications([item({ status: "reviewed" })], context).decisions[0],
    ).toMatchObject({
      status: "pass",
      applied: false,
      lifecycleStatus: "reviewed",
    });
    expect(
      evaluateKnowledgeApplications([item()], { ...context, fabProfileId: "fab:other" })
        .decisions[0]?.status,
    ).toBe("fail");
  });

  it("records unknown as applicable and widens verification", () => {
    const contextWithoutFootprint = { ...context };
    delete (contextWithoutFootprint as Record<string, unknown>).footprintId;
    const result = evaluateKnowledgeApplications([item()], {
      ...contextWithoutFootprint,
      footprintIds: [],
    });
    expect(result.decisions[0]?.status).toBe("unknown");
    expect(result.applicableKnowledgeIds).toEqual(["knowledge:test"]);
  });

  it("records explicit no-applicable-knowledge", () => {
    const result = evaluateKnowledgeApplications([item({ status: "deprecated" })], context);
    expect(result.decisions.at(-1)?.status).toBe("no-applicable-knowledge");
  });

  it("stops when applicable adopted knowledge was not applied", () => {
    const result = evaluateKnowledgeApplications([item()], context);
    expect(() => assertKnowledgeApplicationsComplete(result, "projection")).toThrow(
      /was not applied/,
    );
    const applied = recordKnowledgeApplications(result, [
      { knowledgeId: "knowledge:test", libraryRevision: "library:overlay:test" },
    ]);
    expect(() => assertKnowledgeApplicationsComplete(applied, "projection")).not.toThrow();
    expect(applied.libraryRevisions).toEqual(["library:overlay:test"]);
  });

  it("keeps the knowledge-to-library-to-projection trace", () => {
    const result = recordKnowledgeApplications(evaluateKnowledgeApplications([item()], context), [
      { knowledgeId: "knowledge:test", libraryRevision: "library:overlay:test" },
    ]);
    expect(result.decisions[0]).toMatchObject({
      knowledgeItemId: "knowledge:test",
      libraryRevision: "library:overlay:test",
      applied: true,
    });
  });
});
