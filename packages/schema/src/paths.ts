import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const designGraphSchemaPath = resolve(repositoryRoot, "schemas/design-graph.schema.json");
export const patchSchemaPath = resolve(repositoryRoot, "schemas/patch.schema.json");
export const eventSchemaPath = resolve(repositoryRoot, "schemas/event.schema.json");
