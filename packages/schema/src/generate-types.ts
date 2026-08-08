import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import {
  designGraphSchemaPath,
  eventSchemaPath,
  fabFeedbackSchemaPath,
  gateMatrixSchemaPath,
  libraryPatchSchemaPath,
  patchSchemaPath,
  phase1FixtureSchemaPath,
  physicalEvidenceSchemaPath,
  toolEnvelopeSchemaPath,
  budgetUsageSchemaPath,
  stopRecordSchemaPath,
} from "./paths.js";

const generatedDirectory = new URL("./generated/", import.meta.url);

const definitions = [
  ["design-graph.schema.json", designGraphSchemaPath],
  ["patch.schema.json", patchSchemaPath],
  ["event.schema.json", eventSchemaPath],
  ["fab-feedback.schema.json", fabFeedbackSchemaPath],
  ["phase1-fixture.schema.json", phase1FixtureSchemaPath],
  ["physical-evidence.schema.json", physicalEvidenceSchemaPath],
  ["gate-matrix.schema.json", gateMatrixSchemaPath],
  ["library-patch.schema.json", libraryPatchSchemaPath],
  ["tool-envelope.schema.json", toolEnvelopeSchemaPath],
  ["budget-usage.schema.json", budgetUsageSchemaPath],
  ["stop-record.schema.json", stopRecordSchemaPath],
] as const;

for (const [filename, schemaPath] of definitions) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    $defs?: Record<string, unknown>;
    [key: string]: unknown;
  };
  const designGraph = JSON.parse(await readFile(designGraphSchemaPath, "utf8")) as {
    $defs?: Record<string, unknown>;
  };
  const budgetUsage = JSON.parse(await readFile(budgetUsageSchemaPath, "utf8")) as object;
  const withLocalBudgetUsage = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withLocalBudgetUsage);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.$ref === "https://acd.example.invalid/schemas/budget-usage.schema.json") {
      return budgetUsage;
    }
    if (typeof record.$ref === "string") {
      if (record.$ref.endsWith("#/$defs/id")) return designGraph.$defs?.id ?? value;
      if (record.$ref.endsWith("#/$defs/checkpoint/properties/eventPosition")) {
        const checkpoint = designGraph.$defs?.checkpoint as
          | { properties?: Record<string, unknown> }
          | undefined;
        return checkpoint?.properties?.eventPosition ?? value;
      }
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [key, withLocalBudgetUsage(child)]),
    );
  };
  const compilationSchema =
    filename === "tool-envelope.schema.json"
      ? {
          ...schema,
          $defs: {
            ...designGraph.$defs,
            ...schema.$defs,
            provenance: designGraph.$defs?.provenance,
            evidenceId: designGraph.$defs?.id,
          },
        }
      : filename === "stop-record.schema.json"
        ? withLocalBudgetUsage({
            ...schema,
            $defs: {
              ...schema.$defs,
              provenance: designGraph.$defs?.provenance,
              evidenceId: designGraph.$defs?.id,
            },
          })
        : schema;
  const types = await compile(
    compilationSchema as Parameters<typeof compile>[0],
    filename.replace(".schema.json", ""),
    {
      unreachableDefinitions: filename === "design-graph.schema.json",
    },
  );
  await writeFile(
    new URL(filename.replace(".schema.json", ".ts"), generatedDirectory),
    `/* eslint-disable */\n${types}`,
    "utf8",
  );
}
