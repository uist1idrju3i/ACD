import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProcessPort, ProcessResult, ProcessSpec } from "@acd/graph-core";
import { canonicalize, GraphCoreError } from "@acd/graph-core";
import type { ToolError, ToolRequest, ToolResult } from "@acd/schema";

export class NodeProcessPort implements ProcessPort {
  execute(spec: ProcessSpec): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const child = spawn(spec.command, spec.args, {
        ...(spec.cwd ? { cwd: spec.cwd } : {}),
        env: { ...process.env, ...spec.environment },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let outputBytes = 0;
      let timedOut = false;
      let cancelled = false;
      let outputLimitExceeded = false;
      let termSent = false;
      let settled = false;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      const outputText = (): { stdout: string; stderr: string } => ({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
      const terminate = (): void => {
        if (termSent) return;
        termSent = true;
        child.kill("SIGTERM");
        graceTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, spec.killGraceMs);
      };
      const cancel = (): void => {
        cancelled = true;
        terminate();
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, spec.timeoutMs);
      const finish = (result: ProcessResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (graceTimer) clearTimeout(graceTimer);
        spec.signal?.removeEventListener("abort", cancel);
        resolve(result);
      };
      const collect = (chunk: Buffer, target: "stdout" | "stderr"): void => {
        outputBytes += chunk.byteLength;
        if (target === "stdout") stdoutChunks.push(chunk);
        else stderrChunks.push(chunk);
        if (outputBytes > spec.maxOutputBytes) {
          outputLimitExceeded = true;
          terminate();
        }
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
      child.on("error", (error: Error) => {
        stderrChunks.push(Buffer.from(error.message, "utf8"));
      });
      child.on("close", (exitCode, signal) => {
        const output = outputText();
        finish({
          kind: timedOut
            ? "timedOut"
            : cancelled
              ? "cancelled"
              : outputLimitExceeded
                ? "failed"
                : exitCode === 0
                  ? "completed"
                  : "failed",
          exitCode,
          signal,
          stdout: output.stdout,
          stderr: output.stderr,
          outputBytes,
        });
      });
      if (spec.signal?.aborted) cancel();
      else spec.signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

type StoredInvocation = {
  idempotencyKey: string;
  correlationId: string;
  inputHash: string;
  status: "completed" | "timedOut" | "cancelled" | "failed";
  result?: ToolResult;
  error?: ToolError;
};

export type ToolObservationContext = {
  runId?: string;
  taskId?: string;
  attempt?: number;
};

export type ToolObservation = {
  kind: "logical-request" | "registry-replay" | "external-process-started";
} & ToolObservationContext;

export type ToolObservationHook = (observation: ToolObservation) => void;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStoredInvocation = (value: unknown): value is StoredInvocation => {
  if (!isRecord(value)) return false;
  if (
    typeof value.idempotencyKey !== "string" ||
    typeof value.correlationId !== "string" ||
    typeof value.inputHash !== "string" ||
    (value.status !== "completed" &&
      value.status !== "timedOut" &&
      value.status !== "cancelled" &&
      value.status !== "failed")
  )
    return false;
  return value.status === "completed" || value.status === "cancelled"
    ? isRecord(value.result)
    : isRecord(value.error);
};

export class FileToolInvocationRegistry {
  private handle: FileHandle | undefined;
  private lock: FileHandle | undefined;
  private records: Map<string, StoredInvocation> | undefined;

  constructor(
    private readonly path: string,
    private readonly observe?: ToolObservationHook,
  ) {}

  async execute(
    request: ToolRequest,
    operation: () => Promise<{
      result?: ToolResult;
      error?: ToolError;
      status?: StoredInvocation["status"];
    }>,
    context: ToolObservationContext = {},
  ): Promise<{ result?: ToolResult; error?: ToolError }> {
    try {
      await this.load();
      this.observe?.({ kind: "logical-request", ...context });
      const previous = this.records?.get(request.idempotencyKey);
      if (previous) {
        if (previous.inputHash !== request.inputHash) {
          throw new GraphCoreError(
            "reference-integrity",
            "idempotency key was reused with a different input hash",
            "critical",
            { idempotencyKey: request.idempotencyKey, inputHash: request.inputHash },
          );
        }
        this.observe?.({ kind: "registry-replay", ...context });
        return {
          ...(previous.result ? { result: previous.result } : {}),
          ...(previous.error ? { error: previous.error } : {}),
        };
      }
      const outcome = await operation();
      const record: StoredInvocation = {
        idempotencyKey: request.idempotencyKey,
        correlationId: request.correlationId,
        inputHash: request.inputHash,
        status: outcome.status ?? (outcome.result ? "completed" : "failed"),
        ...(outcome.result ? { result: outcome.result } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      };
      await this.append(record);
      this.records?.set(request.idempotencyKey, record);
      return outcome;
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    await this.handle?.close();
    await this.lock?.close();
    this.handle = undefined;
    if (this.lock) {
      this.lock = undefined;
      try {
        await unlink(`${this.path}.lock`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async load(): Promise<void> {
    if (this.records) return;
    this.records = new Map();
    try {
      const bytes = await readFile(this.path);
      const lastNewline = bytes.lastIndexOf(0x0a);
      const complete = bytes.subarray(0, lastNewline + 1);
      await this.openWriter();
      if (complete.length !== bytes.length) {
        await this.handle?.truncate(complete.length);
        await this.handle?.sync();
      }
      for (const [index, line] of complete.toString("utf8").split("\n").filter(Boolean).entries()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line) as unknown;
        } catch (error) {
          throw new GraphCoreError(
            "event-replay-failure",
            `invalid tool registry JSON at line ${index + 1}`,
            "critical",
            { cause: error instanceof Error ? error.message : String(error) },
          );
        }
        if (!isStoredInvocation(parsed)) {
          throw new GraphCoreError(
            "event-replay-failure",
            `invalid tool registry record at line ${index + 1}`,
            "critical",
          );
        }
        this.records.set(parsed.idempotencyKey, parsed);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async openWriter(): Promise<void> {
    if (this.handle) return;
    await mkdir(dirname(this.path), { recursive: true });
    this.lock = await open(`${this.path}.lock`, "wx");
    this.handle = await open(this.path, "a+");
  }

  private async append(record: StoredInvocation): Promise<void> {
    await this.openWriter();
    await this.handle?.write(`${canonicalize(record)}\n`, undefined, "utf8");
    await this.handle?.sync();
  }
}

export class ToolBoundary {
  constructor(
    private readonly process: ProcessPort,
    private readonly registry: FileToolInvocationRegistry,
    private readonly observe?: ToolObservationHook,
  ) {}

  async execute(
    request: ToolRequest,
    spec: ProcessSpec,
    metadata: {
      toolVersion: string;
      containerVersion: string;
      provenance: ToolResult["provenance"];
    },
    context: ToolObservationContext = {},
  ): Promise<ToolResult> {
    const outcome = await this.registry.execute(
      request,
      async () => {
        this.observe?.({ kind: "external-process-started", ...context });
        const startedAt = new Date().toISOString();
        const processResult = await this.process.execute(spec);
        const endedAt = new Date().toISOString();
        const outputHash = `sha256:${createHash("sha256")
          .update(`${processResult.stdout}${processResult.stderr}`)
          .digest("hex")}`;
        if (processResult.kind === "completed") {
          return {
            result: {
              kind: "result",
              ...request,
              status: "completed",
              startedAt,
              endedAt,
              toolVersion: metadata.toolVersion,
              containerVersion: metadata.containerVersion,
              provenance: metadata.provenance,
              artifactIds: [],
              evidenceIds: [],
              rawOutputHash: outputHash,
              normalizedOutputHash: outputHash,
              outputBytes: processResult.outputBytes,
              exitCode: processResult.exitCode,
              signal: processResult.signal,
              stdout: processResult.stdout,
              stderr: processResult.stderr,
              retryable: false,
              recoverable: true,
            },
          };
        }
        if (processResult.kind === "cancelled") {
          return {
            status: "cancelled",
            result: {
              kind: "result",
              ...request,
              status: "cancelled",
              startedAt,
              endedAt,
              toolVersion: metadata.toolVersion,
              containerVersion: metadata.containerVersion,
              provenance: metadata.provenance,
              artifactIds: [],
              evidenceIds: [],
              rawOutputHash: outputHash,
              normalizedOutputHash: outputHash,
              outputBytes: processResult.outputBytes,
              exitCode: processResult.exitCode,
              signal: processResult.signal,
              stdout: processResult.stdout,
              stderr: processResult.stderr,
              retryable: false,
              recoverable: false,
            },
          };
        }
        const status = processResult.kind === "timedOut" ? "timedOut" : "failed";
        return {
          status,
          error: {
            kind: "error",
            code: processResult.kind === "timedOut" ? "tool-timeout" : "tool-failure",
            severity: "error",
            message: `tool process ${processResult.kind}`,
            retryable: processResult.kind === "timedOut",
            recoverable: false,
            context: {
              processKind: processResult.kind,
              exitCode: processResult.exitCode,
              signal: processResult.signal,
              stdout: processResult.stdout,
              stderr: processResult.stderr,
              outputBytes: processResult.outputBytes,
            },
            evidenceIds: [],
          },
        };
      },
      context,
    );
    if (outcome.error) {
      const code = outcome.error.code === "tool-timeout" ? "tool-timeout" : "tool-failure";
      throw new GraphCoreError(code, outcome.error.message, "error", outcome.error.context);
    }
    if (!outcome.result) throw new Error("tool boundary returned no result or error");
    return outcome.result;
  }
}

export const toolFailure = (
  message: string,
  context: Record<string, unknown>,
  retryable = false,
): ToolError => ({
  kind: "error",
  code: "tool-failure",
  severity: "error",
  message,
  retryable,
  recoverable: false,
  context,
  evidenceIds: [],
});
