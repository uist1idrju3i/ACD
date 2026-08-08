import type { StopRecord } from "@acd/schema";
import { GraphCoreError, type ErrorCode } from "./errors.js";

export type StopRecordInput = StopRecord;

export const buildStopRecord = (input: StopRecordInput): StopRecord => {
  validateStopRecord(input);
  return structuredClone(input);
};

export const validateStopRecord = (record: StopRecord): void => {
  const reasonCodes: ErrorCode[] = [
    "schema-invalid",
    "reference-integrity",
    "patch-conflict",
    "revision-invalid",
    "event-replay-failure",
    "stale-result",
    "verification-failed",
    "reopen-failure",
    "tool-timeout",
    "tool-failure",
    "fab-feedback-unknown",
    "convergence-failure",
    "license-restriction",
    "approval-required",
    "budget-exceeded",
    "unknown-impact",
    "patent-concern",
  ];
  if (!reasonCodes.includes(record.reasonCode as ErrorCode)) {
    throw new GraphCoreError("schema-invalid", `invalid stop reason: ${record.reasonCode}`);
  }
  if (
    record.knownFacts.length === 0 ||
    record.uncertainties.length === 0 ||
    record.options.length === 0 ||
    !record.recommendation ||
    !record.resumeCondition ||
    record.evidenceIds.length === 0
  ) {
    throw new GraphCoreError("schema-invalid", "stop record is missing required decision context");
  }
  if (
    record.resumePosition.checkpointId === undefined &&
    record.resumePosition.eventPosition === undefined
  ) {
    throw new GraphCoreError("schema-invalid", "stop record has no resume position");
  }
};
