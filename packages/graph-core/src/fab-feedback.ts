import type {
  FabFeedbackReport as SchemaFabFeedbackReport,
  RawFinding,
  Reference,
  StructuredFinding,
} from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { createEvent, type EventEnvelope } from "./event-log.js";
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
  classification: StructuredFinding["classification"];
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
  };
};

export type FabFeedbackIntakeResult = {
  verdict: FabFeedbackVerdict;
  findings: FabFeedbackFinding[];
  evidence: FabFeedbackEvidence;
  derivationHash: string;
};

const referenceValues = (reference: Reference): string[] =>
  [
    reference.partId,
    reference.netId,
    reference.footprintId,
    reference.ruleId,
    reference.coordinate?.xMm,
    reference.coordinate?.yMm,
  ].map((value) => String(value ?? ""));

const unificationKey = (finding: FabFeedbackFinding, structured: StructuredFinding): string =>
  [
    structured.classification,
    ...referenceValues(finding.references),
    finding.originalText.trim().toLowerCase(),
  ].join("|");

const structuredById = (report: FabFeedbackReport): Map<string, StructuredFinding> =>
  new Map(report.structuredFindings.map((finding) => [finding.findingId, finding]));

const rawById = (report: FabFeedbackReport): Map<string, RawFinding> =>
  new Map(report.rawFindings.map((finding) => [finding.findingId, finding]));

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

export const intakeFabFeedback = (
  report: FabFeedbackReport,
  index: FabFeedbackReferenceIndex,
  confidenceFloor = 0.8,
): FabFeedbackIntakeResult => {
  assertSourceProvenance(report);
  assertTarget(report, index);
  const raw = rawById(report);
  const structured = structuredById(report);
  const findingsByKey = new Map<string, FabFeedbackFinding>();
  for (const finding of report.rawFindings) {
    assertReferences(finding, index);
    const derived = structured.get(finding.findingId);
    if (!derived) {
      throw new GraphCoreError(
        "schema-invalid",
        `fab feedback finding has no deterministic structured derivation: ${finding.findingId}`,
      );
    }
    const isUnknown = derived.classification === "unknown" || derived.confidence < confidenceFloor;
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
    const key = unificationKey(result, derived);
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
  const evidence: FabFeedbackEvidence = {
    evidenceKind: "fab-feedback",
    claim:
      "Fab findings were deterministically unified and classified without treating fixture data as real-fab evidence.",
    value: {
      reportId: report.reportId,
      fixtureDerived: report.source.fixtureDerived,
      countBefore: raw.size,
      countAfter: findings.length,
      unificationKey:
        "classification|partId|netId|footprintId|ruleId|coordinate|normalizedOriginalText",
      unknownFindingIds,
    },
  };
  return {
    verdict: findings.some((finding) => finding.verdict === "unknown") ? "unknown" : "pass",
    findings,
    evidence,
    derivationHash: sha256({
      reportId: report.reportId,
      findings,
      evidence,
    }),
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
