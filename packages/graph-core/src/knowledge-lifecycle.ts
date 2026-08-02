import type { Entity } from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { createEvent, type EventEnvelope } from "./event-log.js";
import {
  resolveFabProfileRule,
  type FabFeedbackFinding,
  type FabFeedbackReport,
} from "./fab-feedback.js";
import { rulesForFabProfile, type ApplicabilityCondition } from "./fab-profile-rules.js";

export type KnowledgeStatus = "candidate" | "reviewed" | "adopted" | "rejected" | "deprecated";

export type KnowledgeItem = Entity & {
  type: "KnowledgeItem";
  scope: "project-local" | "library-wide";
  sourceEventIds: string[];
  provenance: NonNullable<Entity["provenance"]>;
  content: string;
  status: KnowledgeStatus;
  knowledgeId: string;
  appliesWhen: ApplicabilityCondition[];
  excludesWhen: ApplicabilityCondition[];
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

export const assertKnowledgeLibraryWideApproval = (
  subject: string,
  approval: KnowledgeApproval | undefined,
  now: string,
): void => {
  const nowTime = Date.parse(now);
  const approvedTime = approval ? Date.parse(approval.approvedAt) : Number.NaN;
  const expiresTime = approval ? Date.parse(approval.expiresAt) : Number.NaN;
  if (
    !approval ||
    approval.approvalId.length === 0 ||
    approval.subject !== subject ||
    approval.scope !== "library-wide" ||
    !Number.isFinite(nowTime) ||
    !Number.isFinite(approvedTime) ||
    !Number.isFinite(expiresTime) ||
    expiresTime <= approvedTime ||
    expiresTime <= nowTime
  ) {
    throw new GraphCoreError(
      "verification-failed",
      `library-wide promotion lacks a valid approval: ${subject}`,
      "error",
    );
  }
};

export type KnowledgeApplicability = "pass" | "unknown" | "fail";
export type ApplicabilityContext = Partial<
  Record<ApplicabilityCondition["field"], string | string[]>
> &
  Record<string, string | string[] | undefined>;

const evaluateCondition = (
  conditionToEvaluate: ApplicabilityCondition,
  context: ApplicabilityContext,
): KnowledgeApplicability => {
  const observed = context[conditionToEvaluate.field];
  if (observed === undefined) return "unknown";
  const values = Array.isArray(observed) ? observed : [observed];
  const normalize = (value: string): string =>
    conditionToEvaluate.field === "footprintId" ? (value.split(":").at(-1) ?? value) : value;
  const matches = values.map(normalize).includes(normalize(conditionToEvaluate.value));
  return (conditionToEvaluate.operator === "equals" ? matches : !matches) ? "pass" : "fail";
};

export const evaluateKnowledgeApplicability = (
  item: Pick<KnowledgeItem, "appliesWhen" | "excludesWhen">,
  context: ApplicabilityContext,
): KnowledgeApplicability => {
  let unknown = false;
  for (const conditionToEvaluate of item.appliesWhen) {
    const result = evaluateCondition(conditionToEvaluate, context);
    if (result === "fail") return "fail";
    if (result === "unknown") unknown = true;
  }
  for (const conditionToEvaluate of item.excludesWhen) {
    const result = evaluateCondition(conditionToEvaluate, context);
    if (result === "pass") return "fail";
    if (result === "unknown") unknown = true;
  }
  return unknown ? "unknown" : "pass";
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
    item.excludesWhen.length === 0 ||
    !item.appliesWhen.some((entry) => entry.field === "reproductionCondition")
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
    id: revision === 0 ? item.knowledgeId : `${item.knowledgeId}:r${revision}`,
    revision,
    previousRevisionId: item.id,
  };
};

const condition = (
  field: ApplicabilityCondition["field"],
  operator: ApplicabilityCondition["operator"],
  value: string,
): ApplicabilityCondition => ({ field, operator, value });

