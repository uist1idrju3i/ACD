import { loadSchemaValidator } from "@acd/schema";
import type { PatchEnvelope as Patch } from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { createEvent, InMemoryEventLog, type EventLog } from "./event-log.js";
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

export class InMemoryRepository implements Repository {
  private readonly patchEngine = new PatchEngine();
  private snapshot: Snapshot;

  constructor(
    graph: DesignGraph,
    private readonly eventLog: EventLog = new InMemoryEventLog(),
  ) {
    validateSemanticGraph(graph, 0);
    this.snapshot = { revision: 0, graph: structuredClone(graph), hash: sha256(graph) };
  }

  async load(): Promise<Snapshot> {
    return structuredClone(this.snapshot);
  }

  async apply(patch: Patch): Promise<PatchResult> {
    const validator = await loadSchemaValidator("patch");
    if (!validator(patch)) {
      throw new GraphCoreError(
        "schema-invalid",
        "patch envelope failed JSON Schema validation",
        "error",
        { errors: validator.errors },
      );
    }
    const current = this.snapshot;
    const result = this.patchEngine.apply(current.graph, current.revision, patch);
    if (result.replayed) return result;
    this.snapshot = { revision: result.revision, graph: result.graph, hash: result.snapshotHash };
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
