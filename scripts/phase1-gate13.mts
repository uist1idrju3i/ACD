import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluatePhysicalEvidence } from "../packages/schema/src/index.js";

const path = resolve(process.argv[2] ?? "fixtures/phase1/physical-evidence-pending.json");
const evidence = JSON.parse(await readFile(path, "utf8")) as unknown;
const verdict = await evaluatePhysicalEvidence(evidence);
process.stdout.write(`${JSON.stringify({ path, ...verdict }, null, 2)}\n`);
if (!verdict.valid || !verdict.passed) process.exitCode = 1;
