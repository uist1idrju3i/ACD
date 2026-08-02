import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createSchemaValidator } from "./validator.js";

describe("design graph schema", () => {
  it("validates the normal two-layer fixture", async () => {
    const validator = createSchemaValidator();
    const schema = JSON.parse(
      await readFile(new URL("../../../schemas/design-graph.schema.json", import.meta.url), "utf8"),
    ) as object;
    const validate = validator.compile(schema);
    const fixture = JSON.parse(
      await readFile(
        new URL("../../../fixtures/design-graphs/normal-2layer.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(validate(fixture), JSON.stringify(validator.errors)).toBe(true);
  });
});
