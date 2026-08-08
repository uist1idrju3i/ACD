import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  GraphCoreError,
  PatchEngine,
  assertFreshResult,
  readBoardModel,
  validateSemanticGraph,
  type DesignGraph,
  type ErrorCode,
} from "../packages/graph-core/src/index.js";
import {
  canonicalGraphNetlist,
  canonicalGraphPcbNetlist,
  parseIpc356,
  parseKicadNetlist,
  projectToKicad,
} from "../packages/adapters/kicad/src/index.js";
import { loadSchemaValidator, type PatchEnvelope } from "../packages/schema/src/index.js";
import { normalizedArtifact, sha256 } from "./golden-shared.mts";
import { NodeProcessPort } from "../packages/adapters/storage-fs/src/index.js";

const root = resolve(import.meta.dirname, "..");
const goldenRoot = join(root, "fixtures/golden");
const artifactRoot = join(root, "artifacts/golden");
const kicadDigest =
  "kicad/kicad@sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de";
const image = process.env.KICAD_IMAGE ?? kicadDigest;
const toolVersion = "KiCad 10.0.5";

type GoldenFixture = {
  taskId: string;
  kind: "verification" | "patch" | "tool";
  inputFixture?: string;
  expected: {
    gate?: string;
    outcome: "pass" | "fail";
    jidoka: "continue" | "stop";
    errorCode: ErrorCode | null;
    atomic?: boolean;
  };
  scenario: Record<string, unknown>;
};

type Observed = {
  outcome: "pass" | "fail";
  jidoka: "continue" | "stop";
  errorCode: ErrorCode | null;
  gate?: string;
  evidence: Record<string, unknown>;
};

const hash = sha256;

const processPort = new NodeProcessPort();
const dockerRun = async (workDirectory: string, args: string[]): Promise<string> => {
  const result = await processPort.execute({
    command: "docker",
    args: [
      "run",
      "--rm",
      "--user",
      "root",
      "-e",
      "HOME=/tmp",
      "-e",
      "KICAD_CONFIG_HOME=/tmp/kicad-config",
      "-v",
      `${workDirectory}:/work`,
      image,
      ...args,
    ],
    environment: { PWD: root },
    timeoutMs: 600_000,
    maxOutputBytes: 64 * 1024 * 1024,
    killGraceMs: 5_000,
  });
  if (result.kind !== "completed") {
    throw new Error(`docker failed: ${result.stderr || result.signal || result.kind}`);
  }
  return result.stdout;
};

const filesUnder = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
};

const validateGraphSchema = await loadSchemaValidator("design-graph");

const loadGraph = async (fixture: GoldenFixture): Promise<DesignGraph> => {
  const inputFixture = fixture.inputFixture ?? "design-graphs/normal-2layer.json";
  const graph = JSON.parse(await readFile(join(root, "fixtures", inputFixture), "utf8")) as unknown;
  if (!validateGraphSchema(graph)) {
    throw new GraphCoreError(
      "schema-invalid",
      (validateGraphSchema.errors ?? [])
        .map((error) => `${error.instancePath} ${error.message}`)
        .join("; "),
    );
  }
  const designGraph = graph as DesignGraph;
  validateSemanticGraph(designGraph);
  return designGraph;
};

type JsonRecord = Record<string, unknown>;

const attributesOf = (graph: DesignGraph, entityId: string): JsonRecord => {
  const entity = graph.entities.find((candidate) => candidate.id === entityId);
  if (!entity?.attributes) {
    throw new GraphCoreError("reference-integrity", `missing entity attributes: ${entityId}`);
  }
  return entity.attributes as JsonRecord;
};

/** Moves the ground power flag onto the supply net so that two power outputs collide. */
const mutateDuplicatePowerDriver = (graph: DesignGraph): DesignGraph => {
  const mutated = structuredClone(graph);
  const ground = attributesOf(mutated, "net:gnd");
  const supply = attributesOf(mutated, "net:vcc");
  ground["pinIds"] = (ground["pinIds"] as string[]).filter((pinId) => pinId !== "pin:flg2-1");
  supply["pinIds"] = [...(supply["pinIds"] as string[]), "pin:flg2-1"];
  return mutated;
};

