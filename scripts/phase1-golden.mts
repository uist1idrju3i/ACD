import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  compareNetlists,
  placeFixture,
  projectToKicad,
} from "../packages/adapters/kicad/src/index.js";
import {
  buildSpiceAnalyses,
  evaluateSpiceRuns,
  measurementMargin,
  parseMeasurement,
  type SpiceRun,
} from "../packages/adapters/spice/src/index.js";
import {
  applyFixturePatch,
  buildTestPlan,
  createFabFeedbackReceivedEvent,
  createKnowledgeCandidate,
  createKnowledgeCandidateCreatedEvent,
  createKnowledgeTransitionedEvent,
  evaluateDesignRationale,
  evaluateFixtureGates,
  failedFindings,
  lintElectricalTopology,
  recordedProposer,
  repairLoopEvidence,
  rulesForFabProfile,
  runRepairLoop,
  transitionKnowledgeItem,
  InMemoryEventLog,
  unresolvedFindings,
  unresolvedRationaleFindings,
  unresolvedTestPlanFindings,
  type FixturePatchOperation,
  type RecordedProposal,
} from "../packages/graph-core/src/index.js";
import {
  FixtureFabFeedbackReader,
  fabFeedbackUnknownError,
  intakeFabFeedback,
  referenceIndexFromPhase1Fixture,
} from "../packages/adapters/fab-feedback/src/index.js";
import {
  gateByOrder,
  loadGateMatrix,
  missingExecutedGates,
  validatePhase1FixtureReferences,
} from "../packages/schema/src/index.js";
import { loadSchemaValidator } from "../packages/schema/src/index.js";
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
const designGraphValidator = await loadSchemaValidator("design-graph");

type Result = {
  gate: number;
  name: string;
  status: "passed" | "deferred" | "failed";
  evidence?: Record<string, unknown>;
  reason?: string;
};

const gateMatrix = await loadGateMatrix();
const gateIds = gateMatrix.gates.map((gate) => gate.id);
const results: Result[] = [];
let currentGate = 0;
let currentName = "golden";
const hash = (content: string): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;
const run = (command: string, args: string[]): string =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const dockerArgs = (args: string[]): string[] => [
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
];
const docker = (args: string[]): string => run("docker", dockerArgs(args));
/** Keeps both streams: a tool may report a diagnostic on stderr and still exit cleanly. */
const dockerOutput = (args: string[]): { stdout: string; stderr: string } => {
  const result = spawnSync("docker", dockerArgs(args), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw Object.assign(new Error(`docker ${args.join(" ")} exited ${String(result.status)}`), {
      stdout: result.stdout,
      stderr: result.stderr,
      status: result.status ?? 1,
    });
  }
  return { stdout: result.stdout, stderr: result.stderr };
};
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
/** Names the gate being evaluated so a stop is recorded against it, not against the last pass. */
const enter = (gate: number): void => {
  currentGate = gate;
  currentName = gateByOrder(gateMatrix, gate).name;
};
const pass = (gate: number, evidence: Record<string, unknown>): void => {
  enter(gate);
  results.push({ gate, name: currentName, status: "passed", evidence });
};
await rm(artifactRoot, { recursive: true, force: true });
await mkdir(projectRoot, { recursive: true });

