import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  loadGateMatrix,
  loadSchemaValidator,
  missingExecutedGates,
} from "../packages/schema/src/index.js";
import type { ACDPhase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";
import {
  createPhase1Context,
  runPhase1Stages,
  setToolRunId,
  type Result,
} from "./phase1-stages.mts";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/phase1/golden-esp32.json"), "utf8"),
) as ACDPhase1Fixture;
const artifactRoot = join(root, "artifacts/phase1-golden");
const projectRoot = join(artifactRoot, "project");
const gateMatrix = await loadGateMatrix();
const designGraphValidator = await loadSchemaValidator("design-graph");

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(projectRoot, { recursive: true });

const context = createPhase1Context({
  fixture,
  artifactRoot,
  projectRoot,
  gateMatrix,
  designGraphValidator,
});
setToolRunId(context, randomUUID());

try {
  await runPhase1Stages(context);
  const missing = missingExecutedGates(
    gateMatrix,
    "golden",
    context.results.filter((result) => result.status === "passed").map((result) => result.gate),
  );
  if (missing.length > 0) {
    throw new Error(
      `verification-failed: golden run skipped contracted gates ${missing
        .map((gate) => gate.order)
        .join(", ")}`,
    );
  }
} catch (error) {
  const failedResults: Result[] = [
    ...context.results,
    {
      gate: context.results.at(-1)?.gate ?? 1,
      name: context.results.at(-1)?.name ?? "golden",
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
    },
  ];
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(artifactRoot, "gate-results.json"), JSON.stringify(failedResults, null, 2));
  throw error;
}

await writeFile(join(artifactRoot, "gate-results.json"), JSON.stringify(context.results, null, 2));
process.stdout.write("Phase 1 golden gates 1-12 passed\n");
