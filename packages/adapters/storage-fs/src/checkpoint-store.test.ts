import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GraphCoreError, type Checkpoint } from "@acd/graph-core";
import { FileCheckpointStore } from "./checkpoint-store.js";

const checkpoint: Checkpoint = {
  id: "checkpoint:test",
  type: "Checkpoint",
  revision: 0,
  gate: "gate:test",
  inputRevision: 1,
  inputHash: "hash:input",
  graphRevision: 1,
  toolVersion: "tool:1",
  modelVersion: "model:1",
  libraryVersion: "library:1",
  containerVersion: "container:1",
  provenance: [{ kind: "tool-output", locator: "tool://test" }],
  measurementSystemQualification: { status: "qualified" },
  fabProfileId: "fab:test",
  manufacturingProfileId: "manufacturing:test",
  knowledgeItemStatuses: [{ knowledgeItemId: "knowledge:test", status: "approved" }],
  artifactHashes: ["hash:artifact"],
  verificationResultIds: ["verification:test"],
  eventPosition: 0,
  executionEnvironment: { os: "linux" },
};

describe("FileCheckpointStore", () => {
  it("ignores only a truncated final line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-checkpoint-store-"));
    const path = join(directory, "checkpoints.jsonl");
    await writeFile(path, `${JSON.stringify(checkpoint)}\n{"id":"partial"`, "utf8");

    const store = new FileCheckpointStore(path);
    await expect(store.readAll()).resolves.toEqual([checkpoint]);
  });

  it("fails on malformed complete checkpoint lines", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-checkpoint-store-"));
    const path = join(directory, "checkpoints.jsonl");
    await writeFile(path, '{"malformed"\n', "utf8");

    const store = new FileCheckpointStore(path);
    await expect(store.readAll()).rejects.toMatchObject({
      code: "event-replay-failure",
    } satisfies Partial<GraphCoreError>);
  });

  it("does not treat a final complete line without a newline as a record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acd-checkpoint-store-"));
    const path = join(directory, "checkpoints.jsonl");
    await writeFile(path, `${JSON.stringify(checkpoint)}`, "utf8");

    const store = new FileCheckpointStore(path);
    await expect(store.readAll()).resolves.toEqual([]);
    await appendFile(path, "\n");
    await expect(store.readAll()).resolves.toEqual([checkpoint]);
  });
});
