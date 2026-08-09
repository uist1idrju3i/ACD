import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
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
  buildStopRecord,
  checkBudget,
  createBudgetUsageSnapshot,
  detectNoProgress,
  type ProgressObservation,
} from "../packages/graph-core/src/index.js";
import {
  FileCheckpointStore,
  FileEventLog,
  type ToolObservation,
} from "../packages/adapters/storage-fs/src/index.js";
import { canonicalize } from "../packages/graph-core/src/hash.js";
import { loadGateMatrix, loadSchemaValidator } from "../packages/schema/src/index.js";
import type { ACDPhase1Fixture } from "../packages/schema/src/generated/phase1-fixture.js";
import type { Budget } from "../packages/schema/src/generated/design-graph.js";
import {
  createPhase1Context,
  deserializeStageContext,
  phase1Stages,
  setToolObservationContext,
  setToolObservationHook,
  setToolRunId,
  serializeStageContext,
  stageContextHash,
  type Result,
  type StageContext,
  type StageDefinition,
} from "./phase1-stages.mts";
import { normalizedArtifact, rawSha256 } from "./golden-shared.mts";

const root = resolve(import.meta.dirname, "..");
const artifactRoot = join(root, "artifacts/phase4");
const workerMode = process.argv.includes("--worker");
const resumeMode = process.argv.includes("--resume");
const budgetInjectionMode = process.argv.includes("--budget-injected");
const noProgressInjectionMode = process.argv.includes("--no-progress-injected");
const caseId = process.argv.find((value) => value.startsWith("--case="))?.slice(7);
const killAfter = process.argv.find((value) => value.startsWith("--kill-after="))?.slice(13);
const toolRunId = process.argv.find((value) => value.startsWith("--tool-run-id="))?.slice(14);

const fixture = JSON.parse(
  await readFile(join(root, "fixtures/phase1/golden-esp32.json"), "utf8"),
) as ACDPhase1Fixture;
const gateMatrix = await loadGateMatrix();
const designGraphValidator = await loadSchemaValidator("design-graph");

const runtimeContext: CheckpointContext = {
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

type ExecutionRecord = {
  mode: "baseline" | "interrupted" | "resume";
  stageId: string;
  gate: number;
  contextHash: string;
  artifactHashes: string[];
};

type RunManifest = {
  selectedCheckpoint: string | null;
  skippedStageIds: string[];
  rerunStageIds: string[];
  executedStageIds: string[];
  actualStageExecution: ExecutionRecord[];
  gateResults: Result[];
  eventCount: number;
  contextValidation: {
    deserialized: boolean;
    fixtureValidated: boolean;
    restoredContextHash: string | null;
    checkpointContextHash: string | null;
  };
};

const stageExternalProcessUpperBounds: Readonly<Record<string, number>> = {
  "gate:spice": 3,
  "gate:kicad-projection": 2,
  "gate:erc": 1,
  "gate:routing": 3,
  "gate:drc": 1,
  "gate:manufacturing": 2,
  "gate:library-patch": 3,
};

const externalProcessUpperBoundForStage = (stageId: string): number =>
  stageExternalProcessUpperBounds[stageId] ?? 0;

type BudgetWatchdogEvidence = {
  runner: "phase4-resume";
  normalRunObservationCounts?: Record<
    string,
    {
      measured: number;
      upperBound: number;
      upperBoundAtLeastMeasured: boolean;
    }
  >;
  injectedBudget: {
    runUsage: ReturnType<typeof createBudgetUsageSnapshot>;
    taskUsage: ReturnType<typeof createBudgetUsageSnapshot>;
    runBudget: Budget;
    taskBudget: TaskLedgerEntry["budget"];
    executedStageIds: string[];
    stopRecord: ReturnType<typeof buildStopRecord>;
    nextStageId: string;
    nextStageStarted: boolean;
    nextStageUpperBound: { externalProcessExecutions: number; elapsedSeconds: number };
    observationCounts: {
      externalProcessExecutions: number;
      logicalToolRequests: number;
      registryReplays: number;
    };
  };
  injectedNoProgress: {
    reasons: string[];
    run: {
      runUsage: ReturnType<typeof createBudgetUsageSnapshot>;
      budget: Budget;
    };
    task: {
      taskUsage: ReturnType<typeof createBudgetUsageSnapshot>;
      budget: Budget;
    };
    observations: ProgressObservation[];
    observationCount: number;
    noProgressObservationStatus: "detected" | "not-detected" | "insufficient-observations";
    executedStageIds: string[];
    stopRecord: ReturnType<typeof buildStopRecord>;
    nextStageId: string;
    nextAttempt: number;
    nextAttemptStarted: boolean;
    nextStageStarted: boolean;
    repairEvidence: unknown;
    observationCounts: {
      externalProcessExecutions: number;
      logicalToolRequests: number;
      registryReplays: number;
    };
  };
};

class StableIds implements IdPort {
  private count: number;

  constructor(
    private readonly scope: string,
    private readonly kind: string,
    initialCount = 0,
  ) {
    this.count = initialCount;
  }

  next(prefix: string): string {
    return `${prefix}:${this.kind}:${this.scope}:${this.count++}`;
  }
}

class FixedClock {
  now(): string {
    return "2026-01-01T00:00:00.000Z";
  }
}

class FixedMonotonicClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(seconds: number): void {
    this.current += seconds;
  }
}

