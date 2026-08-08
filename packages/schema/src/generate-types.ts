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
] as const;

for (const [filename, schemaPath] of definitions) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    $defs?: Record<string, unknown>;
    [key: string]: unknown;
  };
  const designGraph = JSON.parse(await readFile(designGraphSchemaPath, "utf8")) as {
    $defs?: Record<string, unknown>;
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
      : schema;
  const types = await compile(compilationSchema, filename.replace(".schema.json", ""), {
    unreachableDefinitions: filename === "design-graph.schema.json",
  });
  await writeFile(
    new URL(filename.replace(".schema.json", ".ts"), generatedDirectory),
    `/* eslint-disable */\n${types}`,
    "utf8",
  );
}