try {
  enter(1);
  const referenceErrors = validatePhase1FixtureReferences(fixture);
  if (referenceErrors.length > 0) throw new Error(referenceErrors.join("; "));
  pass(1, { fixture: fixture.fixtureId, schemaVersion: fixture.schemaVersion });

  pass(2, {
    status: "passed",
    note: "Phase 1 golden uses the typed fixture as the graph semantic boundary",
  });
  enter(3);
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
  pass(3, {
    parts: fixture.parts.length,
    bomLines: fixture.bom.length,
    source: "fixture-provided AVL",
  });
  enter(4);
  const placement = placeFixture(fixture);
  pass(4, {
    components: placement.length,
    deterministicSeed: fixture.placementConstraints.seed,
    board: fixture.requirement.board,
  });

  enter(5);
  const canonical = compareNetlists(fixture, "", "");
  const canonicalHash = hash(JSON.stringify(canonical.expected));
  pass(5, {
    pins: canonical.expected.length,
    canonicalNetlistHash: canonicalHash,
  });

  enter(14);
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

  enter(15);
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

  enter(16);
  const testPlan = buildTestPlan(fixture, lint.rulesEvaluated, gateIds);
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

  enter(17);
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
    const detected = unresolvedFindings(evaluateFixtureGates(injected, gateIds));
    const missed = entry.expectedRuleIds.filter(
      (ruleId) => !detected.some((finding) => finding.ruleId === ruleId),
    );
    if (missed.length > 0) {
      throw new Error(
        `verification-failed: ${entry.caseId} was not detected by ${missed.join(", ")}`,
      );
    }
    const result = runRepairLoop({ fixture: injected, proposer, gateIds });
    if (result.status !== "repaired") {
      throw new Error(
        `verification-failed: ${entry.caseId} ${result.status}: ${result.stopReason ?? ""}`,
      );
    }
    if (unresolvedFindings(evaluateFixtureGates(result.fixture, gateIds)).length > 0) {
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

  enter(18);
  const spiceRoot = join(artifactRoot, "spice");
  await mkdir(spiceRoot, { recursive: true });
  const spicePlan = buildSpiceAnalyses(fixture);
  const analyses = spicePlan.analyses;
  if (analyses.length === 0) throw new Error("verification-failed: no SPICE analysis was derived");
  const spiceRuns: SpiceRun[] = [];
  for (const analysis of analyses) {
    const deckName = `${analysis.id.replace(/[^a-z0-9]+/g, "-")}.cir`;
    await writeFile(join(spiceRoot, deckName), analysis.deck);
    let stdout = "";
    let exitCode = 0;
    try {
      // ngspice prints its banner, version and most diagnostics on stderr even when the run
      // succeeds, so the log keeps both streams.
      const output = dockerOutput(["ngspice", "-b", `/work/spice/${deckName}`]);
      stdout = `${output.stdout}${output.stderr}`;
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; status?: number };
      stdout = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      exitCode = failure.status ?? 1;
    }
    await writeFile(join(spiceRoot, `${deckName}.log`), stdout);
    spiceRuns.push({ analysisId: analysis.id, stdout, exitCode });
  }
  const engineVersion = /ngspice-([0-9.]+)/.exec(spiceRuns[0]?.stdout ?? "")?.[1];
  const spice = evaluateSpiceRuns(spicePlan, spiceRuns, engineVersion);
  if (spice.verdict !== "pass") {
    throw new Error(
      `verification-failed: spice ${spice.verdict}: ${JSON.stringify(
        spice.findings.filter((finding) => finding.status !== "pass"),
      )}`,
    );
  }
  const spiceEvidence = analyses.map((analysis) => {
    const stdout = spiceRuns.find((run) => run.analysisId === analysis.id)?.stdout ?? "";
    const value = parseMeasurement(stdout, analysis.measurement.name);
    return {
      analysisId: analysis.id,
      subject: analysis.subject,
      measurement: analysis.measurement,
      observed: value,
      margin: value === undefined ? undefined : measurementMargin(analysis, value),
      models: analysis.models,
      assumptions: analysis.assumptions,
      testItemId: analysis.testItemId,
      deckHash: hash(analysis.deck),
      outputHash: hash(stdout),
    };
  });
  await writeFile(join(spiceRoot, "results.json"), `${JSON.stringify(spiceEvidence, null, 2)}\n`);
  pass(18, {
    engine: "ngspice",
    engineVersion,
    image,
    verdict: spice.verdict,
    analyses: analyses.length,
    rulesEvaluated: spice.rulesEvaluated.length,
    resultsHash: hash(JSON.stringify(spiceEvidence)),
    artifact: "spice/results.json",
  });

  enter(19);
  const fabFeedbackReader = new FixtureFabFeedbackReader(
    join(root, "fixtures/phase3/fab-report-prototype-1.json"),
  );
  const fabFeedbackReport = await fabFeedbackReader.read();
  const fabFeedback = intakeFabFeedback(
    fabFeedbackReport,
    referenceIndexFromPhase1Fixture(fixture),
  );
  const fabFeedbackUnknown =
    fabFeedback.verdict === "unknown"
      ? fabFeedbackUnknownError(fabFeedback.evidence.value.unknownFindingIds)
      : undefined;
  const fabFeedbackEventLog = new InMemoryEventLog();
  await fabFeedbackEventLog.append(
    createFabFeedbackReceivedEvent({
      eventId: "event:fab-feedback:prototype-1-jlcpcb-001",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "fixture:fab-report-prototype-1-jlcpcb",
      projectId: fixture.fixtureId,
      baseRevision: 0,
      resultRevision: 0,
      report: fabFeedbackReport,
      intake: fabFeedback,
    }),
  );
  await writeFile(
    join(artifactRoot, "fab-feedback.json"),
    `${JSON.stringify(
      {
        report: fabFeedbackReport,
        intake: fabFeedback,
        ...(fabFeedbackUnknown
          ? {
              unknown: {
                code: fabFeedbackUnknown.code,
                severity: fabFeedbackUnknown.severity,
                action: fabFeedbackUnknown.context.action,
                findingIds: fabFeedbackUnknown.context.findingIds,
              },
            }
          : {}),
        events: await fabFeedbackEventLog.readAll(),
      },
      null,
      2,
    )}\n`,
  );
  if (fabFeedback.verdict === "unknown") {
    throw fabFeedbackUnknownError(fabFeedback.evidence.value.unknownFindingIds);
  }
  pass(19, {
    reportId: fabFeedbackReport.reportId,
    fixtureDerived: fabFeedbackReport.source.fixtureDerived,
    findings: fabFeedback.findings.length,
    derivationHash: fabFeedback.derivationHash,
    evidence: fabFeedback.evidence,
    artifact: "fab-feedback.json",
  });

  enter(20);
  const passingFindings = fabFeedback.findings
    .filter((finding) => finding.verdict === "pass")
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
  if (passingFindings.length === 0) {
    throw new Error("verification-failed: fab feedback produced no passing findings");
  }
  const knowledgeEventLog = new InMemoryEventLog();
  const knowledgeStates: Array<{
    candidate: Awaited<ReturnType<typeof createKnowledgeCandidate>>;
    reviewed: Awaited<ReturnType<typeof transitionKnowledgeItem>>;
    adopted: Awaited<ReturnType<typeof transitionKnowledgeItem>>;
  }> = [];
  const validateKnowledgeItem = (
    knowledgeItem: (typeof knowledgeStates)[number]["candidate"],
  ): void => {
    const graph = {
      schemaVersion: "0.1.0-draft",
      project: { id: fixture.fixtureId, type: "Project", revision: 0 },
      entities: [knowledgeItem],
    };
    if (!designGraphValidator(graph)) {
      throw new Error(
        `schema-invalid: knowledge item ${knowledgeItem.id}: ${(designGraphValidator.errors ?? [])
          .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
          .join("; ")}`,
      );
    }
  };
  let knowledgeRevision = 0;
  for (const finding of passingFindings) {
    const candidate = createKnowledgeCandidate({
      finding,
      report: fabFeedbackReport,
      sourceEventId: "event:fab-feedback:prototype-1-jlcpcb-001",
      designRevision: fabFeedbackReport.target.designRevision,
      derivationInputHash: fabFeedback.evidence.value.derivationInputHash,
      derivationOutputHash: fabFeedback.evidence.value.derivationOutputHash,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const reviewed = transitionKnowledgeItem(candidate, {
      status: "reviewed",
      now: "2026-01-01T00:00:00.000Z",
    });
    const adopted = transitionKnowledgeItem(reviewed, {
      status: "adopted",
      now: "2026-01-01T00:00:00.000Z",
    });
    try {
      validateKnowledgeItem(candidate);
      validateKnowledgeItem(reviewed);
      validateKnowledgeItem(adopted);
    } catch (error) {
      await writeFile(
        join(artifactRoot, "knowledge.json"),
        `${JSON.stringify(
          {
            knowledgeStates,
            failure: {
              code: "schema-invalid",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          null,
          2,
        )}\n`,
      );
      throw error;
    }
    knowledgeStates.push({ candidate, reviewed, adopted });
    await knowledgeEventLog.append(
      createKnowledgeCandidateCreatedEvent({
        eventId: `event:knowledge:candidate:prototype-1:${finding.findingId}`,
        occurredAt: "2026-01-01T00:00:00.000Z",
        actor: "fixture:fab-report-prototype-1-jlcpcb",
        projectId: fixture.fixtureId,
        baseRevision: knowledgeRevision,
        resultRevision: knowledgeRevision + 1,
        knowledgeItem: candidate,
      }),
    );
    knowledgeRevision += 1;
    await knowledgeEventLog.append(
      createKnowledgeTransitionedEvent({
        eventId: `event:knowledge:reviewed:prototype-1:${finding.findingId}`,
        occurredAt: "2026-01-01T00:00:00.000Z",
        actor: "fixture:fab-report-prototype-1-jlcpcb",
        projectId: fixture.fixtureId,
        baseRevision: knowledgeRevision,
        resultRevision: knowledgeRevision + 1,
        knowledgeItem: reviewed,
        previousStatus: "candidate",
      }),
    );
    knowledgeRevision += 1;
    await knowledgeEventLog.append(
      createKnowledgeTransitionedEvent({
        eventId: `event:knowledge:adopted:prototype-1:${finding.findingId}`,
        occurredAt: "2026-01-01T00:00:00.000Z",
        actor: "fixture:fab-report-prototype-1-jlcpcb",
        projectId: fixture.fixtureId,
        baseRevision: knowledgeRevision,
        resultRevision: knowledgeRevision + 1,
        knowledgeItem: adopted,
        previousStatus: "reviewed",
      }),
    );
    knowledgeRevision += 1;
  }
  const knowledgeEvents = await knowledgeEventLog.readAll();
  const knowledgeText = JSON.stringify({ knowledgeStates, events: knowledgeEvents }, null, 2);
  await writeFile(join(artifactRoot, "knowledge.json"), `${knowledgeText}\n`);
  const profileRules = rulesForFabProfile(fabFeedbackReport.fabProfileId);
  if (!profileRules) throw new Error(`schema-invalid: missing fab profile rules`);
  pass(20, {
    candidateCount: knowledgeStates.length,
    adoptedIds: knowledgeStates.map((state) => state.adopted.id),
    input: {
      derivationHash: fabFeedback.derivationHash,
      rulesVersion: profileRules.version,
      sourceEventId: "event:fab-feedback:prototype-1-jlcpcb-001",
    },
    output: {
      knowledgeHash: hash(knowledgeText),
      eventCount: knowledgeEvents.length,
    },
    artifact: "knowledge.json",
  });

  enter(6);
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

  enter(7);
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

  enter(8);
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

  enter(9);
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
  enter(10);
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
  enter(11);
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
  enter(12);
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
