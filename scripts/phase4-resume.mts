import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  CheckpointRuntime,
  ResumeOrchestrator,
  TaskLedgerRuntime,
  createEvent,
  type Checkpoint,
  type CheckpointContext,
  type EventEnvelope,
  type IdPort,
  type TaskLedgerEntry,
} from "../packages/graph-core/src/index.js";
import { FileCheckpointStore, FileEventLog } from "../packages/adapters/storage-fs/src/index.js";
import { canonicalize } from "../packages/graph-core/src/hash.js";
import {
  normalizedArtifact,
  runPipelineStages,
  sha256,
  type PipelineStage,
} from "./golden-shared.mts";

const root = resolve(import.meta.dirname, "..");
const artifactRoot = join(root, "artifacts/phase4");
const workerMode = process.argv.includes("--worker");
const resumeMode = process.argv.includes("--resume");
const caseId = process.argv.find((value) => value.startsWith("--case="))?.slice(7);
const killAfter = process.argv.find((value) => value.startsWith("--kill-after="))?.slice(13);

const stages = [
  { id: "gate:placement", gate: 4 },
  { id: "gate:routing", gate: 9 },
  { id: "gate:drc", gate: 10 },
  { id: "gate:pre-order", gate: 12 },
  { id: "gate:knowledge-lifecycle", gate: 20 },
  { id: "gate:knowledge-application", gate: 22 },
] as const;

type StageId = (typeof stages)[number]["id"];
type StageRecord = { id: StageId; gate: number; evidence: Record<string, unknown> };

const context: CheckpointContext = {
  inputRevision: 1,
  inputHash: "sha256:phase4-input",
  graphRevision: 1,
  toolVersion: "acd-phase4-worker",
  modelVersion: "none",
  libraryVersion: "fixture-library-1",
  containerVersion: "node-22",
  provenance: [],
  measurementSystemQualification: { status: "qualified" },
  fabProfileId: "fab:fixture",
  manufacturingProfileId: "manufacturing:fixture",
  knowledgeItemStatuses: [],
};

class StageIds implements IdPort {
  private count: number;

  constructor(
    private readonly stage: string,
    private readonly kind: string,
    initialCount = 0,
  ) {
    this.count = initialCount;
  }

  next(prefix: string): string {
    return `${prefix}:${this.kind}:${this.stage}:${this.count++}`;
  }
}

class Clock {
  now(): string {
    return "2026-01-01T00:00:00.000Z";
  }
}

const taskEntry = (stage: (typeof stages)[number]): TaskLedgerEntry => ({
  id: `task:${stage.id}`,
  type: "TaskLedgerEntry",
  revision: 0,
  purpose: `Execute ${stage.id}`,
  inputRevision: 1,
  status: "pending",
  acceptanceCriteria: [`${stage.id} completed deterministically`],
  attemptCount: 0,
  retryBudget: 1,
  budget: { scope: "execution", timeSeconds: 1, toolCalls: 1 },
  checkpointIds: [],
  dependencyIds: [],
  approvalState: "not-required",
  artifactIds: [],
});

const stageResultPath = (runRoot: string): string => join(runRoot, "stage-results.json");
const outputRoot = (runRoot: string): string => join(runRoot, "outputs");
const eventPath = (runRoot: string): string => join(runRoot, "events.jsonl");
const checkpointPath = (runRoot: string): string => join(runRoot, "checkpoints.jsonl");

const readJson = async <T,>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

const writeStageResults = async (runRoot: string, records: StageRecord[]): Promise<void> => {
  await writeFile(stageResultPath(runRoot), `${JSON.stringify(records, null, 2)}\n`);
};

const appendControlEvent = async (
  runRoot: string,
  type: "run.stopped" | "run.resumed",
  id: string,
  runCaseId: string,
): Promise<void> => {
  const log = new FileEventLog(eventPath(runRoot));
  const events = await log.readAll();
  await log.append(
    createEvent({
      eventId: id,
      type,
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "phase4-resume-parent",
      projectId: "project:phase4-resume",
      baseRevision: events.length,
      resultRevision: events.length + 1,
      payload: { caseId: runCaseId, stageId: killAfter ?? null },
    }),
  );
  await log.close();
};

