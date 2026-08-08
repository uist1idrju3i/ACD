import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createSchemaValidator } from "./validator.js";

describe("task ledger schema", () => {
  it("validates a complete task ledger entry", async () => {
    const ajv = createSchemaValidator();
    const schema = JSON.parse(
      await readFile(new URL("../../../schemas/design-graph.schema.json", import.meta.url), "utf8"),
    ) as object & { $id?: string };
    ajv.addSchema(schema);
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/taskLedgerEntry` });

    const task = {
      id: "task:example",
      type: "TaskLedgerEntry",
      revision: 1,
      purpose: "run the task",
      inputRevision: 1,
      status: "pending",
      acceptanceCriteria: ["result is recorded"],
      attemptCount: 0,
      retryBudget: 1,
      budget: { scope: "execution", tokens: 100 },
      checkpointIds: [],
      dependencyIds: [],
      approvalState: "not-required",
      artifactIds: [],
      resultId: "result:example",
    };

    expect(validate(task), JSON.stringify(ajv.errors)).toBe(true);
  });
});