const conditionsForFinding = (
  finding: FabFeedbackFinding,
  report: FabFeedbackReport,
): { appliesWhen: ApplicabilityCondition[]; excludesWhen: ApplicabilityCondition[] } => {
  const profile = rulesForFabProfile(report.fabProfileId);
  const rule = profile && resolveFabProfileRule(finding, profile);
  if (!rule || rule.appliesWhen.length === 0 || rule.excludesWhen.length === 0) {
    throw new GraphCoreError(
      "schema-invalid",
      `fab profile rule lacks declared applicability conditions: ${finding.references.ruleId ?? finding.findingId}`,
    );
  }
  const appliesWhen = [
    condition("fabProfileId", "equals", report.fabProfileId),
    ...(finding.references.footprintId
      ? [condition("footprintId", "equals", finding.references.footprintId)]
      : []),
    ...(finding.references.ruleId
      ? [condition("ruleId", "equals", finding.references.ruleId)]
      : []),
    condition("classification", "equals", finding.classification),
    ...finding.reproductionConditions.map((value) =>
      condition("reproductionCondition", "equals", value),
    ),
    ...rule.appliesWhen,
  ];
  const unique = (conditions: ApplicabilityCondition[]): ApplicabilityCondition[] =>
    conditions.filter(
      (candidate, index, all) =>
        all.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(candidate)) === index,
    );
  return { appliesWhen: unique(appliesWhen), excludesWhen: unique(rule.excludesWhen) };
};

