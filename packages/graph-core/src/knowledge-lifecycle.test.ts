import { describe, expect, it } from "vitest";
import { loadSchemaValidator, type Entity } from "@acd/schema";
import {
  createKnowledgeAppliedEvent,
  createKnowledgeCandidate,
  createKnowledgeCandidateCreatedEvent,
  createKnowledgeTransitionedEvent,
  evaluateKnowledgeApplicability,
  propagateKnowledgeDeprecation,
  reviseKnowledgeItem,
  transitionKnowledgeItem,
  type KnowledgeItem,
} from "./knowledge-lifecycle.js";

const item = (): KnowledgeItem => ({
  id: "knowledge:test:f1",
  knowledgeId: "knowledge:test:f1",
  type: "KnowledgeItem",
  revision: 0,
  scope: "project-local",
  sourceEventIds: ["event:fab-feedback:test"],
  provenance: [
    {
      kind: "fab-rule",
      locator: "fab-report:test",
      contentHash: "sha256:" + "a".repeat(64),
      designRevision: "phase1-golden-2",
      fabProfileId: "fab:jlcpcb-class-2layer",
    },
  ],
  content: "mask-clearance: solder mask sliver",
  status: "candidate",
  appliesWhen: [{ field: "fabProfileId", operator: "equals", value: "fab:jlcpcb-class-2layer" }],
  excludesWhen: [
    { field: "fabProfileId", operator: "notEquals", value: "fab:jlcpcb-class-2layer" },
  ],
  confidence: 0.98,
});