const stageFor = (
  stage: (typeof stages)[number],
  runRoot: string,
  before: () => Promise<void>,
): PipelineStage => ({
  ...stage,
  execute: async () => {
    await before();
    const content = JSON.stringify(
      {
        stage: stage.id,
        gate: stage.gate,
        inputHash: context.inputHash,
        graphRevision: context.graphRevision,
      },
      null,
      2,
    );
    const path = join(outputRoot(runRoot), `${stage.id.replaceAll(":", "-")}.json`);
    await writeFile(path, `${content}\n`);
    return {
      artifact: path.slice(runRoot.length + 1),
      artifactHash: sha256(normalizedArtifact(Buffer.from(content))),
      stage: stage.id,
      gate: stage.gate,
      status: "passed",
    };
  },
});

const checkpointFor = (
  stage: (typeof stages)[number],
  artifactHash: string,
): Omit<Checkpoint, "id" | "type" | "revision" | "eventPosition"> => ({
  gate: stage.id,
  inputRevision: context.inputRevision,
  inputHash: context.inputHash,
  graphRevision: context.graphRevision,
  toolVersion: context.toolVersion,
  modelVersion: context.modelVersion,
  libraryVersion: context.libraryVersion,
  containerVersion: context.containerVersion,
  provenance: context.provenance,
  measurementSystemQualification: context.measurementSystemQualification,
  fabProfileId: context.fabProfileId,
  manufacturingProfileId: context.manufacturingProfileId,
  knowledgeItemStatuses: context.knowledgeItemStatuses,
  artifactHashes: [artifactHash],
  verificationResultIds: [`verification:${stage.id}`],
  executionEnvironment: { runner: "phase4-resume", node: process.version },
});

const appendVerification = async (
  log: FileEventLog,
  stage: (typeof stages)[number],
): Promise<void> => {
  const events = await log.readAll();
  if (events.some((event) => event.eventId === `verification:${stage.id}`)) return;
  await log.append(
    createEvent({
      eventId: `verification:${stage.id}`,
      type: "verification.completed",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "phase4-resume-worker",
      projectId: "project:phase4-resume",
      baseRevision: events.length,
      resultRevision: events.length + 1,
      payload: {
        verificationResultId: `verification:${stage.id}`,
        status: "passed",
        gate: stage.id,
      },
    }),
  );
};

