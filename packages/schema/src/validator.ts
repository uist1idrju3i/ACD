import { readFile } from "node:fs/promises";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import * as formatsModule from "ajv-formats";
import {
  designGraphSchemaPath,
  errorTaxonomySchemaPath,
  eventSchemaPath,
  fabFeedbackSchemaPath,
  libraryPatchSchemaPath,
  componentLibrarySchemaPath,
  patchSchemaPath,
  phase1FixtureSchemaPath,
  toolEnvelopeSchemaPath,
  budgetUsageSchemaPath,
  stopRecordSchemaPath,
} from "./paths.js";

export type SchemaName =
  | "design-graph"
  | "patch"
  | "event"
  | "fab-feedback"
  | "error-taxonomy"
  | "phase1-fixture"
  | "library-patch"
  | "component-library"
  | "tool-envelope"
  | "budget-usage"
  | "stop-record";

const paths: Record<SchemaName, string> = {
  "design-graph": designGraphSchemaPath,
  patch: patchSchemaPath,
  event: eventSchemaPath,
  "fab-feedback": fabFeedbackSchemaPath,
  "error-taxonomy": errorTaxonomySchemaPath,
  "phase1-fixture": phase1FixtureSchemaPath,
  "library-patch": libraryPatchSchemaPath,
  "component-library": componentLibrarySchemaPath,
  "tool-envelope": toolEnvelopeSchemaPath,
  "budget-usage": budgetUsageSchemaPath,
  "stop-record": stopRecordSchemaPath,
};

export const createSchemaValidator = (): Ajv2020 => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const addFormats = (formatsModule as unknown as { default: (instance: Ajv2020) => Ajv2020 })
    .default;
  addFormats(ajv);
  return ajv;
};

export const loadSchemaValidator = async (name: SchemaName): Promise<ValidateFunction> => {
  const ajv = createSchemaValidator();
  if (name === "tool-envelope") {
    const designGraph = JSON.parse(await readFile(designGraphSchemaPath, "utf8")) as object;
    ajv.addSchema(designGraph, "design-graph.schema.json");
  }
  if (name === "stop-record") {
    const designGraph = JSON.parse(await readFile(designGraphSchemaPath, "utf8")) as object;
    ajv.addSchema(designGraph);
    const budgetUsage = JSON.parse(await readFile(budgetUsageSchemaPath, "utf8")) as object;
    ajv.addSchema(budgetUsage);
  }
  const schema = JSON.parse(await readFile(paths[name], "utf8")) as object;
  return ajv.compile(schema);
};

export const loadKnowledgeItemValidator = async (): Promise<ValidateFunction> => {
  const ajv = createSchemaValidator();
  const schema = JSON.parse(await readFile(designGraphSchemaPath, "utf8")) as object & {
    $id?: string;
  };
  ajv.addSchema(schema);
  return ajv.compile({ $ref: `${schema.$id}#/$defs/knowledgeItem` });
};
