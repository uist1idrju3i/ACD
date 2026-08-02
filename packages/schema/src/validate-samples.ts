import { readFile } from "node:fs/promises";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import {
  designGraphSchemaPath,
  errorTaxonomyDataPath,
  errorTaxonomySchemaPath,
  eventSchemaPath,
  gateMatrixDataPath,
  gateMatrixSchemaPath,
  gatesDocPath,
  patchSchemaPath,
  phase1FixtureSchemaPath,
  phase1GatesDocPath,
  phase1GoldenFixturePath,
  phase1SmokeFixturePath,
  physicalEvidenceSamplePath,
  physicalEvidenceSchemaPath,
  repositoryRoot,
} from "./paths.js";
import { validatePhase1FixtureReferences } from "./phase1-semantic.js";
import { gateMatrixSectionMatches, type GateMatrix } from "./gate-matrix.js";

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
  physicalEvidenceSchemaPath,
  gateMatrixSchemaPath,
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

const gateMatrixValidator = await loadValidator(gateMatrixSchemaPath);
const gateMatrixData = JSON.parse(await readFile(gateMatrixDataPath, "utf8")) as unknown;
if (!gateMatrixValidator(gateMatrixData)) {
  throw new Error(`gate matrix is invalid: ${formatValidationErrors(gateMatrixValidator.errors)}`);
}
const gateMatrix = gateMatrixData as GateMatrix;
const taxonomyCodes = new Set(
  (errorTaxonomy as { errors: { code: string }[] }).errors.map((entry) => entry.code),
);
for (const gate of gateMatrix.gates) {
  for (const code of gate.errorCodes) {
    if (!taxonomyCodes.has(code)) {
      throw new Error(`gate ${gate.id} references unknown error code ${code}`);
    }
  }
}
const gateMatrixDocs = [
  { path: phase1GatesDocPath, name: "docs/phase1-gates.md", options: { phases: [0, 1] } },
  { path: gatesDocPath, name: "docs/gates.md", options: {} },
];
for (const doc of gateMatrixDocs) {
  if (!gateMatrixSectionMatches(await readFile(doc.path, "utf8"), gateMatrix, doc.options)) {
    throw new Error(`${doc.name} gate matrix is out of sync with schemas/gate-matrix.json`);
  }
}
process.stdout.write("validated data: schemas/gate-matrix.json\n");

const physicalEvidenceValidator = await loadValidator(physicalEvidenceSchemaPath);
const physicalEvidenceSample = JSON.parse(
  await readFile(physicalEvidenceSamplePath, "utf8"),
) as unknown;
if (!physicalEvidenceValidator(physicalEvidenceSample)) {
  throw new Error(
    `physical evidence sample is invalid: ${formatValidationErrors(physicalEvidenceValidator.errors)}`,
  );
}
process.stdout.write(
  "validated physical evidence: fixtures/phase1/physical-evidence-pending.json\n",
);

const phase1FixtureValidator = await loadValidator(phase1FixtureSchemaPath);
for (const [fixturePath, label] of [
  [phase1SmokeFixturePath, "fixtures/phase1/smoke.json"],
  [phase1GoldenFixturePath, "fixtures/phase1/golden-esp32.json"],
] as const) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as unknown;
  if (!phase1FixtureValidator(fixture)) {
    throw new Error(
      `phase 1 fixture ${label} is invalid: ${formatValidationErrors(phase1FixtureValidator.errors)}`,
    );
  }
  const referenceErrors = validatePhase1FixtureReferences(
    fixture as Parameters<typeof validatePhase1FixtureReferences>[0],
  );
  if (referenceErrors.length > 0) {
    throw new Error(
      `phase 1 fixture reference-integrity failure (${label}): ${referenceErrors.join("; ")}`,
    );
  }
  process.stdout.write(`validated fixture: ${label}\n`);
}
