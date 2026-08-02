import type { Entity } from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { createEvent, type EventEnvelope } from "./event-log.js";
import type { FabFeedbackFinding, FabFeedbackReport } from "./fab-feedback.js";

export type KnowledgeStatus = "candidate" | "reviewed" | "adopted" | "rejected" | "deprecated";

export type KnowledgeItem = Entity & {
  type: "KnowledgeItem";
  scope: "project-local" | "library-wide";
  sourceEventIds: string[];
  provenance: NonNullable<Entity["provenance"]>;
  content: string;
  status: KnowledgeStatus;
  appliesWhen: string[];
  excludesWhen: string[];
  previousRevisionId?: string;
  rejectionReason?: string;
  staleReason?: string;
  approvalId?: string;
  confidence?: number;
  reproduced?: boolean;
};

export type KnowledgeApproval = {
  approvalId: string;
  subject: string;
  scope: "library-wide";
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
};

const lifecycleOrder: Record<KnowledgeStatus, number> = {
  candidate: 0,
  reviewed: 1,
  adopted: 2,
  rejected: 3,
  deprecated: 4,
};

const assertPromotionMetadata = (item: KnowledgeItem): void => {
  if (
    item.sourceEventIds.length === 0 ||
    item.provenance.length === 0 ||
    item.appliesWhen.length === 0 ||
    item.excludesWhen.length === 0
  ) {
    throw new GraphCoreError(
      "schema-invalid",
      `knowledge item lacks promotion metadata: ${item.id}`,
      "error",
      { knowledgeItemId: item.id },
    );
  }
};

const nextRevision = (item: KnowledgeItem, changes: Partial<KnowledgeItem>): KnowledgeItem => {
  const revision = item.revision + 1;
  return {
    ...item,
    ...changes,
    id: `${item.id}:r${revision}`,
    revision,
    previousRevisionId: item.id,
  };
};

export const createKnowledgeCandidate = (input: {
  finding: FabFeedbackFinding;
  report: FabFeedbackReport;
  sourceEventId: string;
  designRevision: string;
  derivationInputHash: string;
  derivationOutputHash: string;
  excludesWhen: string[];
  createdAt: string;
}): KnowledgeItem => {
  if (input.finding.verdict !== "pass") {
    throw new GraphCoreError(
      "fab-feedback-unknown",
      `unknown fab finding cannot become knowledge candidate: ${input.finding.findingId}`,
      "error",
    );
  }
  if (input.excludesWhen.length === 0) {
    throw new GraphCoreError(
      "schema-invalid",
      "knowledge candidate requires non-empty exclusion conditions",
    );
  }
  return {
    id: `knowledge:${input.report.reportId}:${input.finding.findingId}`,
    type: "KnowledgeItem",
    revision: 0,
    scope: "project-local",
    sourceEventIds: [input.sourceEventId],
    provenance: [
      {
        kind: "fab-rule",
        locator: input.report.reportId,
        capturedAt: input.createdAt,
        capturedBy: input.report.fabProfileId,
        contentHash: input.report.rawReport.contentHash,
        designRevision: input.designRevision,
        fabProfileId: input.report.fabProfileId,
        derivationInputHash: input.derivationInputHash,
        derivationOutputHash: input.derivationOutputHash,
      },
    ],
    content: `${input.finding.classification}: ${input.finding.originalText}`,
    status: "candidate",
    appliesWhen: [
      `fabProfileId=${input.report.fabProfileId}`,
      `designRevision=${input.designRevision}`,
      ...input.finding.reproductionConditions,
    ],
    excludesWhen: input.excludesWhen,
    confidence: input.finding.confidence,
    reproduced: false,
  };
};

export const transitionKnowledgeItem = (
  item: KnowledgeItem,
  input: {
    status: KnowledgeStatus;
    now: string;
    approval?: KnowledgeApproval;
    scope?: KnowledgeItem["scope"];
    rejectionReason?: string;
  },
): KnowledgeItem => {
  const targetScope = input.scope ?? item.scope;
  if (targetScope === "library-wide" && item.scope !== "library-wide") {
    assertPromotionMetadata(item);
    const approval = input.approval;
    if (
      !approval ||
      approval.subject !== item.id ||
      approval.scope !== "library-wide" ||
      Date.parse(approval.expiresAt) <= Date.parse(input.now)
    ) {
      throw new GraphCoreError(
        "verification-failed",
        `library-wide promotion lacks a valid approval: ${item.id}`,
        "error",
      );
    }
  }
  if (targetScope === "library-wide" && input.status !== "adopted") {
    throw new GraphCoreError("schema-invalid", "library-wide knowledge must be adopted");
  }
  if (
    input.status !== "deprecated" &&
    input.status !== "rejected" &&
    lifecycleOrder[input.status] !== lifecycleOrder[item.status] + 1
  ) {
    throw new GraphCoreError(
      "schema-invalid",
      `illegal knowledge transition: ${item.status} -> ${input.status}`,
    );
  }
  if (input.status === "adopted" || input.status === "reviewed") assertPromotionMetadata(item);
  if (input.status === "rejected" && !input.rejectionReason) {
    throw new GraphCoreError("schema-invalid", "rejected knowledge requires a reason");
  }
  const changes: Partial<KnowledgeItem> = {
    status: input.status,
    scope: targetScope,
  };
  if (input.approval) changes.approvalId = input.approval.approvalId;
  if (input.rejectionReason) changes.rejectionReason = input.rejectionReason;
  return nextRevision(item, changes);
};