/** Moves the LED on top of the series resistor so that copper clearance is violated. */
const mutateOverlappingPlacement = (graph: DesignGraph): DesignGraph => {
  const mutated = structuredClone(graph);
  const layout = attributesOf(mutated, "layout:main");
  const placements = layout["placements"] as JsonRecord[];
  const led = placements.find((placement) => placement["componentId"] === "component:d1");
  if (!led) throw new GraphCoreError("reference-integrity", "missing placement for component:d1");
  led["xMm"] = 8.6;
  return mutated;
};

type ErcCounts = { messages: number; errors: number; warnings: number };
type DrcCounts = { violations: number; unconnected: number; footprintErrors: number };

const runErc = async (workDirectory: string, project: string): Promise<void> => {
  try {
    await dockerRun(workDirectory, [
      "kicad-cli",
      "sch",
      "erc",
      "--exit-code-violations",
      "--output",
      `/work/${project}/erc.rpt`,
      `/work/${project}/design.kicad_sch`,
    ]);
  } catch {
    // The report is authoritative; --exit-code-violations intentionally returns non-zero.
  }
};

const readErc = async (workDirectory: string, project: string): Promise<ErcCounts> => {
  const report = await readFile(join(workDirectory, project, "erc.rpt"), "utf8").catch(() => "");
  const match = report.match(/ERC messages:\s+(\d+)\s+Errors\s+(\d+)\s+Warnings\s+(\d+)/);
  if (!match) throw new GraphCoreError("verification-failed", "ERC summary is missing");
  return { messages: Number(match[1]), errors: Number(match[2]), warnings: Number(match[3]) };
};

const readDrc = async (workDirectory: string, project: string): Promise<DrcCounts> => {
  await dockerRun(workDirectory, [
    "kicad-cli",
    "pcb",
    "drc",
    "--output",
    `/work/${project}/drc.rpt`,
    `/work/${project}/design.kicad_pcb`,
  ]);
  const report = await readFile(join(workDirectory, project, "drc.rpt"), "utf8");
  const violations = report.match(/Found ([0-9]+) DRC violations/);
  const unconnected = report.match(/Found ([0-9]+) unconnected (?:items|pads)/);
  const footprintErrors = report.match(/Found ([0-9]+) Footprint errors/);
  if (!violations || !unconnected || !footprintErrors) {
    throw new GraphCoreError("verification-failed", "DRC summary is missing");
  }
  return {
    violations: Number(violations[1]),
    unconnected: Number(unconnected[1]),
    footprintErrors: Number(footprintErrors[1]),
  };
};