export const createKnowledgeCandidate = (input: {
  finding: FabFeedbackFinding;
  report: FabFeedbackReport;
  sourceEventId: string;
  designRevision: string;
  derivationInputHash: string;
  derivationOutputHash: string;
  excludesWhen?: never;
  createdAt: string;
}): KnowledgeItem => {
  if (input.finding.verdict !== "pass") {
    throw new GraphCoreError(
      "fab-feedback-unknown",
      `unknown fab finding cannot become knowledge candidate: ${input.finding.findingId}`,
      "error",
    );
  }
  const applicability = conditionsForFinding(input.finding, input.report);
  if (applicability.appliesWhen.length === 0 || applicability.excludesWhen.length === 0) {
    throw new GraphCoreError("schema-invalid", "knowledge candidate requires declared conditions");
  }
  const knowledgeId = `knowledge:${input.report.reportId}:${input.finding.findingId}`;
  return {
    id: knowledgeId,
    type: "KnowledgeItem",
    revision: 0,
    knowledgeId,
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
    appliesWhen: applicability.appliesWhen,
    excludesWhen: applicability.excludesWhen,
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
  if (item.status === "rejected" || item.status === "deprecated") {
    throw new GraphCoreError(
      "schema-invalid",
      `terminal knowledge status cannot transition: ${item.status}`,
    );
  }
  const targetScope = input.scope ?? item.scope;
  if (item.scope === "library-wide" && targetScope === "project-local") {
    throw new GraphCoreError(
      "schema-invalid",
      "library-wide knowledge cannot be downgraded; revise the item instead",
    );
  }
  if (targetScope === "library-wide" && item.scope !== "library-wide") {
    assertPromotionMetadata(item);
    const approval = input.approval;
    const now = Date.parse(input.now);
    const expiresAt = approval ? Date.parse(approval.expiresAt) : Number.NaN;
    const approvedAt = approval ? Date.parse(approval.approvedAt) : Number.NaN;
    if (
      !approval ||
      !approval.approvalId ||
      !approval.subject ||
      approval.subject !== item.knowledgeId ||
      approval.scope !== "library-wide" ||
      !Number.isFinite(now) ||
      !Number.isFinite(approvedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= approvedAt ||
      expiresAt <= now
    ) {
      throw new GraphCoreError(
        "verification-failed",
        `library-wide promotion lacks a valid approval: ${item.id}`,
        "error",
      );
    }
  } else if (input.approval) {
    throw new GraphCoreError(
      "schema-invalid",
      "approval may only be recorded during a validated library-wide promotion",
    );
  }
  if (
    item.scope !== "library-wide" &&
    targetScope === "library-wide" &&
    input.status !== "adopted"
  ) {
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
  if (targetScope === "library-wide" && item.scope !== "library-wide" && input.approval) {
    changes.approvalId = input.approval.approvalId;
  }
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
  const revised = nextRevision(item, {
    ...changes,
    status: "candidate",
    scope: "project-local",
  });
  delete revised.approvalId;
  delete revised.rejectionReason;
  delete revised.staleReason;
  return revised;
};

const declaredReferenceFields: Record<Entity["type"], string[]> = {
  Project: ["requirements", "revisionIds", "links"],
  Requirement: ["links"],
  Constraint: ["links"],
  FunctionalBlock: ["links"],
  Component: ["links"],
  Part: ["links"],
  Footprint: ["links"],
  Net: ["links"],
  Pin: ["links"],
  Layout: ["links"],
  BoardStackup: ["links"],
  ManufacturingPackage: ["links"],
  FirmwarePackage: ["links"],
  TestItem: ["links"],
  KnowledgeItem: ["sourceEventIds", "changedDecisionIds", "previousRevisionId", "links"],
  Rationale: ["evidenceLinks", "generatedTestItemIds", "links"],
  VerificationResult: ["findingIds", "evidenceIds", "links"],
  Approval: ["subject", "links"],
  Waiver: ["approvalId", "links"],
  Evidence: ["links"],
  TaskLedgerEntry: ["links"],
};

const explicitReferences = (entity: Entity): { ids: string[]; basis: string } => {
  const fields = declaredReferenceFields[entity.type];
  if (!fields) {
    return {
      ids: [],
      basis: `${entity.type}:no-declared-reference-fields:widened`,
    };
  }
  const ids = fields.flatMap((field) => {
    const value = entity[field];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) {
      return value.flatMap((entry) =>
        typeof entry === "string"
          ? [entry]
          : entry && typeof entry === "object" && "evidenceId" in entry
            ? [String(entry.evidenceId)]
            : [],
      );
    }
    return [];
  });
  return { ids, basis: `${entity.type}:${fields.join(",")}` };
};

export const propagateKnowledgeDeprecation = (
  graph: { entities: Entity[] },
  knowledgeItemId: string,
  reason: string,
): {
  graph: typeof graph;
  staleEntityIds: string[];
  preservedEntityIds: string[];
  traversalBasis: string[];
} => {
  const dependents = new Map<string, { ids: string[]; basis: string }>();
  const traversalBasis: string[] = [];
  for (const entity of graph.entities) {
    const references = explicitReferences(entity);
    dependents.set(entity.id, references);
    traversalBasis.push(`${entity.id}:${references.basis}`);
  }
  const seed = graph.entities.find((entity) => entity.id === knowledgeItemId);
  const affectedKnowledgeId = seed?.type === "KnowledgeItem" ? seed.knowledgeId : undefined;
  const affected = new Set<string>([knowledgeItemId]);
  if (affectedKnowledgeId) {
    for (const entity of graph.entities) {
      if (entity.type === "KnowledgeItem" && entity.knowledgeId === affectedKnowledgeId) {
        affected.add(entity.id);
      }
    }
  }
  for (const [entityId, references] of dependents) {
    if (references.basis.endsWith(":widened")) affected.add(entityId);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [entityId, references] of dependents) {
      if (!affected.has(entityId) && references.ids.some((id) => affected.has(id))) {
        affected.add(entityId);
        changed = true;
      }
    }
  }
  const staleEntityIds: string[] = [];
  const preservedEntityIds: string[] = [];
  const updated = graph.entities.map((entity) => {
    if (
      affected.has(entity.id) &&
      entity.id !== knowledgeItemId &&
      (entity.type === "Rationale" || entity.type === "VerificationResult")
    ) {
      if (
        entity.status === "failed" ||
        entity.status === "blocked" ||
        entity.status === "waived" ||
        entity.status === "stale"
      ) {
        preservedEntityIds.push(entity.id);
        return entity;
      }
      staleEntityIds.push(entity.id);
      return { ...entity, revision: entity.revision + 1, status: "stale", staleReason: reason };
    }
    return entity;
  });
  return {
    graph: { ...graph, entities: updated },
    staleEntityIds,
    preservedEntityIds,
    traversalBasis,
  };
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
  libraryRevision?: string;
  projectionArtifactId?: string;
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
