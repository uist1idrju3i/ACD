import { readFile } from "node:fs/promises";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import {
  designGraphSchemaPath,
  errorTaxonomyDataPath,
  errorTaxonomySchemaPath,
  eventSchemaPath,
  patchSchemaPath,
  phase1FixtureSchemaPath,
  phase1SmokeFixturePath,
  repositoryRoot,
} from "./paths.js";
import { validatePhase1FixtureReferences } from "./phase1-semantic.js";

export const createValidator = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const addFormats = (formatsModule as unknown as { default: (instance: Ajv2020) => Ajv2020 })
    .default;
  addFormats(ajv);
  return ajv;
};

export const loadValidator = async (schemaPath: string): Promise<ValidateFunction> => {
  const ajv = createValidator();
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  return ajv.compile(schema);
};

export const formatValidationErrors = (errors: ErrorObject[] | null | undefined): string =>
  (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
    .join("; ");

const samplePaths = [
  designGraphSchemaPath,
  patchSchemaPath,
  eventSchemaPath,
  errorTaxonomySchemaPath,
  phase1FixtureSchemaPath,
];
for (const schemaPath of samplePaths) {
  await loadValidator(schemaPath);
  process.stdout.write(`validated schema: ${schemaPath}\n`);
}

const designGraphValidator = await loadValidator(designGraphSchemaPath);
const sample = JSON.parse(
  await readFile(`${repositoryRoot}/fixtures/design-graphs/normal-2layer.json`, "utf8"),
) as unknown;
if (!designGraphValidator(sample)) {
  throw new Error(
    `sample fixture is invalid: ${formatValidationErrors(designGraphValidator.errors)}`,
  );
}
process.stdout.write("validated sample: fixtures/design-graphs/normal-2layer.json\n");

const errorTaxonomyValidator = await loadValidator(errorTaxonomySchemaPath);
const errorTaxonomy = JSON.parse(await readFile(errorTaxonomyDataPath, "utf8")) as unknown;
if (!errorTaxonomyValidator(errorTaxonomy)) {
  throw new Error(
    `error taxonomy is invalid: ${formatValidationErrors(errorTaxonomyValidator.errors)}`,
  );
}
process.stdout.write("validated data: schemas/error-taxonomy.json\n");

const phase1FixtureValidator = await loadValidator(phase1FixtureSchemaPath);
const phase1SmokeFixture = JSON.parse(await readFile(phase1SmokeFixturePath, "utf8")) as unknown;
if (!phase1FixtureValidator(phase1SmokeFixture)) {
  throw new Error(
    `phase 1 smoke fixture is invalid: ${formatValidationErrors(phase1FixtureValidator.errors)}`,
  );
}
const phase1ReferenceErrors = validatePhase1FixtureReferences(
  phase1SmokeFixture as Parameters<typeof validatePhase1FixtureReferences>[0],
);
if (phase1ReferenceErrors.length > 0) {
  throw new Error(
    `phase 1 fixture reference-integrity failure: ${phase1ReferenceErrors.join("; ")}`,
  );
}
process.stdout.write("validated fixture: fixtures/phase1/smoke.json\n");
