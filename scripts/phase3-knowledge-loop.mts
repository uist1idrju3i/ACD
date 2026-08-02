import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Phase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";
import {
  createFabFeedbackReceivedEvent,
  createKnowledgeAppliedEvent,
  createKnowledgeCandidate,
  createKnowledgeCandidateCreatedEvent,
  createKnowledgeTransitionedEvent,
  createTargetDesignKnowledgeContext,
  evaluateKnowledgeApplications,
  recordKnowledgeApplications,
  transitionKnowledgeItem,
  type FabFeedbackReport,
} from "../packages/graph-core/src/index.js";
import {
  intakeFabFeedback,
  referenceIndexFromPhase1Fixture,
} from "../packages/adapters/fab-feedback/src/index.js";
import {
  projectToKicad,
  officialLibraryRevision,
  materializeLibraryPatchInBoardSource,
  type LibraryOverlayPatch,
} from "../packages/adapters/kicad/src/index.js";

const root = resolve(import.meta.dirname, "..");
const fixturePath = join(root, "fixtures/phase1/prototype-2.json");
const artifactRoot = join(root, "artifacts/phase1-golden");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Phase1Fixture;
const patchArtifact = JSON.parse(
  await readFile(join(artifactRoot, "library-patch.json"), "utf8"),
) as { patch: LibraryOverlayPatch; libraryRevision: string };
const patch = patchArtifact.patch;
const hash = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fileHash = async (path: string): Promise<string> => hash(await readFile(path, "utf8"));

const detectMaskSliver = (board: string): boolean =>
  board.includes('(footprint "R_0603_1608Metric"') &&
  !board.includes('ACD_LibraryOverlay" "pad-mask-clearance=0.1');

const makeReport = (board: string): FabFeedbackReport => {
  const finding = {
    findingId: "P2-DFM-001",
    originalText: "Solder mask sliver below minimum near R1 pad 1.",
    severityReported: "high" as const,
    references: {
      partId: "part:p2-r1",
      footprintId: "footprint:Resistor_SMD:R_0603_1608Metric",
      ...(detectMaskSliver(board) ? { ruleId: "mask-sliver-min" } : {}),
    },
  };
  const findingText = detectMaskSliver(board)
    ? finding.originalText
    : "Deterministic DFM scan found no solder mask sliver.";
  const content = `Prototype-2 deterministic DFM scan\n${findingText}\n`;
  const contentHash = hash(content);
  return {
    schemaVersion: "0.1.0-draft",
    reportId: "fab-report:prototype-2-knowledge-loop",
    fabJobId: "job:prototype-2-knowledge-loop",
    fabProfileId: fixture.manufacturingProfile!.fabProfileId,
    source: {
      kind: "fixture",
      locator: "scripts/phase3-knowledge-loop.mts",
      contentHash,
      fixtureDerived: true,
      fixtureId: fixture.fixtureId,
    },
    target: { projectId: fixture.fixtureId, designRevision: "prototype-2" },
    rawReport: { contentType: "text/plain", content, contentHash },
    rawFindings: [{ ...finding, originalText: findingText }],
  } as FabFeedbackReport;
};

const officialProject = await projectToKicad(fixture, join(artifactRoot, "prototype-2-control"), {
  libraryRevision: officialLibraryRevision(),
});
const enabledProject = await projectToKicad(
  fixture,
  join(artifactRoot, "prototype-2-knowledge-enabled"),
  {
    libraryRevision: patchArtifact.libraryRevision,
    patches: [patch],
  },
);
const enabledBoardSource = await readFile(enabledProject.boardPath, "utf8");
await writeFile(
  enabledProject.boardPath,
  materializeLibraryPatchInBoardSource(enabledBoardSource, patch.footprintId, patch.operations),
  "utf8",
);
const controlBoardHash = await fileHash(officialProject.boardPath);
const enabledBoardHash = await fileHash(enabledProject.boardPath);
const controlReport = makeReport(await readFile(officialProject.boardPath, "utf8"));
const enabledReport = makeReport(await readFile(enabledProject.boardPath, "utf8"));
const controlIntake = intakeFabFeedback(controlReport, referenceIndexFromPhase1Fixture(fixture));
const enabledIntake = intakeFabFeedback(enabledReport, referenceIndexFromPhase1Fixture(fixture));
const maskFindingCount = (intake: ReturnType<typeof intakeFabFeedback>): number =>
  intake.findings.filter(
    (item) => item.references.ruleId === "mask-sliver-min" && item.verdict === "pass",
  ).length;