const runWorker = async (runRoot: string): Promise<void> => {
  await mkdir(outputRoot(runRoot), { recursive: true });
  const log = new FileEventLog(eventPath(runRoot));
  const clock = new Clock();
  const existingEvents = await log.readAll();
  const taskEventCount = existingEvents.filter(
    (event) => event.type === "task.created" || event.type === "task.transitioned",
  ).length;
  const taskIds = new StageIds("all", "task", taskEventCount);
  const ledger = new TaskLedgerRuntime(
    "project:phase4-resume",
    "phase4-resume-worker",
    log,
    clock,
    taskIds,
  );
  const state = await ledger.load();
  if (!resumeMode && Object.keys(state.entries).length === 0) {
    for (const stage of stages) await ledger.create(taskEntry(stage));
  }
  const priorResults = await readJson<StageRecord[]>(stageResultPath(runRoot), []);
  let selectedCheckpoint: Checkpoint | undefined;
  let skipped = new Set<StageId>();
  if (resumeMode) {
    const store = new FileCheckpointStore(checkpointPath(runRoot));
    const orchestrator = new ResumeOrchestrator(
      "project:phase4-resume",
      "phase4-resume-worker",
      log,
      store,
      clock,
      new StageIds(caseId ?? "resume", "resume"),
    );
    const plan = await orchestrator.resume(
      `resume:${caseId}`,
      context,
      stages.map((stage) => ({ id: stage.id })),
    );
    selectedCheckpoint = plan.checkpoint;
    skipped = new Set(plan.skippedStageIds as StageId[]);
    await store.close();
    for (const stage of stages.filter((candidate) => skipped.has(candidate.id))) {
      const entry = (await ledger.load()).entries[`task:${stage.id}`];
      if (entry?.status === "running") {
        await ledger.transition(entry.id, "completed", { resultId: `result:${stage.id}` });
      }
    }
  }
  const pipeline = stages.map((stage) =>
    stageFor(stage, runRoot, async () => {
      const entry = (await ledger.load()).entries[`task:${stage.id}`];
      if (entry?.status === "pending") await ledger.transition(entry.id, "running");
    }),
  );
  const pending = pipeline.filter((stage) => !skipped.has(stage.id as StageId));
  const executed = await runPipelineStages(pending);
  for (const result of executed) {
    const stage = stages.find((candidate) => candidate.id === result.id);
    if (!stage) throw new Error(`unknown stage: ${result.id}`);
    const stageLog = log;
    await appendVerification(stageLog, stage);
    const checkpointStore = new FileCheckpointStore(checkpointPath(runRoot));
    const checkpointRuntime = new CheckpointRuntime(
      "project:phase4-resume",
      "phase4-resume-worker",
      stageLog,
      checkpointStore,
      clock,
      new StageIds(stage.id, "checkpoint"),
    );
    await checkpointRuntime.create(checkpointFor(stage, String(result.evidence.artifactHash)));
    await checkpointStore.close();
    const merged = [
      ...priorResults.filter((record) => record.id !== result.id),
      result as StageRecord,
    ].sort(
      (left, right) =>
        stages.findIndex((stage) => stage.id === left.id) -
        stages.findIndex((stage) => stage.id === right.id),
    );
    await writeStageResults(runRoot, merged);
    if (!resumeMode && killAfter === stage.id) {
      await log.close();
      process.kill(process.pid, "SIGKILL");
    }
    const current = (await ledger.load()).entries[`task:${stage.id}`];
    if (current?.status === "running") {
      await ledger.transition(current.id, "completed", { resultId: `result:${stage.id}` });
    }
    priorResults.splice(0, priorResults.length, ...merged);
  }
  const finalEvents = await log.readAll();
  await writeFile(
    join(runRoot, "run.json"),
    `${JSON.stringify(
      {
        selectedCheckpoint: selectedCheckpoint?.id ?? null,
        skippedStageIds: [...skipped],
        rerunStageIds: pending.map((stage) => stage.id),
        gateResults: priorResults,
        eventCount: finalEvents.length,
      },
      null,
      2,
    )}\n`,
  );
  await log.close();
};

const eventComparable = (event: EventEnvelope): unknown => {
  if (event.type === "checkpoint.created") {
    const payload = structuredClone(event.payload) as { checkpoint?: Checkpoint };
    if (payload.checkpoint) delete payload.checkpoint.eventPosition;
    return { eventId: event.eventId, type: event.type, payload };
  }
  return { eventId: event.eventId, type: event.type, payload: event.payload };
};

const hashesUnder = async (directory: string): Promise<Record<string, string>> => {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const result: Record<string, string> = {};
  for (const name of names) {
    result[name] = sha256(normalizedArtifact(await readFile(join(directory, name))));
  }
  return result;
};

const runChild = (
  args: string[],
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolveChild, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", import.meta.filename, ...args], {
      cwd: root,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveChild({ code, signal }));
  });

