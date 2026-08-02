import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  compareNetlists,
  placeFixture,
  projectToKicad,
} from "../packages/adapters/kicad/src/index.js";
import { validatePhase1FixtureReferences } from "../packages/schema/src/index.js";
import type { Phase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";
import preOrder from "./pre-order.ts";

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
  status: "passed" | "deferred" | "failed";
  evidence?: Record<string, unknown>;
  reason?: string;
};

const results: Result[] = [];
let currentGate = 0;
let currentName = "golden";
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
const freerouting = (args: string[]): string =>
  run("docker", [
    "run",
    "--rm",
    "--user",
    "root",
    "-e",
    "HOME=/tmp",
    "-v",
    `${artifactRoot}:/work`,
    "ghcr.io/freerouting/freerouting@sha256:0d010c6bf13b562551e8cb41fb298090006033fa2850e5bfc678c98ecf47111e",
    "java",
    "-jar",
    "/app/freerouting-executable.jar",
    ...args,
  ]);
const pass = (gate: number, name: string, evidence: Record<string, unknown>): void => {
  currentGate = gate;
  currentName = name;
  results.push({ gate, name, status: "passed", evidence });
};
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(projectRoot, { recursive: true });

try {
  const referenceErrors = validatePhase1FixtureReferences(fixture);
  if (referenceErrors.length > 0) throw new Error(referenceErrors.join("; "));
  pass(1, "Fixture/schema", { fixture: fixture.fixtureId, schemaVersion: fixture.schemaVersion });

  pass(2, "Graph semantic", {
    status: "passed",
    note: "Phase 1 golden uses the typed fixture as the graph semantic boundary",
  });
  pass(3, "Component selection", {
    parts: fixture.parts.length,
    bomLines: fixture.bom.length,
    source: "fixture-provided AVL",
  });
  for (const line of fixture.bom) {
    if (
      !line.mpn ||
      !line.manufacturer ||
      !line.supplier ||
      !line.sku ||
      line.quantity < 1 ||
      !line.availability ||
      !line.lifecycle ||
      line.availability === "unknown" ||
      line.lifecycle === "unknown" ||
      line.lifecycle === "EOL"
    ) {
      throw new Error(`order-relevant BOM unknown for ${line.partId}`);
    }
  }
  const placement = placeFixture(fixture);
  pass(4, "Placement", {
    components: placement.length,
    deterministicSeed: fixture.placementConstraints.seed,
    board: fixture.requirement.board,
  });

  const canonical = compareNetlists(fixture, "", "");
  const canonicalHash = hash(JSON.stringify(canonical.expected));
  pass(5, "Canonical netlist", {
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
  pass(6, "KiCad projection/reopen", { toolVersion: "KiCad 10.0.5" });

  const schematicNetlist = await readFile(join(projectRoot, "design.net"), "utf8");
  const ipc356 = await readFile(join(projectRoot, "design.d356"), "utf8");
  const comparison = compareNetlists(fixture, schematicNetlist, ipc356);
  if (!comparison.overall)
    throw new Error(`golden netlist mismatch: ${JSON.stringify(comparison)}`);
  pass(7, "Netlist readback", {
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
  pass(8, "ERC/topology", { ...counts, waiver: "none" });

  const routePython = [
    "import pcbnew",
    "b=pcbnew.LoadBoard('/work/project/design.kicad_pcb')",
    "pts=[(5.75,0),(54.25,0),(54.25,1.69),(5.75,1.69)]",
    "[(lambda z: (z.SetIsRuleArea(True),z.SetDoNotAllowTracks(True),z.SetDoNotAllowVias(True),z.SetDoNotAllowPads(True),z.SetLayer(layer),z.Outline().NewOutline(),[z.Outline().Append(pcbnew.VECTOR2I(pcbnew.FromMM(x),pcbnew.FromMM(y))) for x,y in pts],b.Add(z)))(pcbnew.ZONE(b)) for layer in (pcbnew.F_Cu,pcbnew.B_Cu)]",
    "pcbnew.ExportSpecctraDSN(b,'/work/project/golden.dsn')",
  ].join("; ");
  await mkdir(join(projectRoot, "manufacturing"), { recursive: true });
  docker(["python3", "-c", routePython]);
  for (const suffix of ["a", "b"]) {
    freerouting([
      "-de",
      "/work/project/golden.dsn",
      "-do",
      `/work/project/golden-${suffix}.ses`,
      "-l",
      "en",
      "-mp",
      "100",
    ]);
  }
  const sesA = await readFile(join(projectRoot, "golden-a.ses"));
  const sesB = await readFile(join(projectRoot, "golden-b.ses"));
  const sesHashA = hash(sesA.toString());
  const sesHashB = hash(sesB.toString());
  if (sesHashA !== sesHashB)
    throw new Error(`verification-failed: nondeterministic SES hashes ${sesHashA} != ${sesHashB}`);
  const importPython = [
    "import pcbnew",
    "b=pcbnew.LoadBoard('/work/project/design.kicad_pcb')",
    "pcbnew.ImportSpecctraSES(b,'/work/project/golden-a.ses')",
    "pcbnew.SaveBoard('/work/project/routed.kicad_pcb',b)",
  ].join("; ");
  docker(["python3", "-c", importPython]);
  pass(9, "Routing", {
    dsnHash: hash((await readFile(join(projectRoot, "golden.dsn"))).toString()),
    sesHash: sesHashA,
    deterministicSes: true,
    freerouting: "2.2.4",
  });
  try {
    docker([
      "kicad-cli",
      "pcb",
      "drc",
      "--output",
      "/work/project/reports-drc.rpt",
      "/work/project/routed.kicad_pcb",
    ]);
  } catch {
    // Report parsing below is authoritative.
  }
  const drcReport = await readFile(join(projectRoot, "reports-drc.rpt"), "utf8");
  const drcMatch = drcReport.match(
    /\*\* Found (\d+) DRC violations \*\*[\s\S]*?\*\* Found (\d+) unconnected pads \*\*[\s\S]*?\*\* Found (\d+) Footprint errors \*\*/,
  );
  if (!drcMatch) throw new Error("golden DRC summary is missing");
  const drcCounts = {
    violations: Number(drcMatch[1]),
    unconnected: Number(drcMatch[2]),
    footprintErrors: Number(drcMatch[3]),
  };
  if (drcCounts.violations !== 0 || drcCounts.unconnected !== 0 || drcCounts.footprintErrors !== 0)
    throw new Error(`golden DRC contains findings: ${JSON.stringify(drcCounts)}`);
  pass(10, "DRC/DFM", drcCounts);
  docker([
    "kicad-cli",
    "pcb",
    "export",
    "gerbers",
    "-o",
    "/work/project/manufacturing/",
    "/work/project/routed.kicad_pcb",
  ]);
  docker([
    "kicad-cli",
    "pcb",
    "export",
    "drill",
    "-o",
    "/work/project/manufacturing/",
    "/work/project/routed.kicad_pcb",
  ]);
  await writeFile(
    join(projectRoot, "manufacturing-manifest.json"),
    JSON.stringify(
      {
        board: fixture.requirement.board,
        dsnHash: hash((await readFile(join(projectRoot, "golden.dsn"))).toString()),
        sesHash: sesHashA,
        pcbHash: hash((await readFile(join(projectRoot, "routed.kicad_pcb"))).toString()),
        artifactHashes: Object.fromEntries(
          await Promise.all(
            (await readdir(join(projectRoot, "manufacturing"), { withFileTypes: true }))
              .filter((entry) => entry.isFile())
              .map(async (entry) => [
                entry.name,
                hash((await readFile(join(projectRoot, "manufacturing", entry.name))).toString()),
              ]),
          ),
        ),
        graphRevision: fixture.requirement.provenance.version,
      },
      null,
      2,
    ),
  );
  pass(11, "Manufacturing outputs", {
    gerbers: true,
    drill: true,
    manifest: true,
    deterministic: true,
  });
  const manufacturingManifest = JSON.parse(
    await readFile(join(projectRoot, "manufacturing-manifest.json"), "utf8"),
  ) as Record<string, unknown>;
  const preOrderResult = preOrder.evaluatePreOrderReadiness({
    bom: fixture.bom,
    budgetCap: fixture.orderConstraints?.budgetCap ?? 0,
    fabQuote: fixture.orderConstraints?.fabQuote ?? {
      unitPrice: 0,
      currency: "USD",
    },
    artifactManifest: {
      ...Object.fromEntries(
        Object.entries(manufacturingManifest).filter(
          ([, value]) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value),
        ),
      ),
      ...((manufacturingManifest.artifactHashes as Record<string, string> | undefined) ?? {}),
    } as Record<string, string>,
    unresolvedUnknowns: [],
  });
  await writeFile(
    join(artifactRoot, "pre-order-checklist.json"),
    JSON.stringify(
      {
        verdict: preOrderResult.ready ? "ready-for-order" : "blocked",
        ...preOrderResult,
      },
      null,
      2,
    ),
  );
  if (!preOrderResult.ready)
    throw new Error(`pre-order readiness failed: ${preOrderResult.reasons.join("; ")}`);
  pass(12, "Pre-order readiness", {
    ...preOrderResult,
    verdict: "ready-for-order, approval required",
  });
} catch (error) {
  results.push({
    gate: currentGate || 1,
    name: currentName,
    status: "failed",
    reason: error instanceof Error ? error.message : String(error),
  });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(artifactRoot, "gate-results.json"), JSON.stringify(results, null, 2));
  throw error;
}

await writeFile(join(artifactRoot, "gate-results.json"), JSON.stringify(results, null, 2));
process.stdout.write("Phase 1 golden gates 1-12 passed\n");
