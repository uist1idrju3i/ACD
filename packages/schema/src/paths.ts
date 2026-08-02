import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const designGraphSchemaPath = resolve(repositoryRoot, "schemas/design-graph.schema.json");
export const patchSchemaPath = resolve(repositoryRoot, "schemas/patch.schema.json");
export const eventSchemaPath = resolve(repositoryRoot, "schemas/event.schema.json");
export const errorTaxonomySchemaPath = resolve(
  repositoryRoot,
  "schemas/error-taxonomy.schema.json",
);
export const errorTaxonomyDataPath = resolve(repositoryRoot, "schemas/error-taxonomy.json");
export const phase1FixtureSchemaPath = resolve(
  repositoryRoot,
  "schemas/phase1-fixture.schema.json",
);
export const phase1SmokeFixturePath = resolve(repositoryRoot, "fixtures/phase1/smoke.json");
