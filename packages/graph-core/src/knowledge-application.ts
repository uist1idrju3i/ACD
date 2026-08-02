import type { ApplicabilityCondition } from "./fab-profile-rules.js";
import {
  evaluateKnowledgeApplicability,
  type ApplicabilityContext,
  type KnowledgeItem,
} from "./knowledge-lifecycle.js";
import { GraphCoreError } from "./errors.js";

export type KnowledgeApplicationDecisionStatus =
  | "pass"
  | "fail"
  | "unknown"
  | "no-applicable-knowledge";

export type KnowledgeApplicationDecision = {
  knowledgeItemId: string;
  knowledgeId: string;
  lifecycleStatus: KnowledgeItem["status"];
  status: KnowledgeApplicationDecisionStatus;
  applied: boolean;
  libraryRevision?: string;
  explanation?: {
    text: string;
    basis: "commentary-only";
  };
};

export type KnowledgeApplicationContext = ApplicabilityContext & {
  designRevision: string;
  fabProfileId: string;
  footprintIds: string[];
  ruleIds: string[];
  classifications: string[];
  reproductionConditions: string[];
};

export type KnowledgeApplicationResult = {
  decisions: KnowledgeApplicationDecision[];
  applicableKnowledgeIds: string[];
  libraryRevisions: string[];
};

const conditionFields: ApplicabilityCondition["field"][] = [
  "fabProfileId",
  "partId",
  "footprintId",
  "ruleId",
  "classification",
  "reproductionCondition",
];

const normalizeContext = (context: KnowledgeApplicationContext): ApplicabilityContext => {
  const normalized: ApplicabilityContext = { ...context };
  for (const field of conditionFields) {
    const value = context[field];
    if (value !== undefined) normalized[field] = value;
  }
  return normalized;
};

const decisionForItem = (
  item: KnowledgeItem,
  context: ApplicabilityContext,
): KnowledgeApplicationDecision => {
  const applicability = evaluateKnowledgeApplicability(item, context);
  if (item.status !== "adopted") {
    return {
      knowledgeItemId: item.id,
      knowledgeId: item.knowledgeId,
      lifecycleStatus: item.status,
      status: applicability,
      applied: false,
    };
  }
  return {
    knowledgeItemId: item.id,
    knowledgeId: item.knowledgeId,
    lifecycleStatus: item.status,
    status: applicability,
    applied: false,
  };
};

export const evaluateKnowledgeApplications = (
  items: KnowledgeItem[],
  context: KnowledgeApplicationContext,
): KnowledgeApplicationResult => {
  const normalizedContext = normalizeContext(context);
  const decisions = [...items]
    .sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId))
    .map((item) => decisionForItem(item, normalizedContext));
  const applicable = decisions.filter(
    (decision) =>
      decision.lifecycleStatus === "adopted" &&
      (decision.status === "pass" || decision.status === "unknown"),
  );
  if (applicable.length === 0) {
    decisions.push({
      knowledgeItemId: "knowledge:none",
      knowledgeId: "knowledge:none",
      lifecycleStatus: "rejected",
      status: "no-applicable-knowledge",
      applied: false,
    });
  }
  return {
    decisions,
    applicableKnowledgeIds: applicable.map((decision) => decision.knowledgeId),
    libraryRevisions: [],
  };
};

export const recordKnowledgeApplications = (
  result: KnowledgeApplicationResult,
  applications: Array<{ knowledgeId: string; libraryRevision?: string }>,
): KnowledgeApplicationResult => {
  const byKnowledgeId = new Map(
    applications.map((application) => [application.knowledgeId, application]),
  );
  const decisions = result.decisions.map((decision) => {
    const application = byKnowledgeId.get(decision.knowledgeId);
    return application
      ? {
          ...decision,
          applied: true,
          ...(application.libraryRevision ? { libraryRevision: application.libraryRevision } : {}),
        }
      : decision;
  });
  return {
    ...result,
    decisions,
    libraryRevisions: [
      ...new Set(
        decisions.flatMap((decision) =>
          decision.libraryRevision ? [decision.libraryRevision] : [],
        ),
      ),
    ],
  };
};

export const assertKnowledgeApplicationsComplete = (
  result: KnowledgeApplicationResult,
  downstream: "projection" | "verification" | "manufacturing",
): void => {
  const missing = result.decisions.filter(
    (decision) =>
      decision.lifecycleStatus === "adopted" &&
      (decision.status === "pass" || decision.status === "unknown") &&
      !decision.applied,
  );
  if (missing.length > 0) {
    throw new GraphCoreError(
      "verification-failed",
      `adopted knowledge was not applied before ${downstream}: ${missing
        .map((decision) => decision.knowledgeId)
        .join(", ")}`,
    );
  }
  if (
    !result.decisions.some((decision) => decision.status === "no-applicable-knowledge") &&
    result.decisions.length === 0
  ) {
    throw new GraphCoreError("verification-failed", "knowledge application decisions are missing");
  }
};

export const createTargetDesignKnowledgeContext = (input: {
  designRevision: string;
  fabProfileId: string;
  footprintIds: string[];
  ruleIds: string[];
  classifications: string[];
  reproductionConditions: string[];
  partIds?: string[];
}): KnowledgeApplicationContext => ({
  ...input,
  partId: input.partIds ?? [],
  footprintId: input.footprintIds,
  ruleId: input.ruleIds,
  classification: input.classifications,
  reproductionCondition: input.reproductionConditions,
});
