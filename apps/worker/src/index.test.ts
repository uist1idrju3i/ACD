import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerServer } from "./index.js";
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
      expect(lastEventIdBody).toContain("id: 1");
    });
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
});
