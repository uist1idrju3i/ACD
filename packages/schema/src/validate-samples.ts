import { readFile } from "node:fs/promises";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import {
  designGraphSchemaPath,
  eventSchemaPath,
  patchSchemaPath,
  repositoryRoot,
} from "./paths.js";

export const createValidator = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const addFormats = (
    formatsModule as unknown as { default: (instance: Ajv2020) => Ajv2020 }
  ).default;
  addFormats(ajv);
  return ajv;
};

export const loadValidator = async (
  schemaPath: string,
): Promise<ValidateFunction> => {
  const ajv = createValidator();
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  return ajv.compile(schema);
};

export const formatValidationErrors = (errors: ErrorObject[] | null | undefined): string =>
  (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
    .join("; ");

const samplePaths = [designGraphSchemaPath, patchSchemaPath, eventSchemaPath];
for (const schemaPath of samplePaths) {
  await loadValidator(schemaPath);
  process.stdout.write(`validated schema: ${schemaPath}\n`);
}

const designGraphValidator = await loadValidator(designGraphSchemaPath);
const sample = JSON.parse(
  await readFile(`${repositoryRoot}/fixtures/design-graphs/normal-2layer.json`, "utf8"),
) as unknown;
if (!designGraphValidator(sample)) {
  throw new Error(`sample fixture is invalid: ${formatValidationErrors(designGraphValidator.errors)}`);
}
process.stdout.write("validated sample: fixtures/design-graphs/normal-2layer.json\n");
