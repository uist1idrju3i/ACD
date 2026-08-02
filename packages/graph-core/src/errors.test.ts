import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./errors.js";

describe("error taxonomy", () => {
  it("contains every graph-core error code", async () => {
    const root = resolve(import.meta.dirname, "../../../");
    const taxonomy = JSON.parse(
      await readFile(resolve(root, "schemas/error-taxonomy.json"), "utf8"),
    ) as { errors: Array<{ code: string }> };
    const taxonomyCodes = new Set(taxonomy.errors.map(({ code }) => code));

    for (const code of ERROR_CODES) {
      expect(taxonomyCodes.has(code), `${code} missing from taxonomy`).toBe(true);
    }
  });
});
