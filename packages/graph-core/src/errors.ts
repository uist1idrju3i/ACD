export const ERROR_CODES = [
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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorSeverity = "warning" | "error" | "critical";

export class GraphCoreError extends Error {
  readonly name = "GraphCoreError";

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly severity: ErrorSeverity = "error",
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