const runNormalTask = async (fixture: GoldenFixture, workDirectory: string): Promise<Observed> => {
  const graph = await loadGraph(fixture);
  const model = readBoardModel(graph);
  const projectDirectory = join(workDirectory, "project");
  await projectToKicad(graph, projectDirectory);
  await dockerRun(workDirectory, [
    "kicad-cli",
    "sch",
    "export",
    "netlist",
    "-o",
    "/work/project/design.net",
    "/work/project/design.kicad_sch",
  ]);
  await dockerRun(workDirectory, [
    "kicad-cli",
    "pcb",
    "export",
    "ipcd356",
    "-o",
    "/work/project/design.d356",
    "/work/project/design.kicad_pcb",
  ]);
  const expectedSchematic = canonicalGraphNetlist(model);
  const expectedPcb = canonicalGraphPcbNetlist(model);
  const schematicReadback = parseKicadNetlist(
    await readFile(join(projectDirectory, "design.net"), "utf8"),
  );
  const pcbReadback = parseIpc356(await readFile(join(projectDirectory, "design.d356"), "utf8"));
  const graphVsSchematic = JSON.stringify(expectedSchematic) === JSON.stringify(schematicReadback);
  const graphVsPcb = JSON.stringify(expectedPcb) === JSON.stringify(pcbReadback);
  if (!graphVsSchematic || !graphVsPcb) {
    throw new GraphCoreError(
      "verification-failed",
      "the graph netlist and the KiCad readback differ",
      "error",
      { expectedSchematic, schematicReadback, expectedPcb, pcbReadback },
    );
  }
  await runErc(workDirectory, "project");
  const erc = await readErc(workDirectory, "project");
  if (erc.messages !== 0) {
    throw new GraphCoreError("verification-failed", "ERC contains unwaived findings", "error", erc);
  }
  const drc = await readDrc(workDirectory, "project");
  if (drc.violations || drc.unconnected || drc.footprintErrors) {
    throw new GraphCoreError("verification-failed", "DRC contains findings", "error", drc);
  }
  for (const target of ["project", "repeat"]) {
    if (target === "repeat") await projectToKicad(graph, join(workDirectory, "repeat"));
    await mkdir(join(workDirectory, target, "gerbers"), { recursive: true });
    await mkdir(join(workDirectory, target, "drill"), { recursive: true });
    await dockerRun(workDirectory, [
      "kicad-cli",
      "pcb",
      "export",
      "gerbers",
      "-o",
      `/work/${target}/gerbers/`,
      `/work/${target}/design.kicad_pcb`,
    ]);
    await dockerRun(workDirectory, [
      "kicad-cli",
      "pcb",
      "export",
      "drill",
      "-o",
      `/work/${target}/drill/`,
      `/work/${target}/design.kicad_pcb`,
    ]);
  }
  const stableFiles = [
    "design.kicad_pcb",
    "design.kicad_sch",
    ...(await filesUnder(join(projectDirectory, "gerbers"))).map((file) => `gerbers/${file}`),
    ...(await filesUnder(join(projectDirectory, "drill"))).map((file) => `drill/${file}`),
  ];
  const artifactHashes: Record<string, string> = {};
  for (const file of stableFiles) {
    const primary = hash(normalizedArtifact(await readFile(join(projectDirectory, file))));
    const repeat = hash(normalizedArtifact(await readFile(join(workDirectory, "repeat", file))));
    if (primary !== repeat) {
      throw new GraphCoreError("verification-failed", `unstable artifact hash: ${file}`, "error", {
        primary,
        repeat,
      });
    }
    artifactHashes[file] = primary;
  }
  await rm(join(workDirectory, "repeat"), { recursive: true, force: true });
  return {
    outcome: "pass",
    jidoka: "continue",
    errorCode: null,
    evidence: {
      graphHash: hash(JSON.stringify(graph)),
      netlistHash: hash(JSON.stringify(expectedSchematic)),
      graphVsSchematic,
      graphVsPcb,
      erc,
      drc,
      artifactHashes,
      toolVersion,
      kicadDigest: image,
    },
  };
};

const runErcFailTask = async (fixture: GoldenFixture, workDirectory: string): Promise<Observed> => {
  const graph = mutateDuplicatePowerDriver(await loadGraph(fixture));
  await projectToKicad(graph, join(workDirectory, "project"));
  await runErc(workDirectory, "project");
  const erc = await readErc(workDirectory, "project");
  if (erc.errors === 0) {
    throw new GraphCoreError(
      "verification-failed",
      "the injected ERC violation was not detected",
      "critical",
      erc,
    );
  }
  return {
    outcome: "fail",
    jidoka: "stop",
    errorCode: "verification-failed",
    gate: "erc",
    evidence: { erc, mutation: fixture.scenario["mutation"], toolVersion },
  };
};

