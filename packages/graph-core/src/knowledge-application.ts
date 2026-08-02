import { rulesForFabProfile, type ApplicabilityCondition } from "./fab-profile-rules.js";
import {
  evaluateKnowledgeApplicability,
  type ApplicabilityContext,
  type KnowledgeApplicability,
  type KnowledgeItem,
} from "./knowledge-lifecycle.js";
import { GraphCoreError } from "./errors.js";

export type KnowledgeApplicationDecisionStatus = "pass" | "fail" | "unknown" | "not-applicable";

export type KnowledgeApplicationDecision = {
  knowledgeItemId: string;
  knowledgeId: string;
  lifecycleStatus: KnowledgeItem["status"];
  status: KnowledgeApplicationDecisionStatus;
  applied: boolean;
  applicability?: KnowledgeApplicability;
  libraryRevision?: string;
  applicationExemption?: string;
  explanation?: {
    text: string;
    basis: "commentary-only";
  };
};

export type KnowledgeApplicationContext = ApplicabilityContext & {
  designRevision: string;
  fabProfileId: string;
  footprintIds: string[];
  ruleIds?: string[];
  classifications?: string[];
  reproductionConditions: string[];
};

export type KnowledgeApplicationResult = {
  decisions: KnowledgeApplicationDecision[];
  applicableKnowledgeIds: string[];
  libraryRevisions: string[];
  noApplicableKnowledge?: {
    kind: "no-applicable-knowledge";
    evaluatedItemCount: number;
  };
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
  const profileId = item.appliesWhen.find((condition) => condition.field === "fabProfileId")?.value;
  const ruleId =
    item.appliesWhen.find((condition) => condition.field === "ruleId")?.value ??
    item.provenance.find((entry) => entry.ruleId)?.ruleId;
  const rule =
    profileId && ruleId
      ? rulesForFabProfile(profileId)?.rules.find((candidate) => candidate.ruleId === ruleId)
      : undefined;
  return {
    knowledgeItemId: item.id,
    knowledgeId: item.knowledgeId,
    lifecycleStatus: item.status,
    status: item.status === "adopted" ? applicability : "not-applicable",
    applied: false,
    applicability,
    ...(rule?.applicationExemption ? { applicationExemption: rule.applicationExemption } : {}),
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
  return {
    decisions,
    applicableKnowledgeIds: applicable.map((decision) => decision.knowledgeId),
    libraryRevisions: [],
    ...(applicable.length === 0
      ? {
          noApplicableKnowledge: {
            kind: "no-applicable-knowledge" as const,
            evaluatedItemCount: items.length,
          },
        }
      : {}),
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
      !decision.applied &&
      !decision.applicationExemption,
  );
  if (missing.length > 0) {
    throw new GraphCoreError(
      "verification-failed",
      `adopted knowledge was not applied before ${downstream}: ${missing
        .map((decision) => decision.knowledgeId)
        .join(", ")}`,
    );
  }
  if (result.decisions.length === 0 && !result.noApplicableKnowledge) {
    throw new GraphCoreError("verification-failed", "knowledge application decisions are missing");
  }
};

export const createTargetDesignKnowledgeContext = (input: {
  designRevision: string;
  fabProfileId: string;
  footprintIds: string[];
  ruleIds?: string[];
  classifications?: string[];
  reproductionConditions: string[];
  partIds?: string[];
}): KnowledgeApplicationContext => ({
  designRevision: input.designRevision,
  fabProfileId: input.fabProfileId,
  footprintIds: input.footprintIds,
  reproductionConditions: input.reproductionConditions,
  footprintId: input.footprintIds,
  reproductionCondition: input.reproductionConditions,
  ...(input.ruleIds?.length ? { ruleIds: input.ruleIds, ruleId: input.ruleIds } : {}),
  ...(input.classifications?.length
    ? { classifications: input.classifications, classification: input.classifications }
    : {}),
  ...(input.partIds?.length ? { partId: input.partIds } : {}),
});