if (maskFindingCount(controlIntake) !== 1 || maskFindingCount(enabledIntake) !== 0) {
  throw new Error(
    "verification-failed: prototype-2 control/knowledge-enabled DFM comparison did not change",
  );
}
const sourceEvent = createFabFeedbackReceivedEvent({
  eventId: "event:fab-feedback:prototype-2-knowledge-loop",
  occurredAt: "2026-01-03T00:00:00.000Z",
  actor: "fixture:phase3-knowledge-loop",
  projectId: fixture.fixtureId,
  baseRevision: 0,
  resultRevision: 0,
  report: controlReport,
  intake: controlIntake,
});
const candidate = createKnowledgeCandidate({
  finding: controlIntake.findings[0]!,
  report: controlReport,
  sourceEventId: sourceEvent.eventId,
  designRevision: "prototype-2",
  derivationInputHash: controlIntake.evidence.value.derivationInputHash,
  derivationOutputHash: controlIntake.evidence.value.derivationOutputHash,
  createdAt: "2026-01-03T00:00:00.000Z",
});
const reviewed = transitionKnowledgeItem(candidate, {
  status: "reviewed",
  now: "2026-01-03T00:00:00.000Z",
});
const adopted = transitionKnowledgeItem(reviewed, {
  status: "adopted",
  now: "2026-01-03T00:00:00.000Z",
});
const context = createTargetDesignKnowledgeContext({
  designRevision: "prototype-2",
  fabProfileId: fixture.manufacturingProfile!.fabProfileId,
  footprintIds: ["R_0603_1608Metric"],
  ruleIds: [],
  classifications: [],
  reproductionConditions: fixture.manufacturingProfile!.processConditions,
});
const decisions = evaluateKnowledgeApplications([adopted], context);
const applied = recordKnowledgeApplications(decisions, [
  { knowledgeId: adopted.knowledgeId, libraryRevision: patchArtifact.libraryRevision },
]);
if (applied.applicableKnowledgeIds.length !== 1 || !applied.decisions[0]?.applied) {
  throw new Error("verification-failed: prototype-2 adopted knowledge was not applied");
}
const projectionArtifactId = "artifact:phase1-golden:prototype-2-knowledge-enabled";
const events = [
  sourceEvent,
  createKnowledgeCandidateCreatedEvent({
    eventId: "event:knowledge:candidate:prototype-2:P2-DFM-001",
    occurredAt: "2026-01-03T00:00:00.000Z",
    actor: "fixture:phase3-knowledge-loop",
    projectId: fixture.fixtureId,
    baseRevision: 0,
    resultRevision: 0,
    knowledgeItem: candidate,
  }),
  createKnowledgeTransitionedEvent({
    eventId: "event:knowledge:reviewed:prototype-2:P2-DFM-001",
    occurredAt: "2026-01-03T00:00:00.000Z",
    actor: "fixture:phase3-knowledge-loop",
    projectId: fixture.fixtureId,
    baseRevision: 0,
    resultRevision: 0,
    knowledgeItem: reviewed,
    previousStatus: "candidate",
  }),
  createKnowledgeTransitionedEvent({
    eventId: "event:knowledge:adopted:prototype-2:P2-DFM-001",
    occurredAt: "2026-01-03T00:00:00.000Z",
    actor: "fixture:phase3-knowledge-loop",
    projectId: fixture.fixtureId,
    baseRevision: 0,
    resultRevision: 0,
    knowledgeItem: adopted,
    previousStatus: "reviewed",
  }),
  createKnowledgeAppliedEvent({
    eventId: "event:knowledge:applied:prototype-2:P2-DFM-001",
    occurredAt: "2026-01-03T00:00:00.000Z",
    actor: "fixture:phase3-knowledge-loop",
    projectId: fixture.fixtureId,
    baseRevision: 0,
    resultRevision: 1,
    payload: {
      knowledgeItemId: adopted.id,
      targetProjectId: fixture.fixtureId,
      targetRevision: 2,
      appliedAt: "2026-01-03T00:00:00.000Z",
      libraryRevision: patchArtifact.libraryRevision,
      projectionArtifactId,
    },
  }),
];
const output = {
  fixture: fixture.fixtureId,
  targetDesignRevision: "prototype-2",
  control: {
    libraryRevision: officialLibraryRevision(),
    boardHash: controlBoardHash,
    findings: maskFindingCount(controlIntake),
    reportHash: controlReport.rawReport.contentHash,
    intakeDerivationHash: controlIntake.derivationHash,
  },
  knowledgeEnabled: {
    libraryRevision: patchArtifact.libraryRevision,
    boardHash: enabledBoardHash,
    findings: maskFindingCount(enabledIntake),
    reportHash: enabledReport.rawReport.contentHash,
    intakeDerivationHash: enabledIntake.derivationHash,
    decisions: applied.decisions,
    appliedKnowledgeItemId: adopted.id,
    projectionArtifactId,
  },
  events,
};
await writeFile(join(artifactRoot, "knowledge-loop.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify({
    controlFindings: 1,
    knowledgeEnabledFindings: 0,
    libraryRevision: patchArtifact.libraryRevision,
  }),
);
