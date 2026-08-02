import type { PatchEnvelope as Patch } from "@acd/schema";
import { GraphCoreError } from "./errors.js";
import { canonicalize, sha256 } from "./hash.js";
import { validateSemanticGraph, type DesignGraph } from "./semantic.js";

export type PatchOperation = Patch["operations"][number];
export type PatchResult = {
  graph: DesignGraph;
  revision: number;
  snapshotHash: string;
  patchHash: string;
  replayed: boolean;
};

type JsonRecord = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const decode = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

const pointerSegments = (path: string): string[] => {
  if (path === "") return [];
  if (!path.startsWith("/"))
    throw new GraphCoreError("patch-conflict", `invalid JSON Pointer: ${path}`);
  return path.slice(1).split("/").map(decode);
};

const entityIndex = (entities: DesignGraph["entities"], segment: string): number => {
  if (segment.startsWith("@id:")) {
    const id = segment.slice("@id:".length);
    const index = entities.findIndex((entity) => entity.id === id);
    if (index < 0) throw new GraphCoreError("patch-conflict", `entity not found: ${id}`);
    return index;
  }
  const index = Number(segment);
  if (!Number.isInteger(index) || index < 0 || index >= entities.length) {
    throw new GraphCoreError("patch-conflict", `invalid entity array index: ${segment}`);
  }
  return index;
};

const resolveParent = (
  graph: DesignGraph,
  segments: string[],
): { parent: unknown; key: string } => {
  if (segments.length === 0)
    throw new GraphCoreError("patch-conflict", "root replacement is not supported");
  let current: unknown = graph;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (segment === undefined) throw new GraphCoreError("patch-conflict", "missing path segment");
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      segment === "entities"
    ) {
      current = (current as JsonRecord)[segment];
      continue;
    }
    if (Array.isArray(current) && current === (graph as unknown as JsonRecord).entities) {
      current = current[entityIndex(current as DesignGraph["entities"], segment)];
      continue;
    }
    if (Array.isArray(current)) {
      const arrayIndex = segment === "-" ? current.length : Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) {
        throw new GraphCoreError("patch-conflict", `invalid array segment: ${segment}`);
      }
      current = current[arrayIndex];
      continue;
    }
    if (!current || typeof current !== "object" || !(segment in current)) {
      throw new GraphCoreError(
        "patch-conflict",
        `path not found: /${segments.slice(0, index + 1).join("/")}`,
      );
    }
    current = (current as JsonRecord)[segment];
  }
  return { parent: current, key: segments.at(-1) as string };
};

const readPath = (graph: DesignGraph, path: string): unknown => {
  const segments = pointerSegments(path);
  if (segments.length === 0) return graph;
  const { parent, key } = resolveParent(graph, segments);
  if (Array.isArray(parent)) {
    const index = parent === graph.entities ? entityIndex(graph.entities, key) : Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new GraphCoreError("patch-conflict", `path not found: ${path}`);
    }
    return parent[index];
  }
  if (!parent || typeof parent !== "object" || !(key in parent)) {
    throw new GraphCoreError("patch-conflict", `path not found: ${path}`);
  }
  return (parent as JsonRecord)[key];
};

const applyOperation = (graph: DesignGraph, operation: PatchOperation): void => {
  const segments = pointerSegments(operation.path);
  const { parent, key } = resolveParent(graph, segments);
  if (operation.op === "test") {
    if (canonicalize(readPath(graph, operation.path)) !== canonicalize(operation.value)) {
      throw new GraphCoreError("patch-conflict", `test operation failed: ${operation.path}`);
    }
    return;
  }
  if (Array.isArray(parent)) {
    const index =
      key === "-"
        ? parent.length
        : parent === graph.entities && key.startsWith("@id:")
          ? entityIndex(graph.entities, key)
          : Number(key);
    if (operation.op === "add" && Number.isInteger(index) && index >= 0 && index <= parent.length) {
      parent.splice(index, 0, clone(operation.value));
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
      throw new GraphCoreError("patch-conflict", `array path not found: ${operation.path}`);
    }
    if (operation.op === "remove") parent.splice(index, 1);
    else if (operation.op === "replace") parent[index] = clone(operation.value);
    else throw new GraphCoreError("patch-conflict", `unsupported array operation: ${operation.op}`);
    return;
  }
  if (!parent || typeof parent !== "object") {
    throw new GraphCoreError("patch-conflict", `parent is not an object: ${operation.path}`);
  }
  const record = parent as JsonRecord;
  if (operation.op === "remove") {
    if (!(key in record))
      throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
    delete record[key];
  } else {
    if (operation.op === "add" && key in record) {
      throw new GraphCoreError("patch-conflict", `path already exists: ${operation.path}`);
    }
    if (operation.op === "replace" && !(key in record)) {
      throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
    }
    record[key] = clone(operation.value);
  }
};

export class PatchEngine {
  private readonly accepted = new Map<string, PatchResult>();

  apply(graph: DesignGraph, currentRevision: number, patch: Patch): PatchResult {
    const existing = this.accepted.get(patch.patchId);
    if (existing) {
      if (existing.patchHash !== sha256(patch)) {
        throw new GraphCoreError(
          "patch-conflict",
          `patchId reused with different payload: ${patch.patchId}`,
        );
      }
      return { ...existing, replayed: true };
    }
    if (patch.baseRevision !== currentRevision || patch.resultRevision !== currentRevision + 1) {
      throw new GraphCoreError(
        "patch-conflict",
        "patch revision does not match current revision",
        "error",
        {
          patchId: patch.patchId,
          currentRevision,
          baseRevision: patch.baseRevision,
          resultRevision: patch.resultRevision,
        },
      );
    }
    const next = clone(graph);
    try {
      for (const operation of patch.operations) applyOperation(next, operation);
      validateSemanticGraph(next, patch.resultRevision);
    } catch (error) {
      if (error instanceof GraphCoreError) throw error;
      throw new GraphCoreError(
        "patch-conflict",
        error instanceof Error ? error.message : "patch failed",
      );
    }
    for (const entity of next.entities) entity.revision = patch.resultRevision;
    next.project.revision = patch.resultRevision;
    const result: PatchResult = {
      graph: next,
      revision: patch.resultRevision,
      snapshotHash: sha256(next),
      patchHash: sha256(patch),
      replayed: false,
    };
    this.accepted.set(patch.patchId, result);
    return result;
  }

  seedAccepted(patch: Patch, result: PatchResult): void {
    this.accepted.set(patch.patchId, result);
  }
}
