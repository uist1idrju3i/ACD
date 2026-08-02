import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Phase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";
import {
  createFabFeedbackReceivedEvent,
  createKnowledgeAppliedEvent,
  createTargetDesignKnowledgeContext,
  evaluateKnowledgeApplications,
  recordKnowledgeApplications,
  InMemoryEventLog,
  type FabFeedbackReport,
  rulesForFabProfile,
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
const profileRules = rulesForFabProfile(fixture.manufacturingProfile!.fabProfileId);
if (!profileRules) throw new Error("schema-invalid: target fab profile is not declared");
const knownConditions = new Set(profileRules.rules.flatMap((rule) => rule.reproductionConditions));
const unknownConditions = fixture.manufacturingProfile!.processConditions.filter(
  (condition) => !knownConditions.has(condition),
);
if (unknownConditions.length > 0) {
  throw new Error(
    `schema-invalid: target process conditions drift: ${unknownConditions.join(", ")}`,
  );
}
let patchArtifact: { patch: LibraryOverlayPatch; libraryRevision: string };
try {
  patchArtifact = JSON.parse(
    await readFile(join(artifactRoot, "library-patch.json"), "utf8"),
  ) as typeof patchArtifact;
} catch (error) {
  throw new Error(
    `verification-failed: missing Phase 1 library-patch.json; run pnpm phase1:golden first (${error instanceof Error ? error.message : String(error)})`,
  );
}
const patch = patchArtifact.patch;
let knowledgeArtifact: {
  knowledgeStates: Array<{ adopted: Parameters<typeof evaluateKnowledgeApplications>[0][number] }>;
};
try {
  knowledgeArtifact = JSON.parse(
    await readFile(join(artifactRoot, "knowledge.json"), "utf8"),
  ) as typeof knowledgeArtifact;
} catch (error) {
  throw new Error(
    `verification-failed: missing Phase 1 knowledge.json; run pnpm phase1:golden first (${error instanceof Error ? error.message : String(error)})`,
  );
}
const adopted = knowledgeArtifact.knowledgeStates
  .map((state) => state.adopted)
  .find((item) => item.knowledgeId === patch.sourceKnowledgeId);
if (!adopted) {
  throw new Error(
    `verification-failed: Phase 1 adopted KnowledgeItem not found for library patch source ${patch.sourceKnowledgeId}`,
  );
}
const targetDesignRevision = fixture.requirement.provenance.version;
const hash = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fileHash = async (path: string): Promise<string> => hash(await readFile(path, "utf8"));

type PadGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  maskMargin: number;
};

const blockFor = (source: string, marker: string, offset = 0): string => {
  const start = source.indexOf(marker, offset);
  if (start < 0) return "";
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")" && --depth === 0) return source.slice(start, index + 1);
  }
  return "";
};