export const reviseKnowledgeItem = (
  item: KnowledgeItem,
  changes: Pick<KnowledgeItem, "content" | "sourceEventIds" | "provenance">,
): KnowledgeItem => {
  if (changes.content === item.content) {
    throw new GraphCoreError(
      "schema-invalid",
      `knowledge revision does not change content: ${item.id}`,
    );
  }
  return nextRevision(item, changes);
};

const referencedIds = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(referencedIds);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(referencedIds);
  }
  return [];
};

export const propagateKnowledgeDeprecation = (
  graph: { entities: Entity[] },
  knowledgeItemId: string,
  reason: string,
): { graph: typeof graph; staleEntityIds: string[] } => {
  const dependents = new Map<string, string[]>();
  for (const entity of graph.entities) {
    dependents.set(
      entity.id,
      referencedIds(entity).filter((id) => id !== entity.id),
    );
  }
  const affected = new Set<string>([knowledgeItemId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [entityId, references] of dependents) {
      if (!affected.has(entityId) && references.some((id) => affected.has(id))) {
        affected.add(entityId);
        changed = true;
      }
    }
  }
  const staleEntityIds: string[] = [];
  const updated = graph.entities.map((entity) => {
    if (
      affected.has(entity.id) &&
      entity.id !== knowledgeItemId &&
      (entity.type === "Rationale" || entity.type === "VerificationResult")
    ) {
      staleEntityIds.push(entity.id);
      return { ...entity, status: "stale", staleReason: reason };
    }
    return entity;
  });
  return { graph: { ...graph, entities: updated }, staleEntityIds };
};

export type KnowledgeCandidateCreatedPayload = {
  knowledgeItem: KnowledgeItem;
  sourceEventIds: string[];
};
export type KnowledgeTransitionedPayload = {
  knowledgeItem: KnowledgeItem;
  previousStatus: KnowledgeStatus;
};
export type KnowledgeAppliedPayload = {
  knowledgeItemId: string;
  targetProjectId: string;
  targetRevision: number;
  appliedAt: string;
};

export const createKnowledgeCandidateCreatedEvent = (input: {
  eventId: string;
  occurredAt: string;
  actor: string;
  projectId: string;
  baseRevision: number;
  resultRevision: number;
  knowledgeItem: KnowledgeItem;
}): EventEnvelope & {
  type: "knowledge.candidate.created";
  payload: KnowledgeCandidateCreatedPayload;
} =>
  createEvent({
    eventId: input.eventId,
    type: "knowledge.candidate.created",
    occurredAt: input.occurredAt,
    actor: input.actor,
    projectId: input.projectId,
    baseRevision: input.baseRevision,
    resultRevision: input.resultRevision,
    payload: {
      knowledgeItem: input.knowledgeItem,
      sourceEventIds: input.knowledgeItem.sourceEventIds,
    },
  }) as EventEnvelope & {
    type: "knowledge.candidate.created";
    payload: KnowledgeCandidateCreatedPayload;
  };

export const createKnowledgeTransitionedEvent = (input: {
  eventId: string;
  occurredAt: string;
  actor: string;
  projectId: string;
  baseRevision: number;
  resultRevision: number;
  knowledgeItem: KnowledgeItem;
  previousStatus: KnowledgeStatus;
}): EventEnvelope & { type: "knowledge.transitioned"; payload: KnowledgeTransitionedPayload } =>
  createEvent({
    eventId: input.eventId,
    type: "knowledge.transitioned",
    occurredAt: input.occurredAt,
    actor: input.actor,
    projectId: input.projectId,
    baseRevision: input.baseRevision,
    resultRevision: input.resultRevision,
    payload: {
      knowledgeItem: input.knowledgeItem,
      previousStatus: input.previousStatus,
    },
  }) as EventEnvelope & {
    type: "knowledge.transitioned";
    payload: KnowledgeTransitionedPayload;
  };

export const createKnowledgeAppliedEvent = (input: {
  eventId: string;
  occurredAt: string;
  actor: string;
  projectId: string;
  baseRevision: number;
  resultRevision: number;
  payload: KnowledgeAppliedPayload;
}): EventEnvelope & { type: "knowledge.applied"; payload: KnowledgeAppliedPayload } =>
  createEvent({
    ...input,
    type: "knowledge.applied",
  }) as EventEnvelope & { type: "knowledge.applied"; payload: KnowledgeAppliedPayload };