const runDrcFailTask = async (fixture: GoldenFixture, workDirectory: string): Promise<Observed> => {
  const graph = mutateOverlappingPlacement(await loadGraph(fixture));
  await projectToKicad(graph, join(workDirectory, "project"));
  const drc = await readDrc(workDirectory, "project");
  if (drc.violations === 0) {
    throw new GraphCoreError(
      "verification-failed",
      "the injected DRC violation was not detected",
      "critical",
      drc,
    );
  }
  return {
    outcome: "fail",
    jidoka: "stop",
    errorCode: "verification-failed",
    gate: "drc",
    evidence: { drc, mutation: fixture.scenario["mutation"], toolVersion },
  };
};

const runReopenFailTask = async (
  fixture: GoldenFixture,
  workDirectory: string,
): Promise<Observed> => {
  const graph = await loadGraph(fixture);
  const projectDirectory = join(workDirectory, "project");
  await projectToKicad(graph, projectDirectory);
  const boardPath = join(projectDirectory, "design.kicad_pcb");
  const board = await readFile(boardPath, "utf8");
  await writeFile(boardPath, board.slice(0, Math.floor(board.length / 2)), "utf8");
  let stderr = "";
  try {
    await dockerRun(workDirectory, [
      "kicad-cli",
      "pcb",
      "drc",
      "--output",
      "/work/project/drc.rpt",
      "/work/project/design.kicad_pcb",
    ]);
  } catch (error) {
    stderr = error instanceof Error ? error.message : String(error);
  }
  if (stderr === "") {
    throw new GraphCoreError(
      "verification-failed",
      "the corrupted board was reopened without an error",
      "critical",
    );
  }
  return {
    outcome: "fail",
    jidoka: "stop",
    errorCode: "reopen-failure",
    gate: "reopen",
    evidence: {
      mutation: fixture.scenario["mutation"],
      stderr: stderr.split("\n")[0],
      toolVersion,
    },
  };
};

const patchOf = (patchId: string, baseRevision: number, name: string): PatchEnvelope => ({
  patchId,
  baseRevision,
  resultRevision: baseRevision + 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  operations: [{ op: "replace", path: "/entities/@id:project:normal-2layer/name", value: name }],
});

const runPatchConflictTask = async (fixture: GoldenFixture): Promise<Observed> => {
  const graph = await loadGraph(fixture);
  const engine = new PatchEngine();
  const accepted = engine.apply(graph, 0, patchOf("patch:accepted", 0, "Accepted rename"));
  const beforeConflict = hash(JSON.stringify(accepted.graph));
  let observedError: GraphCoreError | undefined;
  try {
    engine.apply(accepted.graph, accepted.revision, patchOf("patch:conflicting", 0, "Conflict"));
  } catch (error) {
    if (!(error instanceof GraphCoreError)) throw error;
    observedError = error;
  }
  if (!observedError) {
    throw new GraphCoreError(
      "patch-conflict",
      "the conflicting patch was accepted instead of stopping",
      "critical",
    );
  }
  const afterConflict = hash(JSON.stringify(accepted.graph));
  const atomic =
    accepted.graph.entities.find((entity) => entity.id === "project:normal-2layer")?.name ===
      "Accepted rename" && beforeConflict === afterConflict;
  return {
    outcome: "fail",
    jidoka: "stop",
    errorCode: observedError.code,
    gate: "patch",
    evidence: {
      acceptedRevision: accepted.revision,
      acceptedSnapshotHash: accepted.snapshotHash,
      snapshotHashBeforeConflict: beforeConflict,
      snapshotHashAfterConflict: afterConflict,
      atomic,
      message: observedError.message,
    },
  };
};

