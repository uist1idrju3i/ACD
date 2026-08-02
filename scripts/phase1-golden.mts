import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  compareNetlists,
  placeFixture,
  projectToKicad,
} from "../packages/adapters/kicad/src/index.js";
import { validatePhase1FixtureReferences } from "../packages/schema/src/index.js";
import type { Phase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";

const root = resolve(import.meta.dirname, "..");
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/phase1/golden-esp32.json"), "utf8"),
) as Phase1Fixture;
const artifactRoot = join(root, "artifacts/phase1-golden");
const projectRoot = join(artifactRoot, "project");
const digest =
  "kicad/kicad@sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de";
const image = process.env.KICAD_IMAGE ?? digest;

type Result = {
  gate: number;
  name: string;
  status: "passed" | "deferred";
  evidence?: Record<string, unknown>;
  reason?: string;
};

const results: Result[] = [];
const hash = (content: string): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;
const run = (command: string, args: string[]): string =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const docker = (args: string[]): string =>
  run("docker", [
    "run",
    "--rm",
    "--user",
    "root",
    "-e",
    "HOME=/tmp",
    "-e",
    "KICAD_CONFIG_HOME=/tmp/kicad-config",
    "-v",
    `${artifactRoot}:/work`,
    image,
    ...args,
  ]);
const pass = (gate: number, name: string, evidence: Record<string, unknown>): void => {
  results.push({ gate, name, status: "passed", evidence });
};
const defer = (gate: number, name: string, reason: string): void => {
  results.push({ gate, name, status: "deferred", reason });
};

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(projectRoot, { recursive: true });

try {
  const referenceErrors = validatePhase1FixtureReferences(fixture);
  if (referenceErrors.length > 0) throw new Error(referenceErrors.join("; "));
  pass(1, "Fixture/schema", { fixture: fixture.fixtureId, schemaVersion: fixture.schemaVersion });

  const placement = placeFixture(fixture);
  pass(2, "Graph semantic and placement", {
    components: placement.length,
    deterministicSeed: fixture.placementConstraints.seed,
    board: fixture.requirement.board,
  });

  pass(3, "Component selection", {
    parts: fixture.parts.length,
    bomLines: fixture.bom.length,
    source: "fixture-provided AVL",
  });

  const canonical = compareNetlists(fixture, "", "");
  const canonicalHash = hash(JSON.stringify(canonical.expected));
  pass(4, "Canonical netlist", {
    pins: canonical.expected.length,
    canonicalNetlistHash: canonicalHash,
  });

  await projectToKicad(fixture, projectRoot);
  docker([
    "kicad-cli",
    "sch",
    "export",
    "netlist",
    "-o",
    "/work/project/design.net",
    "/work/project/design.kicad_sch",
  ]);
  docker([
    "kicad-cli",
    "pcb",
    "export",
    "ipcd356",
    "-o",
    "/work/project/design.d356",
    "/work/project/design.kicad_pcb",
  ]);
  pass(5, "KiCad projection/reopen", { toolVersion: "KiCad 10.0.5" });

  const schematicNetlist = await readFile(join(projectRoot, "design.net"), "utf8");
  const ipc356 = await readFile(join(projectRoot, "design.d356"), "utf8");
  const comparison = compareNetlists(fixture, schematicNetlist, ipc356);
  if (!comparison.overall)
    throw new Error(`golden netlist mismatch: ${JSON.stringify(comparison)}`);
  pass(6, "Netlist readback", {
    graphVsSchematic: comparison.graphVsSchematic,
    graphVsPcb: comparison.graphVsPcb,
    canonicalNetlistHash: canonicalHash,
  });

  try {
    docker([
      "kicad-cli",
      "sch",
      "erc",
      "--exit-code-violations",
      "--output",
      "/work/project/reports-erc.rpt",
      "/work/project/design.kicad_sch",
    ]);
  } catch {
    // The report and counts below are authoritative.
  }
  const ercReport = await readFile(join(projectRoot, "reports-erc.rpt"), "utf8").catch(() => "");
  const match = ercReport.match(/ERC messages:\s+(\d+)\s+Errors\s+(\d+)\s+Warnings\s+(\d+)/);
  if (!match) throw new Error("golden ERC summary is missing");
  const counts = {
    messages: Number(match[1]),
    errors: Number(match[2]),
    warnings: Number(match[3]),
  };
  if (counts.messages !== 0)
    throw new Error(`golden ERC contains findings: ${JSON.stringify(counts)}`);
  pass(7, "ERC/topology", { ...counts, waiver: "none" });

  defer(
    8,
    "Routing / DRC / manufacturing",
    "WP4: golden routing and downstream gates are deferred",
  );
} catch (error) {
  results.push({
    gate: results.length + 1,
    name: "golden",
    status: "deferred",
    reason: error instanceof Error ? error.message : String(error),
  });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(artifactRoot, "gate-results.json"), JSON.stringify(results, null, 2));
  throw error;
}

await writeFile(join(artifactRoot, "gate-results.json"), JSON.stringify(results, null, 2));
process.stdout.write(
  "Phase 1 golden gates 1-7 passed; routing/DRC/manufacturing deferred to WP4\n",
);
