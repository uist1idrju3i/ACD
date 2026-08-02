import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const designGraphSchemaPath = resolve(repositoryRoot, "schemas/design-graph.schema.json");
export const patchSchemaPath = resolve(repositoryRoot, "schemas/patch.schema.json");
export const libraryPatchSchemaPath = resolve(repositoryRoot, "schemas/library-patch.schema.json");
export const eventSchemaPath = resolve(repositoryRoot, "schemas/event.schema.json");
export const fabFeedbackSchemaPath = resolve(repositoryRoot, "schemas/fab-feedback.schema.json");
export const errorTaxonomySchemaPath = resolve(
  repositoryRoot,
  "schemas/error-taxonomy.schema.json",
);
export const errorTaxonomyDataPath = resolve(repositoryRoot, "schemas/error-taxonomy.json");
export const gateMatrixSchemaPath = resolve(repositoryRoot, "schemas/gate-matrix.schema.json");
export const gateMatrixDataPath = resolve(repositoryRoot, "schemas/gate-matrix.json");
export const phase1GatesDocPath = resolve(repositoryRoot, "docs/phase1-gates.md");
export const gatesDocPath = resolve(repositoryRoot, "docs/gates.md");
export const phase1FixtureSchemaPath = resolve(
  repositoryRoot,
  "schemas/phase1-fixture.schema.json",
);
export const phase1SmokeFixturePath = resolve(repositoryRoot, "fixtures/phase1/smoke.json");
export const phase1GoldenFixturePath = resolve(repositoryRoot, "fixtures/phase1/golden-esp32.json");
export const physicalEvidenceSchemaPath = resolve(
  repositoryRoot,
  "schemas/physical-evidence.schema.json",
);
export const physicalEvidenceSamplePath = resolve(
  repositoryRoot,
  "fixtures/phase1/physical-evidence-pending.json",
);
export const fabFeedbackSamplePath = resolve(
  repositoryRoot,
  "fixtures/phase3/fab-report-prototype-1.json",
);
