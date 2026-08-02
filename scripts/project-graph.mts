import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DesignGraph } from "../packages/graph-core/src/index.js";
import { projectToKicad } from "../packages/adapters/kicad/src/index.js";

const [fixturePath, directory] = process.argv.slice(2);
if (!fixturePath || !directory) {
  process.stderr.write("usage: tsx scripts/project-graph.mts <fixture.json> <directory>\n");
  process.exit(2);
}

const graph = JSON.parse(await readFile(resolve(fixturePath), "utf8")) as DesignGraph;
const projection = await projectToKicad(graph, resolve(directory));
process.stdout.write(`${projection.boardPath}\n`);
