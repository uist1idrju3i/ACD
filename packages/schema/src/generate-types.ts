import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import {
  designGraphSchemaPath,
  eventSchemaPath,
  gateMatrixSchemaPath,
  patchSchemaPath,
  phase1FixtureSchemaPath,
  physicalEvidenceSchemaPath,
} from "./paths.js";

const generatedDirectory = new URL("./generated/", import.meta.url);

const definitions = [
  ["design-graph.schema.json", designGraphSchemaPath],
  ["patch.schema.json", patchSchemaPath],
  ["event.schema.json", eventSchemaPath],
  ["phase1-fixture.schema.json", phase1FixtureSchemaPath],
  ["physical-evidence.schema.json", physicalEvidenceSchemaPath],
  ["gate-matrix.schema.json", gateMatrixSchemaPath],
] as const;

for (const [filename, schemaPath] of definitions) {
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  const types = await compile(schema, filename.replace(".schema.json", ""));
  await writeFile(
    new URL(filename.replace(".schema.json", ".ts"), generatedDirectory),
    `/* eslint-disable */\n${types}`,
    "utf8",
  );
}
