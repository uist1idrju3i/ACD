import { readFile, writeFile } from "node:fs/promises";
import {
  loadGateMatrix,
  phase1GatesDocPath,
  renderGateMatrixTable,
  replaceGateMatrixSection,
} from "../packages/schema/src/index.js";

const matrix = await loadGateMatrix();
const document = await readFile(phase1GatesDocPath, "utf8");
const updated = replaceGateMatrixSection(document, renderGateMatrixTable(matrix));
if (updated !== document) {
  await writeFile(phase1GatesDocPath, updated, "utf8");
}
process.stdout.write("generated gate matrix table: docs/phase1-gates.md\n");