const padsForFootprint = (board: string, footprintName: string): PadGeometry[] => {
  const footprint = blockFor(board, `(footprint "${footprintName}"`);
  const defaultMargin = Number(
    board.match(/\(setup\s+\(pad_to_mask_clearance\s+(-?[\d.]+)/)?.[1] ?? 0,
  );
  return [...footprint.matchAll(/\(pad\s+"[^"]+"\s+smd\b/g)].flatMap((match) => {
    const block = blockFor(footprint, match[0]!, match.index);
    const at = block.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?/);
    const size = block.match(/\(size\s+([\d.]+)\s+([\d.]+)/);
    if (!at || !size) return [];
    const rotation = Math.abs(Number(at[3] ?? 0)) % 180 === 90;
    const width = Number(size[rotation ? 2 : 1]);
    const height = Number(size[rotation ? 1 : 2]);
    const override = block.match(/\(solder_mask_margin\s+(-?[\d.]+)/)?.[1];
    return [
      {
        x: Number(at[1]),
        y: Number(at[2]),
        width,
        height,
        maskMargin: override === undefined ? defaultMargin : Number(override),
      },
    ];
  });
};

const measuredMaskSliver = (board: string, footprintName: string): number => {
  const pads = padsForFootprint(board, footprintName);
  let minimum = Number.POSITIVE_INFINITY;
  for (const left of pads) {
    for (const right of pads) {
      if (left === right) continue;
      if (Math.abs(left.y - right.y) < 1e-6) {
        minimum = Math.min(
          minimum,
          Math.abs(left.x - right.x) -
            (left.width + right.width) / 2 -
            left.maskMargin -
            right.maskMargin,
        );
      }
      if (Math.abs(left.x - right.x) < 1e-6) {
        minimum = Math.min(
          minimum,
          Math.abs(left.y - right.y) -
            (left.height + right.height) / 2 -
            left.maskMargin -
            right.maskMargin,
        );
      }
    }
  }
  return minimum;
};

const detectMaskSliver = (
  board: string,
): { violates: boolean; measuredMm: number; minimumMm: number } => {
  const rule = profileRules.rules.find((candidate) => candidate.ruleId === "mask-sliver-min");
  if (!rule?.minimumSliverMm) {
    throw new Error("schema-invalid: mask-sliver rule lacks numeric minimum");
  }
  const measuredMm = measuredMaskSliver(
    board,
    "USB_C_Receptacle_GCT_USB4135-GF-A_6P_TopMnt_Horizontal",
  );
  return {
    violates: measuredMm < rule.minimumSliverMm,
    measuredMm,
    minimumMm: rule.minimumSliverMm,
  };
};

const makeReport = (board: string): FabFeedbackReport => {
  const measurement = detectMaskSliver(board);
  const finding = {
    findingId: "P2-DFM-001",
    originalText: "Solder mask sliver below minimum near J1 A5/B5 pads.",
    severityReported: "high" as const,
    references: {
      partId: "part:p2-j1",
      footprintId: `footprint:Connector_USB:${patch.footprintId}`,
      ...(measurement.violates ? { ruleId: "mask-sliver-min" } : {}),
    },
  };
  if (!measurement.violates) {
    return {
      schemaVersion: "0.1.0-draft",
      reportId: "fab-report:prototype-2-knowledge-loop",
      fabJobId: "job:prototype-2-knowledge-loop",
      fabProfileId: fixture.manufacturingProfile!.fabProfileId,
      source: {
        kind: "fixture",
        locator: "scripts/phase3-knowledge-loop.mts",
        contentHash: hash(""),
        fixtureDerived: true,
        fixtureId: fixture.fixtureId,
      },
      target: { projectId: fixture.fixtureId, designRevision: "prototype-2" },
      rawReport: { contentType: "text/plain", content: "", contentHash: hash("") },
      rawFindings: [] as never,
    } as FabFeedbackReport;
  }
  const findingText = finding.originalText;
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
const controlBoard = await readFile(officialProject.boardPath, "utf8");
const enabledBoard = await readFile(enabledProject.boardPath, "utf8");
const controlMeasurement = detectMaskSliver(controlBoard);
const enabledMeasurement = detectMaskSliver(enabledBoard);
const controlReport = makeReport(controlBoard);
const enabledReport = makeReport(enabledBoard);
const controlIntake = intakeFabFeedback(controlReport, referenceIndexFromPhase1Fixture(fixture));
const enabledIntake = intakeFabFeedback(enabledReport, referenceIndexFromPhase1Fixture(fixture));
const maskFindingCount = (intake: ReturnType<typeof intakeFabFeedback>): number =>
  intake.findings.filter(
    (item) => item.references.ruleId === "mask-sliver-min" && item.verdict === "pass",
  ).length;
if (
  enabledIntake.verdict === "unknown" ||
  maskFindingCount(controlIntake) !== 1 ||
  maskFindingCount(enabledIntake) !== 0
) {
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
if (patch.sourceKnowledgeId !== adopted.knowledgeId) {
  throw new Error(
    "verification-failed: library patch source knowledge does not match adopted item",
  );
}
const maskRule = profileRules.rules.find((rule) => rule.ruleId === "mask-sliver-min");
if (
  !maskRule?.correction ||
  controlReport.rawFindings[0]?.references.footprintId !==
    `footprint:Connector_USB:${patch.footprintId}`
) {
  throw new Error("verification-failed: library patch does not match mask-sliver applicability");
}
if (
  patch.operations.length === 0 ||
  patch.operations.some(
    (operation) =>
      operation.target !== maskRule.correction.target ||
      operation.requiredValueMm !== maskRule.correction.requiredValueMm,
  )
) {
  throw new Error("verification-failed: patch operation does not match fab rule correction");
}
const context = createTargetDesignKnowledgeContext({
  designRevision: "prototype-2",
  fabProfileId: fixture.manufacturingProfile!.fabProfileId,
  footprintIds: [
    ...new Set(
      fixture.mappings.map(
        (mapping) => `footprint:${mapping.footprintLibraryId}:${mapping.footprintName}`,
      ),
    ),
  ].sort(),
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
      targetRevision: Number(fixture.requirement.provenance.version.match(/\d+$/)?.[0] ?? 0),
      appliedAt: "2026-01-03T00:00:00.000Z",
      libraryRevision: patchArtifact.libraryRevision,
      projectionArtifactId,
    },
  }),
];
const eventLog = new InMemoryEventLog();
for (const event of events) await eventLog.append(event);
const recordedEvents = await eventLog.readAll();
const output = {
  fixture: fixture.fixtureId,
  targetDesignRevision,
  control: {
    libraryRevision: officialLibraryRevision(),
    boardHash: controlBoardHash,
    geometry: controlMeasurement,
    findings: maskFindingCount(controlIntake),
    reportHash: controlReport.rawReport.contentHash,
    intakeDerivationHash: controlIntake.derivationHash,
  },
  knowledgeEnabled: {
    libraryRevision: patchArtifact.libraryRevision,
    boardHash: enabledBoardHash,
    geometry: enabledMeasurement,
    findings: maskFindingCount(enabledIntake),
    reportHash: enabledReport.rawReport.contentHash,
    intakeDerivationHash: enabledIntake.derivationHash,
    decisions: applied.decisions,
    appliedKnowledgeItemId: adopted.id,
    projectionArtifactId,
  },
  events: recordedEvents,
};
await writeFile(join(artifactRoot, "knowledge-loop.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(
  JSON.stringify({
    controlFindings: maskFindingCount(controlIntake),
    knowledgeEnabledFindings: maskFindingCount(enabledIntake),
    libraryRevision: patchArtifact.libraryRevision,
  }),
);
