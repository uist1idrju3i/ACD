import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createEvent,
  GraphCoreError,
  type PatchResult,
  PatchEngine,
  sha256,
  type Repository,
  type Snapshot,
  validateSemanticGraph,
  type DesignGraph,
  type EventLog,
} from "@acd/graph-core";
import { loadSchemaValidator, type PatchEnvelope as Patch } from "@acd/schema";
import { FileEventLog } from "./event-log.js";

export class FileRepository implements Repository {
  private readonly patchEngine = new PatchEngine();
  private snapshot?: Snapshot;
  private readonly eventLog: EventLog;

  constructor(
    private readonly directory: string,
    private readonly initialGraph?: DesignGraph,
  ) {
    this.eventLog = new FileEventLog(`${directory}/events.jsonl`);
  }

  private snapshotPath(): string {
    return `${this.directory}/snapshot.json`;
  }

  private patchesPath(): string {
    return `${this.directory}/patches.jsonl`;
  }

  private async readPatches(): Promise<Patch[]> {
    try {
      const content = await readFile(this.patchesPath(), "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Patch);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async load(): Promise<Snapshot> {
    if (!this.snapshot) {
      await mkdir(dirname(this.snapshotPath()), { recursive: true });
      try {
        this.snapshot = JSON.parse(await readFile(this.snapshotPath(), "utf8")) as Snapshot;
        validateSemanticGraph(this.snapshot.graph, this.snapshot.revision);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!this.initialGraph)
          throw new GraphCoreError("reference-integrity", "repository has no initial graph");
        validateSemanticGraph(this.initialGraph, 0);
        this.snapshot = { revision: 0, graph: this.initialGraph, hash: sha256(this.initialGraph) };
        await writeFile(this.snapshotPath(), JSON.stringify(this.snapshot, null, 2), "utf8");
      }
      const persistedSnapshot = this.snapshot;
      for (const patch of await this.readPatches()) {
        const validator = await loadSchemaValidator("patch");
        if (!validator(patch))
          throw new GraphCoreError(
            "schema-invalid",
            "persisted patch failed JSON Schema validation",
          );
        this.patchEngine.seedAccepted(patch, {
          graph: structuredClone(persistedSnapshot.graph),
          revision: persistedSnapshot.revision,
          snapshotHash: persistedSnapshot.hash,
          patchHash: sha256(patch),
          replayed: false,
        });
      }
    }
    return structuredClone(this.snapshot);
  }

  async apply(patch: Patch): Promise<PatchResult> {
    const validator = await loadSchemaValidator("patch");
    if (!validator(patch))
      throw new GraphCoreError("schema-invalid", "patch envelope failed JSON Schema validation");
    const current = await this.load();
    const result = this.patchEngine.apply(current.graph, current.revision, patch);
    if (result.replayed) return result;
    this.snapshot = { revision: result.revision, graph: result.graph, hash: result.snapshotHash };
    await writeFile(this.snapshotPath(), JSON.stringify(this.snapshot, null, 2), "utf8");
    await appendFile(this.patchesPath(), `${JSON.stringify(patch)}\n`, "utf8");
    await this.eventLog.append(
      createEvent({
        eventId: `event:${patch.patchId}`,
        type: "patch.accepted",
        occurredAt: patch.createdAt,
        actor: patch.createdBy ?? "unknown",
        projectId: current.graph.project.id,
        baseRevision: patch.baseRevision,
        resultRevision: result.revision,
        payload: patch,
      }),
    );
    return result;
  }
}