describe("knowledge lifecycle", () => {
  it("validates generated KnowledgeItems against the design graph schema", async () => {
    const validator = await loadSchemaValidator("design-graph");
    expect(
      validator({
        schemaVersion: "0.1.0-draft",
        project: { id: "project:test", type: "Project", revision: 0 },
        entities: [item()],
      }),
    ).toBe(true);
    const invalid = { ...item(), sourceEventIds: [] };
    expect(
      validator({
        schemaVersion: "0.1.0-draft",
        project: { id: "project:test", type: "Project", revision: 0 },
        entities: [invalid],
      }),
    ).toBe(false);
  });

  it("creates deterministic candidates from passing intake findings", () => {
    const input = {
      finding: {
        findingId: "F-1",
        originalText: "solder mask sliver",
        severityReported: "high" as const,
        references: {
          ruleId: "mask-sliver-min",
          partId: "part:r1",
          footprintId: "footprint:r0603",
        },
        classification: "mask-clearance" as const,
        confidence: 0.98,
        reproductionConditions: ["2-layer"],
        duplicateFindingIds: [],
        verdict: "pass" as const,
      },
      report: {
        reportId: "fab-report:test",
        fabProfileId: "fab:jlcpcb-class-2layer",
        rawReport: { contentHash: "sha256:" + "a".repeat(64) },
      },
      sourceEventId: "event:fab-feedback:test",
      designRevision: "phase1-golden-2",
      derivationInputHash: "sha256:" + "b".repeat(64),
      derivationOutputHash: "sha256:" + "c".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof createKnowledgeCandidate>[0];
    expect(createKnowledgeCandidate(input)).toEqual(createKnowledgeCandidate(input));
  });

  it("keeps originating revision in provenance while applying across revisions", () => {
    const input = {
      finding: {
        findingId: "F-1",
        originalText: "solder mask sliver",
        severityReported: "high" as const,
        references: {
          ruleId: "mask-sliver-min",
          partId: "part:r1",
          footprintId: "footprint:r0603",
        },
        classification: "mask-clearance" as const,
        confidence: 0.98,
        reproductionConditions: ["2-layer"],
        duplicateFindingIds: [],
        verdict: "pass" as const,
      },
      report: {
        reportId: "fab-report:prototype-1",
        fabProfileId: "fab:jlcpcb-class-2layer",
        rawReport: { contentHash: "sha256:" + "a".repeat(64) },
      },
      sourceEventId: "event:fab-feedback:prototype-1",
      designRevision: "phase1-golden-2",
      derivationInputHash: "sha256:" + "b".repeat(64),
      derivationOutputHash: "sha256:" + "c".repeat(64),
      createdAt: "2026-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof createKnowledgeCandidate>[0];
    const adopted = transitionKnowledgeItem(
      transitionKnowledgeItem(createKnowledgeCandidate(input), {
        status: "reviewed",
        now: "2026-01-01T00:00:00.000Z",
      }),
      { status: "adopted", now: "2026-01-01T00:00:00.000Z" },
    );
    expect(adopted.provenance[0]).toMatchObject({ designRevision: "phase1-golden-2" });
    expect(adopted.appliesWhen).not.toContainEqual({
      field: "designRevision",
      operator: "equals",
      value: "phase1-golden-2",
    });
    expect(adopted.appliesWhen).not.toContainEqual({
      field: "partId",
      operator: "equals",
      value: "part:prototype-1",
    });
    expect(adopted.appliesWhen).toContainEqual({
      field: "fabProfileId",
      operator: "equals",
      value: "fab:jlcpcb-class-2layer",
    });
    expect(adopted.appliesWhen).toContainEqual({
      field: "footprintId",
      operator: "equals",
      value: "footprint:r0603",
    });
    expect(
      evaluateKnowledgeApplicability(adopted, {
        fabProfileId: "fab:jlcpcb-class-2layer",
        partId: "part:prototype-2",
        footprintId: "footprint:r0603",
        ruleId: "mask-sliver-min",
        classification: "mask-clearance",
        reproductionCondition: ["2-layer", "HASL", "0.1mm minimum mask sliver"],
        designRevision: "prototype-2",
      }),
    ).toBe("pass");
  });

  it("allows forward transitions and retains rejected candidates", () => {
    const reviewed = transitionKnowledgeItem(item(), {
      status: "reviewed",
      now: "2026-01-01T00:00:00.000Z",
    });
    const rejected = transitionKnowledgeItem(item(), {
      status: "rejected",
      rejectionReason: "not reproduced on the target profile",
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(reviewed.status).toBe("reviewed");
    expect(rejected.rejectionReason).toContain("not reproduced");
  });

  it("stops illegal transitions and incomplete promotions", () => {
    expect(() =>
      transitionKnowledgeItem(item(), {
        status: "adopted",
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/illegal knowledge transition|promotion metadata/);
    expect(() =>
      transitionKnowledgeItem(item(), {
        status: "reviewed",
        scope: "library-wide",
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/approval|library-wide/);
  });

  it("stops missing, expired, or mismatched library approval", () => {
    const reviewed = transitionKnowledgeItem(item(), {
      status: "reviewed",
      now: "2026-01-01T00:00:00.000Z",
    });
    const approval = {
      approvalId: "approval:test",
      subject: reviewed.knowledgeId,
      scope: "library-wide" as const,
      approvedBy: "user:test",
      approvedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
    };
    expect(() =>
      transitionKnowledgeItem(reviewed, {
        status: "adopted",
        scope: "library-wide",
        now: "2026-01-03T00:00:00.000Z",
        approval,
      }),
    ).toThrow(/approval/);
    const adopted = transitionKnowledgeItem(reviewed, {
      status: "adopted",
      scope: "library-wide",
      now: "2026-01-01T12:00:00.000Z",
      approval,
    });
    expect(adopted.scope).toBe("library-wide");
    expect(() =>
      transitionKnowledgeItem(reviewed, {
        status: "adopted",
        scope: "library-wide",
        now: "not-a-date",
        approval,
      }),
    ).toThrow(/approval/);
  });

  it("rejects terminal transitions, scope downgrades, and unvalidated approvals", () => {
    const rejected = transitionKnowledgeItem(item(), {
      status: "rejected",
      rejectionReason: "not reproduced",
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(() =>
      transitionKnowledgeItem(rejected, {
        status: "deprecated",
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/terminal/);
    const adopted = transitionKnowledgeItem(
      transitionKnowledgeItem(item(), {
        status: "reviewed",
        now: "2026-01-01T00:00:00.000Z",
      }),
      {
        status: "adopted",
        scope: "library-wide",
        now: "2026-01-01T00:00:00.000Z",
        approval: {
          approvalId: "approval:test",
          subject: item().knowledgeId,
          scope: "library-wide",
          approvedBy: "user:test",
          approvedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-02T00:00:00.000Z",
        },
      },
    );
    expect(() =>
      transitionKnowledgeItem(adopted, {
        status: "candidate",
        scope: "project-local",
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/downgraded|illegal/);
    expect(() =>
      transitionKnowledgeItem(item(), {
        status: "reviewed",
        approval: {
          approvalId: "approval:unvalidated",
          subject: item().knowledgeId,
          scope: "library-wide",
          approvedBy: "user:test",
          approvedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-02T00:00:00.000Z",
        },
        now: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/approval may only/);
  });

  it("allows already-library-wide knowledge to be deprecated or rejected", () => {
    const adopted = transitionKnowledgeItem(
      transitionKnowledgeItem(item(), {
        status: "reviewed",
        now: "2026-01-01T00:00:00.000Z",
      }),
      {
        status: "adopted",
        scope: "library-wide",
        now: "2026-01-01T00:00:00.000Z",
        approval: {
          approvalId: "approval:test",
          subject: item().knowledgeId,
          scope: "library-wide",
          approvedBy: "user:test",
          approvedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-02T00:00:00.000Z",
        },
      },
    );
    expect(
      transitionKnowledgeItem(adopted, {
        status: "deprecated",
        now: "2026-01-01T00:00:00.000Z",
      }).status,
    ).toBe("deprecated");
    expect(
      transitionKnowledgeItem(adopted, {
        status: "rejected",
        rejectionReason: "superseded",
        now: "2026-01-01T00:00:00.000Z",
      }).status,
    ).toBe("rejected");
    const deprecated = transitionKnowledgeItem(adopted, {
      status: "deprecated",
      now: "2026-01-01T00:00:00.000Z",
    });
    const stale = propagateKnowledgeDeprecation(
      {
        entities: [
          deprecated,
          {
            id: "verification:library",
            type: "VerificationResult",
            revision: 0,
            gate: "knowledge",
            status: "passed",
            inputRevision: 0,
            toolVersion: "test",
            checkedAt: "2026-01-01T00:00:00.000Z",
            links: [deprecated.id],
          },
        ],
      },
      deprecated.id,
      "knowledge deprecated",
    );
    expect(stale.staleEntityIds).toContain("verification:library");
  });

  it("rejects silent rewrites and creates explicit revisions", () => {
    expect(() =>
      reviseKnowledgeItem(item(), {
        content: item().content,
        sourceEventIds: item().sourceEventIds,
        provenance: item().provenance,
      }),
    ).toThrow(/does not change/);
    const revised = reviseKnowledgeItem(item(), {
      content: "updated content",
      sourceEventIds: ["event:new"],
      provenance: item().provenance,
    });
    expect(revised.previousRevisionId).toBe(item().id);
    expect(revised.id).toBe(`${item().knowledgeId}:r1`);
    expect(revised.knowledgeId).toBe(item().knowledgeId);
  });

  it("returns content revisions to candidate and project-local scope", () => {
    const adopted = transitionKnowledgeItem(
      transitionKnowledgeItem(item(), {
        status: "reviewed",
        now: "2026-01-01T00:00:00.000Z",
      }),
      {
        status: "adopted",
        scope: "library-wide",
        now: "2026-01-01T00:00:00.000Z",
        approval: {
          approvalId: "approval:test",
          subject: item().knowledgeId,
          scope: "library-wide",
          approvedBy: "user:test",
          approvedAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-02T00:00:00.000Z",
        },
      },
    );
    const revised = reviseKnowledgeItem(adopted, {
      content: "updated content",
      sourceEventIds: adopted.sourceEventIds,
      provenance: adopted.provenance,
    });
    expect(revised.status).toBe("candidate");
    expect(revised.scope).toBe("project-local");
    expect(revised.approvalId).toBeUndefined();
  });

  it("propagates deprecation through recorded graph references", () => {
    const adoptedRevision = { ...item(), id: "knowledge:test:r2", revision: 2 };
    const deprecatedRevision = {
      ...adoptedRevision,
      id: "knowledge:test:r3",
      revision: 3,
      status: "deprecated" as const,
    };
    const result = propagateKnowledgeDeprecation(
      {
        entities: [
          adoptedRevision,
          deprecatedRevision,
          {
            id: "rationale:test",
            type: "Rationale",
            revision: 0,
            links: [adoptedRevision.id],
          },
          {
            id: "verification:test",
            type: "VerificationResult",
            revision: 0,
            gate: "knowledge",
            status: "passed",
            inputRevision: 0,
            toolVersion: "test",
            checkedAt: "2026-01-01T00:00:00.000Z",
            findingIds: ["rationale:test"],
          },
          {
            id: "verification:failed",
            type: "VerificationResult",
            revision: 4,
            gate: "knowledge",
            status: "failed",
            inputRevision: 0,
            toolVersion: "test",
            checkedAt: "2026-01-01T00:00:00.000Z",
            findingIds: ["rationale:test"],
          },
          {
            id: "custom:test",
            type: "CustomEntity",
            revision: 0,
          } as unknown as Entity,
        ],
      },
      deprecatedRevision.id,
      "knowledge item deprecated",
    );
    expect(result.staleEntityIds).toEqual(["rationale:test", "verification:test"]);
    expect(result.preservedEntityIds).toEqual(["verification:failed"]);
    expect(result.traversalBasis).toContain(
      "rationale:test:Rationale:evidenceLinks,generatedTestItemIds,links",
    );
    expect(result.traversalBasis).toContain(
      "custom:test:CustomEntity:no-declared-reference-fields:widened",
    );
    expect(result.graph.entities[2]?.status).toBe("stale");
    expect(result.graph.entities[3]?.status).toBe("stale");
    expect(result.graph.entities[2]?.revision).toBe(1);
    expect(result.graph.entities[4]?.status).toBe("failed");
    expect(result.graph.entities[4]?.revision).toBe(4);
  });

  it("creates typed hashed lifecycle events", () => {
    const candidate = createKnowledgeCandidateCreatedEvent({
      eventId: "event:knowledge:candidate",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 0,
      resultRevision: 1,
      knowledgeItem: item(),
    });
    const transitioned = createKnowledgeTransitionedEvent({
      eventId: "event:knowledge:transition",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 1,
      resultRevision: 2,
      knowledgeItem: item(),
      previousStatus: "candidate",
    });
    const applied = createKnowledgeAppliedEvent({
      eventId: "event:knowledge:applied",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "test",
      projectId: "project:test",
      baseRevision: 2,
      resultRevision: 3,
      payload: {
        knowledgeItemId: item().id,
        targetProjectId: "project:test",
        targetRevision: 2,
        appliedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(candidate.payloadHash).toMatch(/^sha256:/);
    expect(transitioned.payloadHash).toMatch(/^sha256:/);
    expect(applied.payloadHash).toMatch(/^sha256:/);
  });
});
