import { readFile } from "node:fs/promises";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import {
  designGraphSchemaPath,
  eventSchemaPath,
  patchSchemaPath,
} from "./paths.js";

export type SchemaName = "design-graph" | "patch" | "event";

const paths: Record<SchemaName, string> = {
  "design-graph": designGraphSchemaPath,
  patch: patchSchemaPath,
  event: eventSchemaPath,
};

export const createSchemaValidator = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const addFormats = (
    formatsModule as unknown as { default: (instance: Ajv2020) => Ajv2020 }
  ).default;
  addFormats(ajv);
  return ajv;
};

export const loadSchemaValidator = async (
  name: SchemaName,
): Promise<ValidateFunction> => {
  const ajv = createSchemaValidator();
  const schema = JSON.parse(await readFile(paths[name], "utf8")) as object;
  return ajv.compile(schema);
};
