export type ErrorCode =
  | "schema-invalid"
  | "reference-integrity"
  | "patch-conflict"
  | "revision-invalid"
  | "event-replay-failure"
  | "stale-result";

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
