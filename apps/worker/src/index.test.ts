import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { attachVerificationResultIds, createWorkerServer, readJson } from "./index.js";
import type { DesignGraph } from "@acd/graph-core";

const fixtureRoot = resolve(import.meta.dirname, "../../../fixtures/phase4/wp6-browser-run");

const fixtureGraph = async (): Promise<DesignGraph> =>
  JSON.parse(await readFile(join(fixtureRoot, "graph.json"), "utf8")) as DesignGraph;

const withServer = async (run: (baseUrl: string) => Promise<void>): Promise<void> => {
  const server = createWorkerServer({
    runRoot: fixtureRoot,
    graph: await fixtureGraph(),
    port: 0,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

describe("worker read-only API", () => {
  it("matches verification IDs by gate identity without positional fallback", () => {
    const events = [
      {
        type: "verification.completed",
        payload: { gate: "gate:b", verificationResultId: "verification:b" },
      },
      {
        type: "verification.completed",
        payload: { gate: "gate:a", verificationResultId: "verification:a" },
      },
    ];
    expect(
      attachVerificationResultIds(
        [{ gate: "gate:a" }, { gate: "gate:b" }, { gate: "gate:missing" }],
        events,
      ),
    ).toEqual([
      { gate: "gate:a", verificationResultId: "verification:a" },
      { gate: "gate:b", verificationResultId: "verification:b" },
      { gate: "gate:missing" },
    ]);
  });

  it("replays from the requested cursor and prioritizes Last-Event-ID", async () => {
    await withServer(async (baseUrl) => {
      const fromOne = await fetch(`${baseUrl}/events?from=1`);
      const fromOneBody = await fromOne.text();
      expect(fromOne.status).toBe(200);
      expect(fromOneBody).not.toContain("id: 0");
      expect(fromOneBody).toContain("id: 1");

      const lastEventId = await fetch(`${baseUrl}/events?from=0`, {
        headers: { "Last-Event-ID": "1" },
      });
      const lastEventIdBody = await lastEventId.text();
      expect(lastEventIdBody).not.toContain("id: 0");
      expect(lastEventIdBody).not.toContain("id: 1");
      expect(lastEventIdBody).toContain('"position":2');
      expect(lastEventIdBody).toContain("retry: 100");
    });
  });

  it("returns undefined only for missing JSON and preserves corruption errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-worker-json-"));
    const missing = await readJson(join(directory, "missing.json"));
    expect(missing).toBeUndefined();
    const malformed = join(directory, "malformed.json");
    await writeFile(malformed, "{not-json", "utf8");
    await expect(readJson(malformed)).rejects.toThrow(SyntaxError);
  });

  it("rejects a cursor beyond the event log as event-replay-failure", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/events?from=3`);
      expect(response.status).toBe(416);
      expect(await response.json()).toEqual({
        error: { code: "event-replay-failure", message: "event cursor exceeds log length" },
      });
      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  it("reconstructs revision diff from persisted patches", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/diff?from=0&to=1`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        fromRevision: 0,
        toRevision: 1,
        sourcePatchIds: ["patch:wp6-fixture-revision-1"],
      });
    });
  });

  it("classifies method and route failures as transport errors", async () => {
    await withServer(async (baseUrl) => {
      const method = await fetch(`${baseUrl}/state`, { method: "POST" });
      expect(method.status).toBe(405);
      expect(await method.json()).toEqual({
        error: {
          category: "transport",
          code: "method-not-allowed",
          message: "worker API is read-only",
        },
      });
      const route = await fetch(`${baseUrl}/missing`);
      expect(route.status).toBe(404);
      expect(await route.json()).toEqual({
        error: { category: "transport", code: "route-not-found", message: "unknown worker route" },
      });
    });
  });

  it("exposes verification and evidence references from the read model", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/state`);
      expect(response.status).toBe(200);
      const state = (await response.json()) as {
        gateResults: Array<{
          gate: number;
          name: string;
          status: string;
          verificationResultId?: string;
        }>;
        evidenceIds: string[];
      };
      expect(state.gateResults).toEqual([
        expect.objectContaining({
          gate: 1,
          name: "Fixture/schema",
          status: "passed",
          verificationResultId: "verification:gate:fixture-reference",
        }),
      ]);
      expect(state.evidenceIds).toEqual([
        "evidence:wp6-fixture",
        "verification:gate:fixture-reference",
      ]);
    });
  });
});
