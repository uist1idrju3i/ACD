import type {
  FabFeedbackReport as SchemaFabFeedbackReport,
  RawFinding,
  Reference,
} from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { createEvent, type EventEnvelope } from "./event-log.js";
import { rulesForFabProfile, type FabProfileRules } from "./fab-profile-rules.js";
import { sha256 } from "./hash.js";

export type FabFeedbackReport = Omit<SchemaFabFeedbackReport, "source"> & {
  source: {
    kind: "fixture" | "live";
    locator: string;
    contentHash: string;
    fixtureDerived: boolean;
    fixtureId?: string;
  };
};

export type FabFeedbackVerdict = "pass" | "unknown";

export type FabFeedbackReferenceIndex = {
  projectId: string;
  designRevision: string;
  entityIds: ReadonlySet<string>;
};

export type FabFeedbackFinding = {
  findingId: string;
  originalText: string;
  severityReported: RawFinding["severityReported"];
  references: Reference;
  classification:
    | "mask-clearance"
    | "pad-geometry"
    | "courtyard-clearance"
    | "drill"
    | "silkscreen"
    | "spacing"
    | "solderability"
    | "unknown";
  confidence: number;
  reproductionConditions: string[];
  duplicateFindingIds: string[];
  verdict: FabFeedbackVerdict;
};

export type FabFeedbackEvidence = {
  evidenceKind: "fab-feedback";
  claim: string;
  value: {
    reportId: string;
    fixtureDerived: boolean;
    countBefore: number;
    countAfter: number;
    unificationKey: string;
    unknownFindingIds: string[];
    derivationInputHash: string;
    derivationOutputHash: string;
  };
};

export type FabFeedbackIntakeResult = {
  verdict: FabFeedbackVerdict;
  findings: FabFeedbackFinding[];
  evidence: FabFeedbackEvidence;
  derivationHash: string;
  derivation: {
    method: string;
    version: string;
    inputHash: string;
    outputHash: string;
  };
};

export const fabFeedbackUnknownError = (findingIds: string[]): GraphCoreError =>
  new GraphCoreError(
    "fab-feedback-unknown",
    `fab feedback contains unknown findings: ${findingIds.join(", ")}`,
    "warning",
    { action: "widen-verification", findingIds },
  );

const referenceValues = (reference: Reference): string[] =>
  [
    reference.partId,
    reference.netId,
    reference.footprintId,
    reference.ruleId,
    reference.coordinate?.xMm,
    reference.coordinate?.yMm,
  ].map((value) => String(value ?? ""));

const unificationKey = (
  finding: RawFinding,
  classification: FabFeedbackFinding["classification"],
): string => [classification, ...referenceValues(finding.references)].join("|");

const assertSourceProvenance = (report: FabFeedbackReport): void => {
  if (
    report.source.kind === "fixture" &&
    (!report.source.fixtureDerived || !report.source.fixtureId)
  ) {
    throw new GraphCoreError(
      "schema-invalid",
      "fixture fab feedback must carry an explicit fixture provenance marker",
    );
  }
  if (report.source.kind === "live" && report.source.fixtureDerived) {
    throw new GraphCoreError(
      "schema-invalid",
      "live fab feedback must not be marked fixture-derived",
    );
  }
};

const assertUniqueFindingIds = (report: FabFeedbackReport): void => {
  const ids = new Set<string>();
  for (const finding of report.rawFindings) {
    if (ids.has(finding.findingId)) {
      throw new GraphCoreError(
        "schema-invalid",
        `fab feedback report contains duplicate finding ID: ${finding.findingId}`,
        "error",
        { findingId: finding.findingId },
      );
    }
    ids.add(finding.findingId);
  }
};

const assertTarget = (report: FabFeedbackReport, index: FabFeedbackReferenceIndex): void => {
  if (
    report.target.projectId !== index.projectId ||
    report.target.designRevision !== index.designRevision
  ) {
    throw new GraphCoreError(
      "reference-integrity",
      "fab feedback target does not match the design revision",
      "error",
      {
        expectedProjectId: index.projectId,
        expectedDesignRevision: index.designRevision,
        actualTarget: report.target,
      },
    );
  }
};

const assertReferences = (finding: RawFinding, index: FabFeedbackReferenceIndex): void => {
  for (const [kind, id] of Object.entries(finding.references)) {
    if (kind === "coordinate" || kind === "ruleId" || id === undefined) continue;
    if (!index.entityIds.has(id as string)) {
      throw new GraphCoreError(
        "verification-failed",
        `fab feedback finding references an entity outside the target revision: ${id}`,
        "error",
        { findingId: finding.findingId, referenceKind: kind, referenceId: id },
      );
    }
  }
};

export const resolveFabProfileRule = (
  finding: Pick<RawFinding, "originalText" | "references">,
  profile: FabProfileRules,
): FabProfileRules["rules"][number] | undefined => {
  const normalizedText = finding.originalText.toLowerCase();
  return finding.references.ruleId
    ? profile.rules.find((candidate) => candidate.ruleId === finding.references.ruleId)
    : profile.rules.find((candidate) =>
        candidate.textPatterns.some((pattern) => normalizedText.includes(pattern)),
      );
};

