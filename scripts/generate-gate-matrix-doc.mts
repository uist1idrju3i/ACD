import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import {
  gatesDocPath,
  loadGateMatrix,
  phase1GatesDocPath,
  renderGateMatrixTable,
  replaceGateMatrixSection,
  repositoryRoot,
  type GateTableOptions,
} from "../packages/schema/src/index.js";

const matrix = await loadGateMatrix();
const targets: { path: string; options: GateTableOptions }[] = [
  { path: phase1GatesDocPath, options: { phases: [0, 1] } },
  { path: gatesDocPath, options: {} },
];

for (const target of targets) {
  const document = await readFile(target.path, "utf8");
  const updated = replaceGateMatrixSection(document, renderGateMatrixTable(matrix, target.options));
  if (updated !== document) await writeFile(target.path, updated, "utf8");
  process.stdout.write(
    `generated gate matrix table: ${relative(repositoryRoot, target.path)}\n`.replaceAll("\\", "/"),
  );
}
