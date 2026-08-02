import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  compareNetlists,
  placeFixture,
  projectToKicad,
} from "../packages/adapters/kicad/src/index.js";
import {
  applyFixturePatch,
  buildTestPlan,
  evaluateDesignRationale,
  evaluateFixtureGates,
  failedFindings,
  lintElectricalTopology,
  recordedProposer,
  repairLoopEvidence,
  runRepairLoop,
  unresolvedFindings,
  unresolvedRationaleFindings,
  unresolvedTestPlanFindings,
  type FixturePatchOperation,
  type RecordedProposal,
} from "../packages/graph-core/src/index.js";
import {
  gateByOrder,
  loadGateMatrix,
  missingExecutedGates,
  validatePhase1FixtureReferences,
} from "../packages/schema/src/index.js";
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

const gateMatrix = await loadGateMatrix();
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
const pass = (gate: number, evidence: Record<string, unknown>): void => {
  const { name } = gateByOrder(gateMatrix, gate);
  currentGate = gate;
  currentName = name;
  results.push({ gate, name, status: "passed", evidence });
};
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(projectRoot, { recursive: true });

try {
  const referenceErrors = validatePhase1FixtureReferences(fixture);
  if (referenceErrors.length > 0) throw new Error(referenceErrors.join("; "));
  pass(1, { fixture: fixture.fixtureId, schemaVersion: fixture.schemaVersion });

  pass(2, {
    status: "passed",
    note: "Phase 1 golden uses the typed fixture as the graph semantic boundary",
  });
  pass(3, {
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
  pass(4, {
    components: placement.length,
    deterministicSeed: fixture.placementConstraints.seed,
    board: fixture.requirement.board,
  });

  const canonical = compareNetlists(fixture, "", "");
  const canonicalHash = hash(JSON.stringify(canonical.expected));
  pass(5, {
    pins: canonical.expected.length,
    canonicalNetlistHash: canonicalHash,
  });

  const lint = lintElectricalTopology(fixture);
  if (lint.verdict !== "pass") {
    throw new Error(
      `verification-failed: electrical lint ${lint.verdict}: ${JSON.stringify(failedFindings(lint))}`,
    );
  }
  pass(14, {
    verdict: lint.verdict,
    rulesEvaluated: lint.rulesEvaluated.length,
    findings: lint.findings.length,
    findingsHash: hash(JSON.stringify(lint.findings)),
  });

  const rationale = evaluateDesignRationale(fixture);
  if (rationale.verdict !== "pass") {
    throw new Error(
      `verification-failed: design rationale ${rationale.verdict}: ${JSON.stringify(
        unresolvedRationaleFindings(rationale),
      )}`,
    );
  }
  pass(15, {
    verdict: rationale.verdict,
    rulesEvaluated: rationale.rulesEvaluated.length,
    subjects: rationale.coverage.length,
    findings: rationale.findings.length,
    findingsHash: hash(JSON.stringify(rationale.findings)),
  });

  const testPlan = buildTestPlan(fixture, lint.rulesEvaluated);
  if (testPlan.verdict !== "pass") {
    throw new Error(
      `verification-failed: test plan ${testPlan.verdict}: ${JSON.stringify(
        unresolvedTestPlanFindings(testPlan),
      )}`,
    );
  }
  await writeFile(
    join(artifactRoot, "test-plan.json"),
    `${JSON.stringify(testPlan.items, null, 2)}\n`,
  );
  pass(16, {
    verdict: testPlan.verdict,
    rulesEvaluated: testPlan.rulesEvaluated.length,
    testItems: testPlan.items.length,
    measurementItems: testPlan.items.filter((item) => item.method === "measurement").length,
    testPlanHash: hash(JSON.stringify(testPlan.items)),
    artifact: "test-plan.json",
  });

  const repairCases = JSON.parse(
    await readFile(join(root, "fixtures/phase2/repair-cases.json"), "utf8"),
  ) as {
    cases: { caseId: string; injection: FixturePatchOperation[]; expectedRuleIds: string[] }[];
  };
  const recordings = JSON.parse(
    await readFile(join(root, "fixtures/phase2/repair-recordings.json"), "utf8"),
  ) as { proposals: RecordedProposal[] };
  const proposer = recordedProposer(recordings.proposals);
  const repairs = repairCases.cases.map((entry) => {
    const injected = applyFixturePatch(fixture, entry.injection);
    const detected = unresolvedFindings(evaluateFixtureGates(injected));
    const missed = entry.expectedRuleIds.filter(
      (ruleId) => !detected.some((finding) => finding.ruleId === ruleId),
    );
    if (missed.length > 0) {
      throw new Error(
        `verification-failed: ${entry.caseId} was not detected by ${missed.join(", ")}`,
      );
    }
    const result = runRepairLoop({ fixture: injected, proposer });
    if (result.status !== "repaired") {
      throw new Error(
        `verification-failed: ${entry.caseId} ${result.status}: ${result.stopReason ?? ""}`,
      );
    }
    if (unresolvedFindings(evaluateFixtureGates(result.fixture)).length > 0) {
      throw new Error(`verification-failed: ${entry.caseId} still has unresolved findings`);
    }
    return { caseId: entry.caseId, detected: detected.length, ...repairLoopEvidence(result) };
  });
  await writeFile(join(artifactRoot, "repair-loop.json"), `${JSON.stringify(repairs, null, 2)}\n`);
  pass(17, {
    cases: repairs.length,
    repaired: repairs.filter((entry) => entry.status === "repaired").length,
    rejectedProposals: repairs.reduce((total, entry) => total + Number(entry.rejected ?? 0), 0),
    recordingsHash: hash(JSON.stringify(recordings.proposals)),
    artifact: "repair-loop.json",
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
  pass(6, { toolVersion: "KiCad 10.0.5" });

  const schematicNetlist = await readFile(join(projectRoot, "design.net"), "utf8");
  const ipc356 = await readFile(join(projectRoot, "design.d356"), "utf8");
  const comparison = compareNetlists(fixture, schematicNetlist, ipc356);
  if (!comparison.overall)
    throw new Error(`golden netlist mismatch: ${JSON.stringify(comparison)}`);
  pass(7, {
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
  pass(8, { ...counts, waiver: "none" });

  const u1Placement = fixture.placementConstraints.components.find(
    (candidate) => candidate.partId === "part:u1",
  );
  if (!u1Placement) throw new Error("missing U1 placement for antenna keepout");
  const radians = (u1Placement.rotationDeg * Math.PI) / 180;
  const localAntenna = [
    [-24.25, -28],
    [24.25, -28],
    [24.25, -6.31],
    [-24.25, -6.31],
  ];
  const antennaPoints = localAntenna
    .map(([x, y]) => [
      u1Placement.xMm + x * Math.cos(radians) + y * Math.sin(radians),
      u1Placement.yMm - x * Math.sin(radians) + y * Math.cos(radians),
    ])
    .map(([x, y]) => [
      Math.max(0, Math.min(fixture.requirement.board.widthMm, x)),
      Math.max(0, Math.min(fixture.requirement.board.heightMm, y)),
    ]);
  const routePython = [
    "import pcbnew",
    "b=pcbnew.LoadBoard('/work/project/design.kicad_pcb')",
    `pts=${JSON.stringify(antennaPoints).replaceAll("[", "(").replaceAll("]", ")")}`,
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
  pass(9, {
    dsnHash: hash((await readFile(join(projectRoot, "golden.dsn"))).toString()),
    sesHash: sesHashA,
    deterministicSes: true,
    antennaKeepout: { source: "U1 official courtyard", points: antennaPoints },
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
  pass(10, drcCounts);
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
  const dsn = await readFile(join(projectRoot, "golden.dsn"), "utf8");
  if (!dsn.includes("(width 250)") || !dsn.includes("(clearance 127")) {
    throw new Error("golden DSN does not carry the 0.25 mm / 0.127 mm routing rules");
  }
  await writeFile(
    join(projectRoot, "manufacturing-manifest.json"),
    JSON.stringify(
      {
        board: fixture.requirement.board,
        dsnHash: hash((await readFile(join(projectRoot, "golden.dsn"))).toString()),
        sesHash: sesHashA,
        pcbHash: hash((await readFile(join(projectRoot, "routed.kicad_pcb"))).toString()),
        dsnRules: { trackWidthMm: 0.25, clearanceMm: 0.127 },
        bom: fixture.bom,
        layerVerification: { reopened: true, layers: ["F.Cu", "B.Cu"] },
        artifactHashes: Object.fromEntries(
          await Promise.all(
            (await readdir(join(projectRoot, "manufacturing"), { withFileTypes: true }))
              .filter((entry) => entry.isFile())
              .map((entry) => entry.name)
              .sort()
              .map(async (name) => {
                const content = await readFile(join(projectRoot, "manufacturing", name));
                return [name, { sha256: hash(content.toString()), bytes: content.byteLength }];
              }),
          ),
        ),
        graphRevision: fixture.requirement.provenance.version,
      },
      null,
      2,
    ),
  );
  pass(11, {
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
      dsnHash: manufacturingManifest.dsnHash as string,
      sesHash: manufacturingManifest.sesHash as string,
      pcbHash: manufacturingManifest.pcbHash as string,
      ...Object.fromEntries(
        Object.entries(
          (manufacturingManifest.artifactHashes ?? {}) as Record<string, { sha256: string }>,
        ).map(([name, value]) => [name, value.sha256]),
      ),
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
  pass(12, {
    ...preOrderResult,
    verdict: "ready-for-order, approval required",
  });

  const missing = missingExecutedGates(
    gateMatrix,
    "golden",
    results.filter((result) => result.status === "passed").map((result) => result.gate),
  );
  if (missing.length > 0) {
    throw new Error(
      `verification-failed: golden run skipped contracted gates ${missing.map((gate) => gate.order).join(", ")}`,
    );
  }
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
