import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PatchEnvelope as Patch } from "@acd/schema";
import { FileEventLog, type EventEnvelope } from "./event-log.js";
import { GraphCoreError } from "./errors.js";
import { sha256 } from "./hash.js";
import { PatchEngine, type PatchResult } from "./patch.js";
import { validateSemanticGraph, type DesignGraph } from "./semantic.js";

export type Snapshot = {
  revision: number;
  graph: DesignGraph;
  hash: string;
};

export interface Repository {
  load(): Promise<Snapshot>;
  apply(patch: Patch): Promise<PatchResult>;
}

export class FileRepository implements Repository {
  private readonly patchEngine = new PatchEngine();
  private snapshot?: Snapshot;
  private readonly eventLog: FileEventLog;

  constructor(
    private readonly directory: string,
    private readonly initialGraph?: DesignGraph,
  ) {
    this.eventLog = new FileEventLog(`${directory}/events.jsonl`);
  }

  private snapshotPath(): string {
    return `${this.directory}/snapshot.json`;
  }

  async load(): Promise<Snapshot> {
    if (!this.snapshot) {
      await mkdir(dirname(this.snapshotPath()), { recursive: true });
      try {
        const parsed = JSON.parse(await readFile(this.snapshotPath(), "utf8")) as Snapshot;
        validateSemanticGraph(parsed.graph, parsed.revision);
        this.snapshot = parsed;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (!this.initialGraph) throw new GraphCoreError("reference-integrity", "repository has no initial graph");
        validateSemanticGraph(this.initialGraph, 0);
        this.snapshot = { revision: 0, graph: this.initialGraph, hash: sha256(this.initialGraph) };
        await writeFile(this.snapshotPath(), JSON.stringify(this.snapshot, null, 2), "utf8");
      }
    }
    return this.snapshot;
  }

  async apply(patch: Patch): Promise<PatchResult> {
    const current = await this.load();
    const result = this.patchEngine.apply(current.graph, current.revision, patch);
    this.snapshot = { revision: result.revision, graph: result.graph, hash: result.snapshotHash };
    await writeFile(this.snapshotPath(), JSON.stringify(this.snapshot, null, 2), "utf8");
    const event: EventEnvelope = {
      eventId: `event:${patch.patchId}`,
      type: "patch.accepted",
      occurredAt: patch.createdAt,
      actor: patch.createdBy ?? "unknown",
      projectId: current.graph.project.id,
      baseRevision: patch.baseRevision,
      resultRevision: result.revision,
      payloadHash: sha256(patch),
      payload: patch,
    };
    await this.eventLog.append(event);
    return result;
  }
}
