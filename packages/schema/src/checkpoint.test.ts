import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createSchemaValidator } from "./validator.js";

describe("checkpoint schema", () => {
  it("validates a complete checkpoint entity", async () => {
    const ajv = createSchemaValidator();
    const schema = JSON.parse(
      await readFile(new URL("../../../schemas/design-graph.schema.json", import.meta.url), "utf8"),
    ) as object & { $id?: string };
    ajv.addSchema(schema);
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/checkpoint` });
    expect(
      validate({
        id: "checkpoint:1",
        type: "Checkpoint",
        revision: 0,
        gate: "gate:a",
        inputRevision: 1,
        inputHash: "hash:input:1",
        graphRevision: 1,
        toolVersion: "tool:1",
        modelVersion: "model:1",
        libraryVersion: "library:1",
        containerVersion: "container:1",
        provenance: [{ kind: "tool-output", locator: "tool://run/1" }],
        measurementSystemQualification: { status: "qualified" },
        fabProfileId: "fab:1",
        manufacturingProfileId: "manufacturing:1",
        knowledgeItemStatuses: [{ knowledgeItemId: "knowledge:1", status: "approved" }],
        artifactHashes: ["hash:artifact:1"],
        verificationResultIds: ["verification:1"],
        eventPosition: 0,
        executionEnvironment: { os: "linux" },
      }),
    ).toBe(true);
  });
});