const runCase = async (id: string, interruption: StageId): Promise<Record<string, unknown>> => {
  const caseRoot = join(artifactRoot, id);
  const baselineRoot = join(caseRoot, "baseline");
  const interruptedRoot = join(caseRoot, "interrupted");
  await rm(caseRoot, { recursive: true, force: true });
  await mkdir(baselineRoot, { recursive: true });
  await mkdir(interruptedRoot, { recursive: true });
  await runChild(["--worker", `--case=${id}`, `--root=${baselineRoot}`]);
  const killed = await runChild([
    "--worker",
    `--case=${id}`,
    `--root=${interruptedRoot}`,
    `--kill-after=${interruption}`,
  ]);
  if (killed.signal !== "SIGKILL") throw new Error(`worker did not terminate with SIGKILL: ${id}`);
  await rm(`${eventPath(interruptedRoot)}.lock`, { force: true });
  await rm(`${checkpointPath(interruptedRoot)}.lock`, { force: true });
  await appendControlEvent(interruptedRoot, "run.stopped", `run.stopped:${id}`, id);
  const resumed = await runChild([
    "--worker",
    "--resume",
    `--case=${id}`,
    `--root=${interruptedRoot}`,
  ]);
  if (resumed.code !== 0) throw new Error(`resume worker failed: ${id}`);
  const baselineRun = await readJson<Record<string, unknown>>(join(baselineRoot, "run.json"), {});
  const resumedRun = await readJson<Record<string, unknown>>(join(interruptedRoot, "run.json"), {});
  const baselineLog = new FileEventLog(eventPath(baselineRoot));
  const baselineEvents = await baselineLog.readAll();
  await baselineLog.close();
  const resumedLog = new FileEventLog(eventPath(interruptedRoot));
  const resumedEvents = await resumedLog.readAll();
  await resumedLog.close();
  const baselineHashes = await hashesUnder(outputRoot(baselineRoot));
  const resumedHashes = await hashesUnder(outputRoot(interruptedRoot));
  const comparableBaseline = baselineEvents
    .filter((event) => event.type !== "run.stopped" && event.type !== "run.resumed")
    .map(eventComparable);
  const comparableResumed = resumedEvents
    .filter((event) => event.type !== "run.stopped" && event.type !== "run.resumed")
    .map(eventComparable);
  if (canonicalize(baselineHashes) !== canonicalize(resumedHashes)) {
    throw new Error(`verification-failed: output hash mismatch for ${id}`);
  }
  if (canonicalize(baselineRun.gateResults) !== canonicalize(resumedRun.gateResults)) {
    throw new Error(`verification-failed: gate result mismatch for ${id}`);
  }
  if (canonicalize(comparableBaseline) !== canonicalize(comparableResumed)) {
    throw new Error(`event-replay-failure: event sequence mismatch for ${id}`);
  }
  return {
    interruptionStageId: interruption,
    resumedCheckpoint: resumedRun.selectedCheckpoint,
    rerunStageIds: resumedRun.rerunStageIds,
    skippedStageIds: resumedRun.skippedStageIds,
    actualExecutedStageIds: (resumedRun.rerunStageIds as string[]).slice(),
    actualStageExecution: resumedRun.gateResults,
    artifactHashComparison: {
      baseline: baselineHashes,
      resumed: resumedHashes,
      equal: true,
    },
    gateResultComparison: {
      baseline: baselineRun.gateResults,
      resumed: resumedRun.gateResults,
      equal: true,
    },
    eventSequenceComparison: {
      equalExcludingInterruptions: true,
      excludedEvents: ["run.stopped", "run.resumed"],
    },
    baselineEventCount: baselineEvents.length,
    resumedEventCount: resumedEvents.length,
  };
};

if (workerMode) {
  const runRoot = process.argv.find((value) => value.startsWith("--root="))?.slice(7);
  if (!runRoot) throw new Error("worker root is required");
  await runWorker(runRoot);
} else {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  const cases = [
    ["after-routing", "gate:routing" as StageId],
    ["after-drc", "gate:drc" as StageId],
    ["after-gate-20", "gate:knowledge-lifecycle" as StageId],
  ] as const;
  const results = [];
  for (const [id, interruption] of cases)
    results.push({ caseId: id, ...(await runCase(id, interruption)) });
  await writeFile(
    join(artifactRoot, "resume.json"),
    `${JSON.stringify(
      {
        runner: "phase4-resume",
        interruptionCases: results,
        comparison: {
          outputHashes: "SHA-256 over deterministic stage artifacts",
          eventSequence:
            "canonical event type/payload comparison excluding run.stopped/run.resumed",
        },
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}
