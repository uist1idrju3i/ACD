import { readFile } from "node:fs/promises";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import { designGraphSchemaPath, eventSchemaPath, patchSchemaPath } from "./paths.js";

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

const samplePaths = [designGraphSchemaPath, patchSchemaPath, eventSchemaPath];
for (const schemaPath of samplePaths) {
  await loadValidator(schemaPath);
  process.stdout.write(`validated schema: ${schemaPath}\n`);
}

export const formatValidationErrors = (errors: ErrorObject[] | null | undefined): string =>
  (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
    .join("; ");