const runStaleResultTask = async (fixture: GoldenFixture): Promise<Observed> => {
  const graph = await loadGraph(fixture);
  const engine = new PatchEngine();
  const applied = engine.apply(graph, 0, patchOf("patch:stale", 0, "Revision 1"));
  const resultRevision = Number(fixture.scenario["resultRevision"] ?? 0);
  let observedError: GraphCoreError | undefined;
  try {
    assertFreshResult(applied.revision, resultRevision);
  } catch (error) {
    if (!(error instanceof GraphCoreError)) throw error;
    observedError = error;
  }
  if (!observedError) {
    throw new GraphCoreError(
      "stale-result",
      "the stale verification result was accepted",
      "critical",
    );
  }
  return {
    outcome: "fail",
    jidoka: "stop",
    errorCode: observedError.code,
    gate: "freshness",
    evidence: {
      currentRevision: applied.revision,
      resultRevision,
      snapshotHash: applied.snapshotHash,
      message: observedError.message,
    },
  };
};

const runFixture = async (fixture: GoldenFixture, workDirectory: string): Promise<Observed> => {
  switch (fixture.taskId) {
    case "golden:normal-2layer":
      return runNormalTask(fixture, workDirectory);
    case "golden:erc-fail":
      return runErcFailTask(fixture, workDirectory);
    case "golden:drc-fail":
      return runDrcFailTask(fixture, workDirectory);
    case "golden:reopen-fail":
      return runReopenFailTask(fixture, workDirectory);
    case "golden:patch-conflict":
      return runPatchConflictTask(fixture);
    case "golden:stale-result":
      return runStaleResultTask(fixture);
    default:
      throw new GraphCoreError("schema-invalid", `unknown golden task: ${fixture.taskId}`);
  }
};

const compare = (fixture: GoldenFixture, observed: Observed): string[] => {
  const mismatches: string[] = [];
  if (observed.outcome !== fixture.expected.outcome) {
    mismatches.push(`outcome ${observed.outcome} != ${fixture.expected.outcome}`);
  }
  if (observed.jidoka !== fixture.expected.jidoka) {
    mismatches.push(`jidoka ${observed.jidoka} != ${fixture.expected.jidoka}`);
  }
  if (observed.errorCode !== fixture.expected.errorCode) {
    mismatches.push(`errorCode ${observed.errorCode} != ${fixture.expected.errorCode}`);
  }
  if (fixture.expected.gate !== undefined && observed.gate !== fixture.expected.gate) {
    mismatches.push(`gate ${observed.gate} != ${fixture.expected.gate}`);
  }
  if (fixture.expected.atomic === true && observed.evidence["atomic"] !== true) {
    mismatches.push("the rejected patch was not atomic");
  }
  return mismatches;
};

await rm(artifactRoot, { recursive: true, force: true });
await mkdir(artifactRoot, { recursive: true });

const fixtureFiles = (await readdir(goldenRoot)).filter((file) => file.endsWith(".json")).sort();
const summary: Record<string, unknown>[] = [];

for (const file of fixtureFiles) {
  const fixture = JSON.parse(await readFile(join(goldenRoot, file), "utf8")) as GoldenFixture;
  const workDirectory = join(artifactRoot, file.replace(/\.json$/, ""));
  await mkdir(join(workDirectory, "project"), { recursive: true });
  let record: Record<string, unknown>;
  try {
    const observed = await runFixture(fixture, workDirectory);
    const mismatches = compare(fixture, observed);
    record = {
      taskId: fixture.taskId,
      status: mismatches.length === 0 ? "passed" : "failed",
      expected: fixture.expected,
      observed,
      mismatches,
    };
  } catch (error) {
    record = {
      taskId: fixture.taskId,
      status: "failed",
      expected: fixture.expected,
      observed: null,
      mismatches: [error instanceof Error ? error.message : String(error)],
    };
  }
  await writeFile(join(workDirectory, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
  summary.push(record);
}

const failed = summary.filter((record) => record["status"] !== "passed");
await writeFile(
  join(artifactRoot, "summary.json"),
  `${JSON.stringify({ toolVersion, kicadDigest: image, tasks: summary }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed.length > 0) {
  process.stderr.write(`golden replay stopped: ${failed.length} task(s) did not match\n`);
  process.exitCode = 1;
}
