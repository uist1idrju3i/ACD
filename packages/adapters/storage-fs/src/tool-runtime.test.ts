import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileToolInvocationRegistry, NodeProcessPort, ToolBoundary } from "./tool-runtime.js";

describe("NodeProcessPort", () => {
  it("decodes UTF-8 correctly when a multibyte character spans chunks", async () => {
    const result = await new NodeProcessPort().execute({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82,0xac])), 10)",
      ],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      killGraceMs: 50,
    });
    expect(result.kind).toBe("completed");
    expect(result.stdout).toBe("€");
  });

  it("records timeout and cancellation as result kinds", async () => {
    const port = new NodeProcessPort();
    const timedOut = await port.execute({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 10,
      maxOutputBytes: 1024,
      killGraceMs: 50,
    });
    expect(timedOut.kind).toBe("timedOut");

    const controller = new AbortController();
    const pending = port.execute({
      command: "/bin/sh",
      args: ["-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      killGraceMs: 50,
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending).kind).toBe("cancelled");
  });

  it("escalates a timeout to SIGKILL after the grace period", async () => {
    const result = await new NodeProcessPort().execute({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      timeoutMs: 10,
      maxOutputBytes: 1024,
      killGraceMs: 0,
    });
    expect(result.kind).toBe("timedOut");
    expect(result.signal).toBe("SIGKILL");
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
    await expect(
      registry.execute({ ...request, inputHash: `sha256:${"b".repeat(64)}` }, async () => ({
        error,
      })),
    ).rejects.toMatchObject({ code: "reference-integrity" });
    await registry.close();
    await rm(root, { recursive: true, force: true });
  });

  it("does not rerun a real process on envelope replay", async () => {
    const root = await mkdtemp(join(tmpdir(), "acd-tool-boundary-"));
    const registry = new FileToolInvocationRegistry(join(root, "tool-invocations.jsonl"));
    const boundary = new ToolBoundary(new NodeProcessPort(), registry);
    const request = {
      toolName: "node.test",
      contractVersion: "0.1.0",
      inputHash: `sha256:${"c".repeat(64)}`,
      graphRevision: 0,
      correlationId: "correlation-real",
      idempotencyKey: "tool:node.test:once",
      operationClass: "reversible" as const,
      timeoutMs: 1000,
      input: { marker: "once" },
    };
    const spec = {
      command: process.execPath,
      args: ["-e", "process.stdout.write('one')"],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      killGraceMs: 50,
    };
    const metadata = {
      toolVersion: process.version,
      containerVersion: "test",
      provenance: [{ kind: "tool-output" as const, locator: "node.test" }],
    };
    const first = await boundary.execute(request, spec, metadata);
    const second = await boundary.execute(request, spec, metadata);
    expect(second).toEqual(first);
    expect(second.stdout).toBe("one");
    await registry.close();
    await rm(root, { recursive: true, force: true });
  });

  it("stops on a mid-stream corrupt record", async () => {
    const root = await mkdtemp(join(tmpdir(), "acd-tool-corrupt-"));
    const path = join(root, "tool-invocations.jsonl");
    await (
      await import("node:fs/promises")
    ).writeFile(
      path,
      '{"idempotencyKey":"x","correlationId":"c","inputHash":"h","status":"completed","result":{}}\nnot-json\n',
    );
    const registry = new FileToolInvocationRegistry(path);
    await expect(
      registry.execute(
        {
          toolName: "test",
          contractVersion: "0.1.0",
          inputHash: `sha256:${"a".repeat(64)}`,
          graphRevision: 0,
          correlationId: "c",
          idempotencyKey: "new",
          operationClass: "read",
          timeoutMs: 100,
          input: {},
        },
        async () => ({ error: toolFailureForTest() }),
      ),
    ).rejects.toMatchObject({ code: "event-replay-failure" });
    await rm(root, { recursive: true, force: true });
  });
});

const toolFailureForTest = () => ({
  kind: "error" as const,
  code: "tool-failure" as const,
  severity: "error" as const,
  message: "test",
  retryable: false,
  recoverable: false,
  context: {},
  evidenceIds: [],
});
