import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileToolInvocationRegistry, NodeProcessPort } from "./tool-runtime.js";

describe("NodeProcessPort", () => {
  it("records timeout and cancellation as result kinds", async () => {
    const port = new NodeProcessPort();
    const timedOut = await port.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 10,
      maxOutputBytes: 1024,
    });
    expect(timedOut.kind).toBe("timedOut");

    const controller = new AbortController();
    const pending = port.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending).kind).toBe("cancelled");
  });
});

describe("FileToolInvocationRegistry", () => {
  it("replays a stored outcome and rejects input hash collisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "acd-tool-registry-"));
    const registry = new FileToolInvocationRegistry(join(root, "run.jsonl"));
    const request = {
      toolName: "test",
      contractVersion: "0.1.0",
      inputHash: `sha256:${"a".repeat(64)}`,
      graphRevision: 1,
      correlationId: "correlation-1",
      idempotencyKey: "tool:test:1",
      operationClass: "read" as const,
      timeoutMs: 100,
      input: {},
    };
    let executions = 0;
    const error = {
      kind: "error" as const,
      code: "tool-failure" as const,
      severity: "error" as const,
      message: "expected test failure",
      retryable: false,
      recoverable: false,
      context: {},
      evidenceIds: [],
    };
    const first = await registry.execute(request, async () => {
      executions += 1;
      return { error };
    });
    const second = await registry.execute(request, async () => {
      executions += 1;
      return { error };
    });
    expect(second).toEqual(first);
    expect(executions).toBe(1);
    const collision = await registry.execute(
      { ...request, inputHash: `sha256:${"b".repeat(64)}` },
      async () => ({ error }),
    );
    expect(collision.error?.code).toBe("reference-integrity");
    await registry.close();
    await rm(root, { recursive: true, force: true });
  });
});
