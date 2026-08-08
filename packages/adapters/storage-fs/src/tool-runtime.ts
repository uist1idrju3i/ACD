import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProcessPort, ProcessResult, ProcessSpec } from "@acd/graph-core";
import { canonicalize } from "@acd/graph-core";
import type { ToolError, ToolRequest, ToolResult } from "@acd/schema";

export class NodeProcessPort implements ProcessPort {
  execute(spec: ProcessSpec): Promise<ProcessResult> {
    return new Promise((resolve) => {
      const child = spawn(spec.command, spec.args, {
        env: { ...process.env, ...spec.environment },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;
      let timedOut = false;
      let cancelled = false;
      const finish = (result: ProcessResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        spec.signal?.removeEventListener("abort", cancel);
        resolve(result);
      };
      const limit = (chunk: Buffer, target: "stdout" | "stderr"): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > spec.maxOutputBytes) {
          child.kill("SIGKILL");
          finish({
            kind: "failed",
            exitCode: null,
            signal: "SIGKILL",
            stdout,
            stderr,
            outputBytes,
          });
          return;
        }
        if (target === "stdout") stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      const cancel = (): void => {
        cancelled = true;
        child.kill("SIGTERM");
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, spec.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => limit(chunk, "stdout"));
      child.stderr.on("data", (chunk: Buffer) => limit(chunk, "stderr"));
      child.on("error", (error: Error) => {
        stderr += error.message;
        finish({ kind: "failed", exitCode: null, signal: null, stdout, stderr, outputBytes });
      });
      child.on("close", (exitCode, signal) => {
        const kind = timedOut
          ? "timedOut"
          : cancelled
            ? "cancelled"
            : exitCode === 0
              ? "completed"
              : "failed";
        finish({ kind, exitCode, signal, stdout, stderr, outputBytes });
      });
      if (spec.signal?.aborted) cancel();
      else spec.signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

export const runProcessSync = (
  command: string,
  args: string[],
  options: { cwd?: string; environment?: Readonly<Record<string, string>> } = {},
): string => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.environment },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw Object.assign(new Error(`${command} exited ${String(result.status)}`), {
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status ?? 1,
    });
  }
  return result.stdout;
};

type StoredInvocation = {
  idempotencyKey: string;
  correlationId: string;
  inputHash: string;
  status: "completed" | "failed";
  result?: ToolResult;
  error?: ToolError;
};

export class FileToolInvocationRegistry {
  private handle: FileHandle | undefined;
  private lock: FileHandle | undefined;
  private records: Map<string, StoredInvocation> | undefined;

  constructor(private readonly path: string) {}

  async execute(
    request: ToolRequest,
    operation: () => Promise<{ result?: ToolResult; error?: ToolError }>,
  ): Promise<{ result?: ToolResult; error?: ToolError }> {
    await this.load();
    const previous = this.records?.get(request.idempotencyKey);
    if (previous) {
      if (previous.inputHash !== request.inputHash) {
        return {
          error: {
            kind: "error",
            code: "reference-integrity",
            severity: "critical",
            message: "idempotency key was reused with a different input hash",
            retryable: false,
            recoverable: false,
            context: { idempotencyKey: request.idempotencyKey, inputHash: request.inputHash },
            evidenceIds: [],
          },
        };
      }
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
      status: outcome.result ? "completed" : "failed",
      ...(outcome.result ? { result: outcome.result } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    };
    await this.append(record);
    this.records?.set(request.idempotencyKey, record);
    return outcome;
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
      const content = await readFile(this.path, "utf8");
      for (const line of content.split("\n").filter(Boolean)) {
        const record = JSON.parse(line) as StoredInvocation;
        this.records.set(record.idempotencyKey, record);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async append(record: StoredInvocation): Promise<void> {
    if (!this.handle) {
      await mkdir(dirname(this.path), { recursive: true });
      this.lock = await open(`${this.path}.lock`, "wx");
      this.handle = await open(this.path, "a");
    }
    await this.handle.write(`${canonicalize(record)}\n`, undefined, "utf8");
    await this.handle.sync();
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
