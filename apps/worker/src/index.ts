import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  diffSnapshots,
  projectBoardGeometry,
  replayTaskLedger,
  type DesignGraph,
  type Snapshot,
} from "@acd/graph-core";
import { FileEventLog } from "@acd/adapter-storage-fs";

type WorkerServerOptions = {
  runRoot: string;
  graph?: DesignGraph;
  port?: number;
};

type JsonObject = Record<string, unknown>;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const readJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const readJsonLines = async <T>(path: string): Promise<T[]> => {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const requestUrl = (request: IncomingMessage): URL =>
  new URL(request.url ?? "/", "http://127.0.0.1");

const sendJson = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(json(value));
};

const errorBody = (code: string, message: string): JsonObject => ({
  error: { code, message },
});

const cursor = (request: IncomingMessage, url: URL): number => {
  const header = request.headers["last-event-id"];
  const raw =
    typeof header === "string" && header.length > 0 ? header : url.searchParams.get("from");
  if (raw === null || raw === undefined || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`invalid event cursor: ${raw}`);
  return value;
};

const runSnapshot = async (runRoot: string, graph?: DesignGraph): Promise<Snapshot | undefined> => {
  if (graph) return { revision: graph.project.revision, graph, hash: "" };
  return readJson<Snapshot>(join(runRoot, "snapshot.json"));
};

const revisionSnapshot = async (
  runRoot: string,
  revision: number,
  current: Snapshot | undefined,
): Promise<Snapshot | undefined> =>
  current?.revision === revision
    ? current
    : readJson<Snapshot>(join(runRoot, `snapshot-${revision}.json`));

const readState = async (runRoot: string, log: FileEventLog): Promise<JsonObject> => {
  const events = await log.readAll();
  const ledger = replayTaskLedger(events);
  const run = await readJson(join(runRoot, "run.json"));
  const gates = await readJson(join(runRoot, "gate-results.json"));
  const checkpoints = await readJsonLines(join(runRoot, "checkpoints.jsonl"));
  const stopRecord = await readJson(join(runRoot, "stop-record.json"));
  const verificationIds = new Map(
    events.flatMap((event) => {
      if (event.type !== "verification.completed") return [];
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
      const value = payload as { gate?: unknown; verificationResultId?: unknown };
      return typeof value.gate === "string" && typeof value.verificationResultId === "string"
        ? [[value.gate, value.verificationResultId] as const]
        : [];
    }),
  );
  const gateResults = Array.isArray(gates)
    ? gates.map((gate) => {
        if (!gate || typeof gate !== "object" || Array.isArray(gate)) return gate;
        const value = gate as { gate?: unknown; verificationResultId?: unknown };
        const id = typeof value.gate === "string" ? verificationIds.get(value.gate) : undefined;
        return id && value.verificationResultId === undefined
          ? { ...value, verificationResultId: id }
          : gate;
      })
    : (gates ?? []);
  return {
    revision: events.at(-1)?.resultRevision ?? 0,
    eventPosition: events.length,
    taskLedger: ledger,
    gateResults,
    stopRecord: stopRecord ?? null,
    checkpoints: checkpoints ?? [],
    evidenceIds: events.flatMap((event) => {
      const payload = event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
      const ids = (payload as { evidenceIds?: unknown }).evidenceIds;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    }),
    run: run ?? null,
  };
};

const serveEvents = async (
  request: IncomingMessage,
  response: ServerResponse,
  log: FileEventLog,
  url: URL,
): Promise<void> => {
  let from: number;
  try {
    from = cursor(request, url);
    const events = await log.readAll();
    if (from > events.length) {
      sendJson(response, 416, errorBody("event-replay-failure", "event cursor exceeds log length"));
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache");
    response.setHeader("connection", "keep-alive");
    response.setHeader("access-control-allow-origin", "http://127.0.0.1:4173");
    const read = await log.readFrom(from);
    for (const [index, event] of read.events.entries()) {
      const position = from + index;
      response.write(`id: ${position}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.write(`event: cursor\ndata: ${JSON.stringify({ position: events.length })}\n\n`);
    response.end();
  } catch (error) {
    if (!response.headersSent) {
      sendJson(
        response,
        500,
        errorBody("event-replay-failure", error instanceof Error ? error.message : String(error)),
      );
    } else {
      response.end();
    }
  }
};

export const createWorkerServer = (options: WorkerServerOptions) => {
  const runRoot = resolve(options.runRoot);
  const log = new FileEventLog(join(runRoot, "events.jsonl"));
  const server = createServer(async (request, response) => {
    const url = requestUrl(request);
    if (request.method !== "GET") {
      sendJson(response, 405, errorBody("verification-failed", "worker API is read-only"));
      return;
    }
    try {
      if (url.pathname === "/events") {
        await serveEvents(request, response, log, url);
        return;
      }
      if (url.pathname === "/state") {
        sendJson(response, 200, await readState(runRoot, log));
        return;
      }
      const snapshot = await runSnapshot(runRoot, options.graph);
      if (url.pathname === "/projection") {
        if (!snapshot) {
          sendJson(
            response,
            503,
            errorBody("reference-integrity", "projection snapshot is unavailable"),
          );
          return;
        }
        sendJson(response, 200, projectBoardGeometry(snapshot.graph, snapshot.revision));
        return;
      }
      if (url.pathname === "/diff") {
        const from = Number(url.searchParams.get("from"));
        const to = Number(url.searchParams.get("to"));
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
          sendJson(response, 400, errorBody("revision-invalid", "revision query is invalid"));
          return;
        }
        const fromSnapshot = await revisionSnapshot(runRoot, from, snapshot);
        const toSnapshot = await revisionSnapshot(runRoot, to, snapshot);
        if (!fromSnapshot || !toSnapshot) {
          sendJson(
            response,
            503,
            errorBody("reference-integrity", "requested revision is unavailable"),
          );
          return;
        }
        sendJson(
          response,
          200,
          diffSnapshots(fromSnapshot, toSnapshot, { events: await log.readAll() }),
        );
        return;
      }
      sendJson(response, 404, errorBody("reference-integrity", "unknown worker route"));
    } catch (error) {
      sendJson(
        response,
        500,
        errorBody("event-replay-failure", error instanceof Error ? error.message : String(error)),
      );
    }
  });
  return server;
};

export const startWorkerServer = async (
  options: WorkerServerOptions,
): Promise<{ close: () => Promise<void>; port: number }> => {
  const server = createWorkerServer(options);
  const port = options.port ?? 4174;
  await new Promise<void>((resolvePromise) => server.listen(port, "127.0.0.1", resolvePromise));
  return {
    port,
    close: () =>
      new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      ),
  };
};