const stageResultPath = (runRoot: string): string => join(runRoot, "stage-results.json");
const contextPath = (runRoot: string): string => join(runRoot, "stage-context.json");
const executionPath = (runRoot: string): string => join(runRoot, "execution-records.json");
const eventPath = (runRoot: string): string => join(runRoot, "events.jsonl");
const checkpointPath = (runRoot: string): string => join(runRoot, "checkpoints.jsonl");
const projectRoot = (runRoot: string): string => join(runRoot, "project");

const taskEntry = (stage: StageDefinition): TaskLedgerEntry => ({
  id: `task:${stage.id}`,
  type: "TaskLedgerEntry",
  revision: 0,
  purpose: `Execute ${stage.id}`,
  inputRevision: 1,
  status: "pending",
  acceptanceCriteria: [`${stage.id} completed deterministically`],
  attemptCount: 0,
  retryBudget: 1,
  budget: { scope: "execution", timeSeconds: 3600, toolCalls: 100 },
  checkpointIds: [],
  dependencyIds: [],
  approvalState: "not-required",
  artifactIds: [],
});

const readJson = async <T,>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
};

const writeContext = async (runRoot: string, context: StageContext): Promise<string> => {
  const serialized = serializeStageContext(context);
  await writeFile(contextPath(runRoot), `${serialized}\n`);
  return stageContextHash(context);
};

const writeResults = async (runRoot: string, results: readonly Result[]): Promise<void> => {
  await writeFile(stageResultPath(runRoot), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(join(runRoot, "gate-results.json"), `${JSON.stringify(results, null, 2)}\n`);
};

const walkFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else files.push(path);
  }
  return files;
};

const runtimeFiles = new Set([
  "events.jsonl",
  "events.jsonl.lock",
  "checkpoints.jsonl",
  "checkpoints.jsonl.lock",
  "stage-context.json",
  "stage-results.json",
  "execution-records.json",
  "run.json",
  "budget-runtime.json",
]);

const artifactHashes = async (runRoot: string): Promise<string[]> => {
  const files = await walkFiles(runRoot);
  const hashes: string[] = [];
  for (const file of files) {
    if (runtimeFiles.has(relative(runRoot, file))) continue;
    const content = normalizedArtifact(await readFile(file));
    hashes.push(`${relative(runRoot, file)}=${rawSha256(content)}`);
  }
  return hashes.sort();
};

const appendVerification = async (log: FileEventLog, stage: StageDefinition): Promise<void> => {
  const events = await log.readAll();
  const verificationResultId = `verification:${stage.id}`;
  if (events.some((event) => event.eventId === verificationResultId)) return;
  await log.append(
    createEvent({
      eventId: verificationResultId,
      type: "verification.completed",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "phase4-resume-worker",
      projectId: "project:phase4-resume",
      baseRevision: events.length,
      resultRevision: events.length + 1,
      payload: {
        verificationResultId,
        status: "passed",
        gate: stage.id,
      },
    }),
  );
};

const appendStopped = async (
  log: FileEventLog,
  reason: string,
  runCaseId: string,
): Promise<void> => {
  const events = await log.readAll();
  await log.append(
    createEvent({
      eventId: `run.stopped:${runCaseId}`,
      type: "run.stopped",
      occurredAt: "2026-01-01T00:00:00.000Z",
      actor: "phase4-resume-worker",
      projectId: "project:phase4-resume",
      baseRevision: events.length,
      resultRevision: events.length + 1,
      payload: { caseId: runCaseId, reason },
    }),
  );
};

const checkpointInput = (
  stage: StageDefinition,
  context: StageContext,
  contextHash: string,
  hashes: string[],
): Omit<Checkpoint, "id" | "type" | "revision" | "eventPosition"> => ({
  gate: stage.id,
  inputRevision: runtimeContext.inputRevision,
  inputHash: runtimeContext.inputHash,
  graphRevision: runtimeContext.graphRevision,
  toolVersion: runtimeContext.toolVersion,
  modelVersion: runtimeContext.modelVersion,
  libraryVersion: runtimeContext.libraryVersion,
  containerVersion: runtimeContext.containerVersion,
  provenance: runtimeContext.provenance,
  measurementSystemQualification: runtimeContext.measurementSystemQualification,
  fabProfileId: runtimeContext.fabProfileId,
  manufacturingProfileId: runtimeContext.manufacturingProfileId,
  knowledgeItemStatuses: context.knowledgeStates.map((state) => ({
    knowledgeItemId: state.adopted.id,
    status: state.adopted.status,
  })),
  artifactHashes: hashes,
  verificationResultIds: [`verification:${stage.id}`],
  executionEnvironment: {
    runner: "phase4-resume",
    node: process.version,
    contextHash,
  },
});

