import { describe, expect, it } from "vitest";
import {
  createKnowledgeAppliedEvent,
  createKnowledgeCandidate,
  createKnowledgeCandidateCreatedEvent,
  createKnowledgeTransitionedEvent,
  propagateKnowledgeDeprecation,
  reviseKnowledgeItem,
  transitionKnowledgeItem,
  type KnowledgeItem,
} from "./knowledge-lifecycle.js";

const item = (): KnowledgeItem => ({
  id: "knowledge:test:f1",
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
  appliesWhen: ["fabProfileId=fab:jlcpcb-class-2layer"],
  excludesWhen: ["prototype-only"],
  confidence: 0.98,
});

describe("knowledge lifecycle", () => {
  it("creates deterministic candidates from passing intake findings", () => {
    const input = {
      finding: {
        findingId: "F-1",
        originalText: "solder mask sliver",
        severityReported: "high" as const,
        references: {},
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
      excludesWhen: ["prototype-only"],
      createdAt: "2026-01-01T00:00:00.000Z",
    } as unknown as Parameters<typeof createKnowledgeCandidate>[0];
    expect(createKnowledgeCandidate(input)).toEqual(createKnowledgeCandidate(input));
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
      subject: reviewed.id,
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
  });

  it("rejects silent rewrites and creates explicit revisions", () => {
    expect(() =>
      reviseKnowledgeItem(item(), { ...item(), content: item().content } as never),
    ).toThrow(/does not change/);
    const revised = reviseKnowledgeItem(item(), {
      content: "updated content",
      sourceEventIds: ["event:new"],
      provenance: item().provenance,
    });
    expect(revised.previousRevisionId).toBe(item().id);
    expect(revised.id).not.toBe(item().id);
  });

  it("propagates deprecation through recorded graph references", () => {
    const result = propagateKnowledgeDeprecation(
      {
        entities: [
          item(),
          {
            id: "rationale:test",
            type: "Rationale",
            revision: 0,
            links: [item().id],
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
        ],
      },
      item().id,
      "knowledge item deprecated",
    );
    expect(result.staleEntityIds).toEqual(["rationale:test", "verification:test"]);
    expect(result.graph.entities[1]?.status).toBe("stale");
    expect(result.graph.entities[2]?.status).toBe("stale");
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