const deriveFinding = (
  finding: RawFinding,
  profile: FabProfileRules,
): Pick<FabFeedbackFinding, "classification" | "confidence" | "reproductionConditions"> => {
  const rule = resolveFabProfileRule(finding, profile);
  if (!rule) {
    return {
      classification: "unknown",
      confidence: 0,
      reproductionConditions: [],
    };
  }
  return rule;
};

export const intakeFabFeedback = (
  report: FabFeedbackReport,
  index: FabFeedbackReferenceIndex,
  profileRules = rulesForFabProfile(report.fabProfileId),
): FabFeedbackIntakeResult => {
  assertSourceProvenance(report);
  assertTarget(report, index);
  assertUniqueFindingIds(report);
  if (!profileRules) {
    throw new GraphCoreError(
      "schema-invalid",
      `fab profile is not declared: ${report.fabProfileId}`,
    );
  }
  const profile: FabProfileRules = profileRules;
  const findingsByKey = new Map<string, FabFeedbackFinding>();
  for (const finding of report.rawFindings) {
    assertReferences(finding, index);
    const derived = deriveFinding(finding, profile);
    const isUnknown =
      derived.classification === "unknown" || derived.confidence < profile.confidenceFloor;
    const result: FabFeedbackFinding = {
      findingId: finding.findingId,
      originalText: finding.originalText,
      severityReported: finding.severityReported,
      references: finding.references,
      classification: derived.classification,
      confidence: derived.confidence,
      reproductionConditions: derived.reproductionConditions,
      duplicateFindingIds: [],
      verdict: isUnknown ? "unknown" : "pass",
    };
    const key =
      derived.classification === "unknown"
        ? `unknown|findingId|${finding.findingId}`
        : unificationKey(finding, derived.classification);
    const existing = findingsByKey.get(key);
    if (existing) {
      existing.duplicateFindingIds.push(result.findingId);
    } else {
      findingsByKey.set(key, result);
    }
  }

  const findings = [...findingsByKey.values()].sort((left, right) =>
    left.findingId.localeCompare(right.findingId),
  );
  const unknownFindingIds = findings
    .filter((finding) => finding.verdict === "unknown")
    .flatMap((finding) => [finding.findingId, ...finding.duplicateFindingIds]);
  const derivationInputHash = sha256({
    fabProfileId: report.fabProfileId,
    rawReport: report.rawReport,
    rawFindings: report.rawFindings,
  });
  const derivationOutputHash = sha256({
    fabProfileId: report.fabProfileId,
    rulesVersion: profile.version,
    findings,
  });
  if (report.derivation) {
    if (
      report.derivation.inputHash !== derivationInputHash ||
      report.derivation.outputHash !== derivationOutputHash ||
      report.derivation.version !== profile.version
    ) {
      throw new GraphCoreError(
        "verification-failed",
        "fab feedback derivation metadata does not match deterministic derivation",
        "error",
        {
          expectedInputHash: derivationInputHash,
          expectedOutputHash: derivationOutputHash,
          actualDerivation: report.derivation,
        },
      );
    }
  }
  const evidence: FabFeedbackEvidence = {
    evidenceKind: "fab-feedback",
    claim:
      "Fab findings were deterministically unified and classified without treating fixture data as real-fab evidence.",
    value: {
      reportId: report.reportId,
      fixtureDerived: report.source.fixtureDerived,
      countBefore: report.rawFindings.length,
      countAfter: findings.length,
      unificationKey: "classification|partId|netId|footprintId|ruleId|coordinate",
      unknownFindingIds,
      derivationInputHash,
      derivationOutputHash,
    },
  };
  return {
    verdict: findings.some((finding) => finding.verdict === "unknown") ? "unknown" : "pass",
    findings,
    evidence,
    derivationHash: derivationOutputHash,
    derivation: {
      method: "fab-profile-rule-classifier",
      version: profile.version,
      inputHash: derivationInputHash,
      outputHash: derivationOutputHash,
    },
  };
};

export type FabFeedbackReceivedPayload = {
  reportId: string;
  fabJobId: string;
  fabProfileId: string;
  source: FabFeedbackReport["source"];
  target: FabFeedbackReport["target"];
  intake: FabFeedbackIntakeResult;
};

export const createFabFeedbackReceivedEvent = (input: {
  eventId: string;
  occurredAt: string;
  actor: string;
  projectId: string;
  baseRevision: number;
  resultRevision: number;
  report: FabFeedbackReport;
  intake: FabFeedbackIntakeResult;
}): EventEnvelope & { type: "fab.feedback.received"; payload: FabFeedbackReceivedPayload } =>
  createEvent({
    eventId: input.eventId,
    type: "fab.feedback.received",
    occurredAt: input.occurredAt,
    actor: input.actor,
    projectId: input.projectId,
    baseRevision: input.baseRevision,
    resultRevision: input.resultRevision,
    payload: {
      reportId: input.report.reportId,
      fabJobId: input.report.fabJobId,
      fabProfileId: input.report.fabProfileId,
      source: input.report.source,
      target: input.report.target,
      intake: input.intake,
    },
  }) as EventEnvelope & {
    type: "fab.feedback.received";
    payload: FabFeedbackReceivedPayload;
  };