const runWorker = async (runRoot: string): Promise<void> => {
  const activeToolRunId = toolRunId ?? randomUUID();
  await mkdir(projectRoot(runRoot), { recursive: true });
  const log = new FileEventLog(eventPath(runRoot));
  const clock = new FixedClock();
  const monotonicClock = new FixedMonotonicClock();
  const runBudget = {
    scope: "execution" as const,
    timeSeconds: 3600,
    toolCalls: budgetInjectionMode ? 2 : 100,
  };
  let runExternalProcessExecutions = 0;
  let runLogicalToolRequests = 0;
  let runRegistryReplays = 0;
  let noProgressStop:
    | {
        stoppedStageId: string;
        stoppedAttempt: number;
        nextAttempt: number;
        nextStageId: string | null;
        reasons: string[];
      }
    | undefined;
  let stopRequested = false;
  const stageExternalProcessExecutions: Record<string, number> = {};
  let activeTaskId: string | undefined;
  let activeAttempt: number | undefined;
  let lastBudgetCheck:
    | {
        nextStageId: string;
        runBudget: Budget;
        taskBudget: TaskLedgerEntry["budget"];
        operationEstimate: { elapsedSeconds: number; externalProcessExecutions: number };
      }
    | undefined;
  const observations: ToolObservation[] = [];
  setToolObservationHook((observation) => {
    observations.push(observation);
    if (observation.kind === "external-process-started") runExternalProcessExecutions += 1;
    if (observation.kind === "logical-request") runLogicalToolRequests += 1;
    if (observation.kind === "registry-replay") runRegistryReplays += 1;
  });
  try {
    const existingEvents = await log.readAll();
    const ledger = new TaskLedgerRuntime(
      "project:phase4-resume",
      "phase4-resume-worker",
      log,
      clock,
      new StableIds(
        "task",
        "event",
        existingEvents.filter((event) => event.type.startsWith("task.")).length,
      ),
    );
    const state = await ledger.load();
    let context: StageContext;
    let skipped = new Set<string>();
    let selectedCheckpoint: Checkpoint | undefined;
    let mode: ExecutionRecord["mode"] = "baseline";
    let restoredContextHash: string | null = null;

    if (resumeMode) {
      mode = "resume";
      context = deserializeStageContext(await readFile(contextPath(runRoot), "utf8"));
      const store = new FileCheckpointStore(checkpointPath(runRoot));
      const orchestrator = new ResumeOrchestrator(
        "project:phase4-resume",
        "phase4-resume-worker",
        log,
        store,
        clock,
        new StableIds(caseId ?? "resume", "resume"),
      );
      const plan = await orchestrator.resume(
        `resume:${caseId}`,
        {
          ...runtimeContext,
          knowledgeItemStatuses: context.knowledgeStates.map((state) => ({
            knowledgeItemId: state.adopted.id,
            status: state.adopted.status,
          })),
        },
        phase1Stages.map((stage) => ({ id: stage.id })),
      );
      selectedCheckpoint = plan.checkpoint;
      const expectedContextHash = (
        selectedCheckpoint.executionEnvironment as { contextHash?: unknown }
      ).contextHash;
      const actualContextHash = stageContextHash(context);
      restoredContextHash = actualContextHash;
      if (expectedContextHash !== actualContextHash) {
        await appendStopped(log, "checkpoint context hash mismatch", caseId ?? "unknown");
        throw new Error("stale-result: checkpoint context hash does not match stage context");
      }
      skipped = new Set(plan.skippedStageIds);
      await store.close();
      for (const stage of phase1Stages.filter((candidate) => skipped.has(candidate.id))) {
        const entry = (await ledger.load()).entries[`task:${stage.id}`];
        if (entry?.status === "running") {
          await ledger.transition(entry.id, "completed", { resultId: `result:${stage.id}` });
        }
      }
    } else {
      context = createPhase1Context({
        fixture,
        artifactRoot: runRoot,
        projectRoot: projectRoot(runRoot),
        gateMatrix,
        designGraphValidator,
      });
      if (budgetInjectionMode || noProgressInjectionMode) {
        context.watchdogInjection = true;
      }
      if (noProgressInjectionMode) context.watchdogAttemptInjection = true;
      if (Object.keys(state.entries).length === 0) {
        for (const stage of phase1Stages) await ledger.create(taskEntry(stage));
      }
    }
    setToolRunId(context, activeToolRunId);

    const executedRecords = await readJson<ExecutionRecord[]>(executionPath(runRoot), []);
    for (const stage of phase1Stages.filter((candidate) => !skipped.has(candidate.id))) {
      if (stopRequested) break;
      const entry = (await ledger.load()).entries[`task:${stage.id}`];
      if (!entry) throw new Error(`reference-integrity: missing task ${stage.id}`);
      const taskUsageBefore = (await ledger.load()).usage?.[entry.id];
      const taskExternalBefore = taskUsageBefore?.externalProcessExecutions ?? 0;
      const taskLogicalBefore = taskUsageBefore?.logicalToolRequests ?? 0;
      const taskElapsedBefore = taskUsageBefore?.elapsedSeconds ?? 0;
      const runExternalBefore = runExternalProcessExecutions;
      const runLogicalBefore = runLogicalToolRequests;
      const runUsage = createBudgetUsageSnapshot({
        scope: "run",
        attempts: (await log.readAll()).filter(
          (event) =>
            event.type === "task.transitioned" &&
            (event.payload as { to?: string }).to === "running",
        ).length,
        elapsedSeconds: monotonicClock.now(),
        externalProcessExecutions: runExternalProcessExecutions,
        logicalToolRequests: runLogicalToolRequests,
      });
      const taskUsage = createBudgetUsageSnapshot({
        scope: "task",
        attempts: entry.attemptCount,
        elapsedSeconds: taskElapsedBefore,
        externalProcessExecutions: taskExternalBefore,
        logicalToolRequests: taskLogicalBefore,
      });
      const nextStageUpperBound = externalProcessUpperBoundForStage(stage.id);
      const operationEstimate = {
        elapsedSeconds: 1,
        externalProcessExecutions: nextStageUpperBound,
      };
      lastBudgetCheck = {
        nextStageId: stage.id,
        runBudget,
        taskBudget: entry.budget,
        operationEstimate,
      };
      const runDecision = checkBudget(runBudget, runUsage, operationEstimate);
      const taskDecision = checkBudget(entry.budget, taskUsage, {
        ...operationEstimate,
      });
      if (runDecision.status !== "allowed" || taskDecision.status !== "allowed") {
        const reasonCode = runDecision.reasonCode ?? taskDecision.reasonCode ?? "budget-exceeded";
        const stopRecord = buildStopRecord({
          reasonCode,
          knownFacts: [
            runDecision.status !== "allowed" ? `run budget is ${runDecision.status}` : "",
            taskDecision.status !== "allowed" ? `task budget is ${taskDecision.status}` : "",
            `next stage upper-bound external process estimate is ${nextStageUpperBound}`,
          ].filter(Boolean),
          uncertainties: ["the next stage was not started"],
          options: [{ id: "resume", description: "resume after an approved budget change" }],
          recommendation: "review the budget declaration before resuming",
          resumeCondition: "the applicable budget cap is approved",
          resumePosition: { eventPosition: (await log.readAll()).length },
          budgetSnapshot: { run: runUsage, task: taskUsage },
          evidenceIds: [`evidence:budget:${stage.id}`],
        });
        await writeFile(
          join(runRoot, "stop-record.json"),
          `${JSON.stringify(stopRecord, null, 2)}\n`,
        );
        await ledger.transition(entry.id, "blocked", { stopReason: reasonCode });
        break;
      }
      if (entry.status === "pending") await ledger.transition(entry.id, "running");
      activeTaskId = entry.id;
      activeAttempt = entry.attemptCount;
      setToolObservationContext(context, {
        runId: activeToolRunId,
        taskId: activeTaskId,
        attempt: activeAttempt,
      });
      const monotonicStart = monotonicClock.now();
      await stage.run(context);
      monotonicClock.advance(1);
      stageExternalProcessExecutions[stage.id] = runExternalProcessExecutions - runExternalBefore;
      const taskUsageAfter = createBudgetUsageSnapshot({
        scope: "task",
        attempts: (await ledger.load()).entries[entry.id]?.attemptCount ?? entry.attemptCount,
        elapsedSeconds: taskElapsedBefore + (monotonicClock.now() - monotonicStart),
        externalProcessExecutions:
          taskExternalBefore + (runExternalProcessExecutions - runExternalBefore),
        logicalToolRequests: taskLogicalBefore + (runLogicalToolRequests - runLogicalBefore),
      });
      await ledger.updateUsage(entry.id, taskUsageAfter);
      await appendVerification(log, stage);
      const contextHash = await writeContext(runRoot, context);
      const hashes = await artifactHashes(runRoot);
      const checkpointStore = new FileCheckpointStore(checkpointPath(runRoot));
      const checkpointRuntime = new CheckpointRuntime(
        "project:phase4-resume",
        "phase4-resume-worker",
        log,
        checkpointStore,
        clock,
        new StableIds(stage.id, "checkpoint"),
      );
      await checkpointRuntime.create(checkpointInput(stage, context, contextHash, hashes));
      await checkpointStore.close();
      const record: ExecutionRecord = {
        mode,
        stageId: stage.id,
        gate: stage.gate,
        contextHash,
        artifactHashes: hashes,
      };
      executedRecords.push(record);
      await writeFile(executionPath(runRoot), `${JSON.stringify(executedRecords, null, 2)}\n`);
      await writeResults(runRoot, context.results);
      if (!resumeMode && killAfter === stage.id) {
        await log.close();
        process.kill(process.pid, "SIGKILL");
      }
      const current = (await ledger.load()).entries[`task:${stage.id}`];
      if (noProgressInjectionMode && stage.id === "gate:repair-loop") {
        if (!current || current.status !== "running") {
          throw new Error("verification-failed: repair-loop retry did not remain running");
        }
        await ledger.transition(current.id, "failed", { stopReason: "unknown-impact" });
        await ledger.transition(current.id, "pending");
        const retryEntry = (await ledger.load()).entries[entry.id];
        if (!retryEntry) throw new Error(`reference-integrity: missing retry task ${stage.id}`);
        await ledger.transition(retryEntry.id, "running");
        activeTaskId = retryEntry.id;
        activeAttempt = (await ledger.load()).entries[retryEntry.id]?.attemptCount;
        setToolObservationContext(context, {
          runId: activeToolRunId,
          taskId: activeTaskId,
          attempt: activeAttempt,
        });
        const retryTaskUsageBefore = (await ledger.load()).usage?.[retryEntry.id];
        const retryTaskExternalBefore = retryTaskUsageBefore?.externalProcessExecutions ?? 0;
        const retryTaskLogicalBefore = retryTaskUsageBefore?.logicalToolRequests ?? 0;
        const retryTaskElapsedBefore = retryTaskUsageBefore?.elapsedSeconds ?? 0;
        const retryRunExternalBefore = runExternalProcessExecutions;
        const retryRunLogicalBefore = runLogicalToolRequests;
        const retryMonotonicStart = monotonicClock.now();
        await stage.run(context);
        monotonicClock.advance(1);
        stageExternalProcessExecutions[stage.id] =
          (stageExternalProcessExecutions[stage.id] ?? 0) +
          (runExternalProcessExecutions - retryRunExternalBefore);
        const retryTaskUsageAfter = createBudgetUsageSnapshot({
          scope: "task",
          attempts:
            (await ledger.load()).entries[retryEntry.id]?.attemptCount ?? retryEntry.attemptCount,
          elapsedSeconds: retryTaskElapsedBefore + (monotonicClock.now() - retryMonotonicStart),
          externalProcessExecutions:
            retryTaskExternalBefore + (runExternalProcessExecutions - retryRunExternalBefore),
          logicalToolRequests:
            retryTaskLogicalBefore + (runLogicalToolRequests - retryRunLogicalBefore),
        });
        await ledger.updateUsage(retryEntry.id, retryTaskUsageAfter);
        const retryContextHash = await writeContext(runRoot, context);
        const retryHashes = await artifactHashes(runRoot);
        const retryRecord: ExecutionRecord = {
          mode,
          stageId: stage.id,
          gate: stage.gate,
          contextHash: retryContextHash,
          artifactHashes: retryHashes,
        };
        executedRecords.push(retryRecord);
        await writeFile(executionPath(runRoot), `${JSON.stringify(executedRecords, null, 2)}\n`);
        await writeResults(runRoot, context.results);
        const retryObservations = context.watchdogProgressObservations ?? [];
        const retryReasons = detectNoProgress(retryObservations);
        const nextStage =
          phase1Stages[phase1Stages.findIndex((candidate) => candidate.id === stage.id) + 1];
        if (retryReasons.length === 0) {
          throw new Error("verification-failed: attempt-level no-progress was not detected");
        }
        const retryRunUsage = createBudgetUsageSnapshot({
          scope: "run",
          attempts: (await log.readAll()).filter(
            (event) =>
              event.type === "task.transitioned" &&
              (event.payload as { to?: string }).to === "running",
          ).length,
          elapsedSeconds: monotonicClock.now(),
          externalProcessExecutions: runExternalProcessExecutions,
          logicalToolRequests: runLogicalToolRequests,
        });
        const retryStopRecord = buildStopRecord({
          reasonCode: "unknown-impact",
          knownFacts: [
            `attempt-level no-progress reasons: ${retryReasons.join(", ")}`,
            `stopped after attempt ${activeAttempt ?? retryEntry.attemptCount}`,
          ],
          uncertainties: ["the next attempt and downstream stage were not started"],
          options: [{ id: "resume", description: "resume after reviewing the repeated attempt" }],
          recommendation: "review the repeated task input and proposal before resuming",
          resumeCondition: "the repeated attempt has been reviewed",
          resumePosition: { eventPosition: (await log.readAll()).length },
          budgetSnapshot: { run: retryRunUsage, task: retryTaskUsageAfter },
          evidenceIds: [`evidence:no-progress:${stage.id}`],
        });
        await writeFile(
          join(runRoot, "stop-record.json"),
          `${JSON.stringify(retryStopRecord, null, 2)}\n`,
        );
        await ledger.transition(retryEntry.id, "blocked", { stopReason: "unknown-impact" });
        noProgressStop = {
          stoppedStageId: stage.id,
          stoppedAttempt: activeAttempt ?? retryEntry.attemptCount,
          nextAttempt: (activeAttempt ?? retryEntry.attemptCount) + 1,
          nextStageId: nextStage?.id ?? null,
          reasons: retryReasons,
        };
        stopRequested = true;
        continue;
      }
      if (current?.status === "running") {
        await ledger.transition(current.id, "completed", { resultId: `result:${stage.id}` });
      }
    }

    const finalEvents = await log.readAll();
    await writeResults(runRoot, context.results);
    const manifest: RunManifest = {
      selectedCheckpoint: selectedCheckpoint?.id ?? null,
      skippedStageIds: [...skipped],
      rerunStageIds: phase1Stages
        .filter((stage) => !skipped.has(stage.id))
        .map((stage) => stage.id),
      executedStageIds: executedRecords
        .filter((record) => record.mode === mode)
        .map((record) => record.stageId),
      actualStageExecution: executedRecords,
      gateResults: context.results,
      eventCount: finalEvents.length,
      contextValidation: {
        deserialized: resumeMode,
        fixtureValidated: resumeMode,
        restoredContextHash,
        checkpointContextHash:
          (selectedCheckpoint?.executionEnvironment as { contextHash?: string } | undefined)
            ?.contextHash ?? null,
      },
    };
    await writeFile(join(runRoot, "run.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      join(runRoot, "budget-runtime.json"),
      `${JSON.stringify(
        {
          runUsage: createBudgetUsageSnapshot({
            scope: "run",
            attempts: finalEvents.filter(
              (event) =>
                event.type === "task.transitioned" &&
                (event.payload as { to?: string }).to === "running",
            ).length,
            elapsedSeconds: monotonicClock.now(),
            externalProcessExecutions: runExternalProcessExecutions,
            logicalToolRequests: runLogicalToolRequests,
          }),
          attemptsByTask: finalEvents
            .filter(
              (event) =>
                event.type === "task.transitioned" &&
                (event.payload as { to?: string }).to === "running",
            )
            .reduce<Record<string, number>>((counts, event) => {
              const taskId = (event.payload as { taskId?: string }).taskId;
              if (taskId) counts[taskId] = (counts[taskId] ?? 0) + 1;
              return counts;
            }, {}),
          runBudget,
          nextStage: lastBudgetCheck ?? null,
          noProgressStop: noProgressStop ?? null,
          stageExternalProcessExecutions,
          stageUpperBoundChecks: Object.fromEntries(
            Object.entries(stageExternalProcessExecutions).map(([stageId, measured]) => [
              stageId,
              {
                measured,
                upperBound: externalProcessUpperBoundForStage(stageId),
                upperBoundAtLeastMeasured: externalProcessUpperBoundForStage(stageId) >= measured,
              },
            ]),
          ),
          observationCounts: {
            externalProcessExecutions: runExternalProcessExecutions,
            logicalToolRequests: runLogicalToolRequests,
            registryReplays: runRegistryReplays,
          },
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    if (resumeMode)
      await appendStopped(
        log,
        error instanceof Error ? error.message : String(error),
        caseId ?? "unknown",
      );
    throw error;
  } finally {
    setToolObservationHook(undefined);
    await log.close();
  }
};

// Interrupt control events are excluded; revisions are renumbered by position
// in the remaining event sequence so those excluded events cannot shift them.
const eventComparable = (event: EventEnvelope, comparableIndex: number): unknown => {
  if (event.type === "checkpoint.created") {
    const payload = structuredClone(event.payload) as { checkpoint?: Checkpoint };
    if (payload.checkpoint) delete payload.checkpoint.eventPosition;
    return {
      eventId: event.eventId,
      type: event.type,
      baseRevision: comparableIndex,
      resultRevision: comparableIndex + 1,
      payload,
    };
  }
  return {
    eventId: event.eventId,
    type: event.type,
    baseRevision: comparableIndex,
    resultRevision: comparableIndex + 1,
    payload: event.payload,
  };
};

const isUsageUpdate = (event: EventEnvelope): boolean =>
  event.type === "task.transitioned" &&
  (event.payload as { kind?: string }).kind === "usage-updated";

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

const runCase = async (id: string, interruption: string): Promise<Record<string, unknown>> => {
  const activeToolRunId = randomUUID();
  const caseRoot = join(artifactRoot, id);
  const baselineRoot = join(caseRoot, "baseline");
  const interruptedRoot = join(caseRoot, "interrupted");
  await rm(caseRoot, { recursive: true, force: true });
  await mkdir(baselineRoot, { recursive: true });
  await mkdir(interruptedRoot, { recursive: true });
  const baseline = await runChild([
    "--worker",
    `--case=${id}`,
    `--root=${baselineRoot}`,
    `--tool-run-id=${activeToolRunId}`,
  ]);
  if (baseline.code !== 0) throw new Error(`baseline worker failed: ${id}`);
  const killed = await runChild([
    "--worker",
    `--case=${id}`,
    `--root=${interruptedRoot}`,
    `--kill-after=${interruption}`,
    `--tool-run-id=${activeToolRunId}`,
  ]);
  if (killed.signal !== "SIGKILL") throw new Error(`worker did not terminate with SIGKILL: ${id}`);
  await rm(`${eventPath(interruptedRoot)}.lock`, { force: true });
  await rm(`${checkpointPath(interruptedRoot)}.lock`, { force: true });
  const interruptedLog = new FileEventLog(eventPath(interruptedRoot));
  await appendStopped(interruptedLog, "worker killed at configured stage boundary", id);
  await interruptedLog.close();
  const resumed = await runChild([
    "--worker",
    "--resume",
    `--case=${id}`,
    `--root=${interruptedRoot}`,
    `--tool-run-id=${activeToolRunId}`,
  ]);
  if (resumed.code !== 0) throw new Error(`resume worker failed: ${id}`);

  const baselineRun = await readJson<RunManifest>(
    join(baselineRoot, "run.json"),
    {} as RunManifest,
  );
  const resumedRun = await readJson<RunManifest>(
    join(interruptedRoot, "run.json"),
    {} as RunManifest,
  );
  const baselineLog = new FileEventLog(eventPath(baselineRoot));
  const baselineEvents = await baselineLog.readAll();
  await baselineLog.close();
  const resumedLog = new FileEventLog(eventPath(interruptedRoot));
  const resumedEvents = await resumedLog.readAll();
  await resumedLog.close();
  const baselineHashes = await artifactHashes(baselineRoot);
  const resumedHashes = await artifactHashes(interruptedRoot);
  const comparableBaseline = baselineEvents
    .filter(
      (event) =>
        event.type !== "run.stopped" && event.type !== "run.resumed" && !isUsageUpdate(event),
    )
    .map(eventComparable);
  const comparableResumed = resumedEvents
    .filter(
      (event) =>
        event.type !== "run.stopped" && event.type !== "run.resumed" && !isUsageUpdate(event),
    )
    .map(eventComparable);
  const hashesEqual = canonicalize(baselineHashes) === canonicalize(resumedHashes);
  const gatesEqual = canonicalize(baselineRun.gateResults) === canonicalize(resumedRun.gateResults);
  const eventsEqual = canonicalize(comparableBaseline) === canonicalize(comparableResumed);
  return {
    interruptionStageId: interruption,
    resumedCheckpoint: resumedRun.selectedCheckpoint,
    rerunStageIds: resumedRun.rerunStageIds,
    skippedStageIds: resumedRun.skippedStageIds,
    actualExecutedStageIds: resumedRun.executedStageIds,
    actualStageExecution: resumedRun.actualStageExecution,
    artifactHashComparison: {
      baseline: baselineHashes,
      resumed: resumedHashes,
      equal: hashesEqual,
    },
    gateResultComparison: {
      baseline: baselineRun.gateResults,
      resumed: resumedRun.gateResults,
      equal: gatesEqual,
    },
    eventSequenceComparison: {
      equalExcludingInterruptions: eventsEqual,
      excludedEvents: ["run.stopped", "run.resumed", "task.transitioned(kind=usage-updated)"],
    },
    baselineEventCount: baselineEvents.length,
    resumedEventCount: resumedEvents.length,
    comparableBaselineEventCount: comparableBaseline.length,
    comparableResumedEventCount: comparableResumed.length,
    contextValidation: resumedRun.contextValidation,
    verification: {
      passed: hashesEqual && gatesEqual && eventsEqual,
      failures: [
        ...(hashesEqual ? [] : ["artifact hash mismatch"]),
        ...(gatesEqual ? [] : ["gate result mismatch"]),
        ...(eventsEqual ? [] : ["event sequence mismatch"]),
      ],
    },
  };
};

const buildBudgetWatchdogEvidence = async (): Promise<BudgetWatchdogEvidence> => {
  const injectedRoot = join(artifactRoot, "budget-watchdog-injected");
  await rm(injectedRoot, { recursive: true, force: true });
  await mkdir(injectedRoot, { recursive: true });
  const injected = await runChild([
    "--worker",
    "--budget-injected",
    "--case=budget-watchdog-injected",
    `--root=${injectedRoot}`,
    "--tool-run-id=tool-run:budget-watchdog-injected",
  ]);
  if (injected.code !== 0) throw new Error("budget watchdog injected worker failed");
  const run = await readJson<RunManifest>(join(injectedRoot, "run.json"), {} as RunManifest);
  const runtime = await readJson<{
    runUsage: ReturnType<typeof createBudgetUsageSnapshot>;
    runBudget: {
      scope: "execution";
      timeSeconds: number;
      toolCalls: number;
    };
    nextStage: {
      nextStageId: string;
      runBudget: {
        scope: "execution";
        timeSeconds: number;
        toolCalls: number;
      };
      taskBudget: TaskLedgerEntry["budget"];
      operationEstimate: { elapsedSeconds: number; externalProcessExecutions: number };
    } | null;
    stageExternalProcessExecutions: Record<string, number>;
    stageUpperBoundChecks: Record<
      string,
      { measured: number; upperBound: number; upperBoundAtLeastMeasured: boolean }
    >;
    observationCounts: BudgetWatchdogEvidence["injectedNoProgress"]["observationCounts"];
  }>(join(injectedRoot, "budget-runtime.json"), {} as never);
  const normalRuntime = await readJson<{
    stageUpperBoundChecks: Record<
      string,
      { measured: number; upperBound: number; upperBoundAtLeastMeasured: boolean }
    >;
  }>(join(artifactRoot, "after-drc", "baseline", "budget-runtime.json"), {
    stageUpperBoundChecks: {},
  });
  const stopRecord = await readJson<ReturnType<typeof buildStopRecord>>(
    join(injectedRoot, "stop-record.json"),
    {} as ReturnType<typeof buildStopRecord>,
  );
  const nextStage = runtime.nextStage;
  if (!nextStage)
    throw new Error("verification-failed: injected worker did not record budget check");
  const taskSnapshot = stopRecord.budgetSnapshot.task;
  const noProgressRoot = join(artifactRoot, "budget-watchdog-no-progress");
  await rm(noProgressRoot, { recursive: true, force: true });
  await mkdir(noProgressRoot, { recursive: true });
  const noProgressWorker = await runChild([
    "--worker",
    "--no-progress-injected",
    "--case=budget-watchdog-no-progress",
    `--root=${noProgressRoot}`,
    "--tool-run-id=tool-run:budget-watchdog-no-progress",
  ]);
  if (noProgressWorker.code !== 0) throw new Error("budget watchdog no-progress worker failed");
  const noProgressRun = await readJson<RunManifest>(
    join(noProgressRoot, "run.json"),
    {} as RunManifest,
  );
  const noProgressRuntime = await readJson<{
    runUsage: ReturnType<typeof createBudgetUsageSnapshot>;
    runBudget: Budget;
    attemptsByTask: Record<string, number>;
    nextStage: {
      taskBudget: TaskLedgerEntry["budget"];
    } | null;
    noProgressStop: {
      stoppedStageId: string;
      stoppedAttempt: number;
      nextAttempt: number;
      nextStageId: string | null;
      reasons: string[];
    } | null;
    observationCounts: BudgetWatchdogEvidence["injectedNoProgress"]["observationCounts"];
  }>(join(noProgressRoot, "budget-runtime.json"), {} as never);
  const noProgressContext = deserializeStageContext(
    await readFile(contextPath(noProgressRoot), "utf8"),
  );
  const noProgressObservations = noProgressContext.watchdogProgressObservations ?? [];
  const noProgressStop = noProgressRuntime.noProgressStop;
  if (!noProgressStop)
    throw new Error("verification-failed: no-progress worker did not record its stop");
  const noProgressStopRecord = await readJson<ReturnType<typeof buildStopRecord>>(
    join(noProgressRoot, "stop-record.json"),
    {} as ReturnType<typeof buildStopRecord>,
  );
  const noProgressReasons = detectNoProgress(noProgressObservations);
  return {
    runner: "phase4-resume",
    normalRunObservationCounts: normalRuntime.stageUpperBoundChecks,
    injectedBudget: {
      runUsage: runtime.runUsage,
      taskUsage: taskSnapshot,
      runBudget: nextStage.runBudget,
      taskBudget: nextStage.taskBudget,
      executedStageIds: run.executedStageIds,
      stopRecord,
      nextStageId: nextStage.nextStageId,
      nextStageStarted: run.executedStageIds.includes(nextStage.nextStageId),
      nextStageUpperBound: nextStage.operationEstimate,
      observationCounts: runtime.observationCounts,
    },
    injectedNoProgress: {
      reasons: noProgressReasons,
      run: {
        runUsage: noProgressRuntime.runUsage,
        budget: noProgressRuntime.runBudget,
      },
      task: {
        taskUsage: noProgressStopRecord.budgetSnapshot.task,
        budget: noProgressRuntime.nextStage?.taskBudget ?? noProgressRuntime.runBudget,
      },
      observations: noProgressObservations,
      observationCount: noProgressObservations.length,
      noProgressObservationStatus: noProgressReasons.length > 0 ? "detected" : "not-detected",
      executedStageIds: noProgressRun.executedStageIds,
      stopRecord: noProgressStopRecord,
      nextStageId: noProgressStop.nextStageId ?? "none",
      nextAttempt: noProgressStop.nextAttempt,
      nextAttemptStarted:
        (noProgressRuntime.attemptsByTask[`task:${noProgressStop.stoppedStageId}`] ?? 0) >=
        noProgressStop.nextAttempt,
      nextStageStarted:
        noProgressStop.nextStageId !== null &&
        noProgressRun.executedStageIds.includes(noProgressStop.nextStageId),
      repairEvidence: await readJson<unknown>(
        join(noProgressRoot, "repair-loop-watchdog.json"),
        null,
      ),
      observationCounts: noProgressRuntime.observationCounts,
    },
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
    ["after-drc", "gate:drc"],
    ["after-knowledge-lifecycle", "gate:knowledge-lifecycle"],
    ["after-pre-order", "gate:pre-order"],
  ] as const;
  const results = [];
  for (const [id, interruption] of cases)
    results.push({ caseId: id, ...(await runCase(id, interruption)) });
  await writeFile(
    join(artifactRoot, "resume.json"),
    `${JSON.stringify(
      {
        runner: "phase4-resume",
        stages: phase1Stages.map((stage) => ({ id: stage.id, gate: stage.gate })),
        interruptionCases: results,
        comparison: {
          outputHashes: "SHA-256 over normalized real Phase 1 artifacts",
          eventSequence:
            "canonical event comparison excluding run.stopped/run.resumed/task.transitioned(kind=usage-updated)",
          context: "validated StageContext with fixture references and checkpoint hash equality",
        },
      },
      null,
      2,
    )}\n`,
  );
  const failures = results.flatMap((result) => {
    const verification = result.verification as { passed: boolean; failures: string[] };
    return verification.passed ? [] : [`${result.caseId}: ${verification.failures.join(", ")}`];
  });
  if (failures.length > 0) {
    throw new Error(`verification-failed: ${failures.join("; ")}`);
  }
  const budgetEvidence = await buildBudgetWatchdogEvidence();
  await writeFile(
    join(artifactRoot, "budget-watchdog.json"),
    `${JSON.stringify(budgetEvidence, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}
