import { GraphCoreError } from "./errors.js";
import {
  createEvent,
  type EventEnvelope,
  type EventLog,
  verifyEvent,
  verifyReplay,
} from "./event-log.js";
import { canonicalize } from "./hash.js";

export type TaskLedgerStatus =
  | "pending"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalState = "not-required" | "pending" | "approved" | "rejected";

export type LedgerBudget = {
  scope: "execution" | "total-order-cost";
  timeSeconds?: number;
  tokens?: number;
  toolCalls?: number;
  amount?: number;
  currency?: string;
};

export type LedgerMeasurements = {
  attempts: number;
  clockSeconds: number;
  toolCalls: number;
  tokens: "unknown";
  money: "unknown";
};

export type TaskLedgerEntry = {
  id: string;
  purpose: string;
  inputRevision: number;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  attemptCount: number;
  retryBudget: number;
  budget: LedgerBudget;
  approvalState: ApprovalState;
  status: TaskLedgerStatus;
  stopReason?: string;
  checkpointId?: string;
  artifactIds: string[];
  resultId?: string;
  measurements: LedgerMeasurements;
};

export type TaskTransitionContext = {
  stopReason?: string;
  resultId?: string;
  checkpointId?: string;
  artifactIds?: string[];
};

export type TaskLedgerState = {
  revision: number;
  entries: Record<string, TaskLedgerEntry>;
};

export interface ClockPort {
  now(): string;
}

export interface IdPort {
  next(prefix: string): string;
}

export type TaskLedgerEventPayload =
  | { kind: "created"; entry: TaskLedgerEntry }
  | {
      kind: "transitioned";
      taskId: string;
      from: TaskLedgerStatus;
      to: TaskLedgerStatus;
      entry: TaskLedgerEntry;
    };

const statusValues: TaskLedgerStatus[] = [
  "pending",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];

const isStatus = (value: unknown): value is TaskLedgerStatus =>
  typeof value === "string" && statusValues.includes(value as TaskLedgerStatus);

const fail = (message: string, context: Record<string, unknown> = {}): never => {
  throw new GraphCoreError("verification-failed", message, "error", context);
};

export const validateTaskLedgerEntry = (entry: TaskLedgerEntry): void => {
  if (!entry.id || !entry.purpose || entry.inputRevision < 0) {
    fail(`invalid task ledger entry: ${entry.id}`);
  }
  if (!isStatus(entry.status)) fail(`invalid task status: ${entry.status}`);
  if (entry.attemptCount < 0 || entry.retryBudget < 0) {
    fail(`invalid retry counters: ${entry.id}`);
  }
  if (entry.acceptanceCriteria.length === 0) fail(`missing acceptance criteria: ${entry.id}`);
  if (entry.measurements.tokens !== "unknown" || entry.measurements.money !== "unknown") {
    fail(`unmeasured budget fields must remain unknown: ${entry.id}`);
  }
};

const dependencyEntries = (
  entry: TaskLedgerEntry,
  entries: readonly TaskLedgerEntry[],
): TaskLedgerEntry[] =>
  entry.dependencyIds.map((dependencyId) => {
    const dependency = entries.find((candidate) => candidate.id === dependencyId);
    if (!dependency) {
      throw new GraphCoreError(
        "reference-integrity",
        `task ${entry.id} depends on missing task ${dependencyId}`,
      );
    }
    return dependency;
  });

const canStart = (entry: TaskLedgerEntry, entries: readonly TaskLedgerEntry[]): boolean =>
  entry.approvalState !== "pending" &&
  entry.approvalState !== "rejected" &&
  dependencyEntries(entry, entries).every((dependency) => dependency.status === "completed");

export const transitionTask = (
  entry: TaskLedgerEntry,
  target: TaskLedgerStatus,
  entries: readonly TaskLedgerEntry[],
  context: TaskTransitionContext = {},
): TaskLedgerEntry => {
  validateTaskLedgerEntry(entry);
  if (entry.status === target) fail(`task ${entry.id} is already ${target}`);
  const allowed: Record<TaskLedgerStatus, TaskLedgerStatus[]> = {
    pending: ["running", "blocked", "cancelled"],
    running: ["completed", "blocked", "failed", "cancelled"],
    blocked: ["pending", "cancelled"],
    completed: [],
    failed: ["pending", "cancelled"],
    cancelled: [],
  };
  if (!allowed[entry.status].includes(target)) {
    fail(`invalid task transition: ${entry.status} -> ${target}`, {
      taskId: entry.id,
      from: entry.status,
      to: target,
    });
  }
  if (target === "running") {
    if (!canStart(entry, entries)) {
      fail(`task ${entry.id} cannot run before dependencies and approval are ready`);
    }
    if (entry.attemptCount >= entry.retryBudget + 1) {
      fail(`task ${entry.id} exceeded retry budget`);
    }
  }
  if (target === "blocked" || target === "failed" || target === "cancelled") {
    if (!context.stopReason) fail(`stop reason is required for task ${entry.id}`);
  }
  if (target === "completed" && !context.resultId && !entry.resultId) {
    fail(`result ID is required to complete task ${entry.id}`);
  }
  const next: TaskLedgerEntry = {
    ...entry,
    status: target,
    attemptCount: target === "running" ? entry.attemptCount + 1 : entry.attemptCount,
    artifactIds: context.artifactIds ?? entry.artifactIds,
    measurements: {
      ...entry.measurements,
      attempts:
        target === "running" ? entry.measurements.attempts + 1 : entry.measurements.attempts,
    },
  };
  const stopReason = context.stopReason ?? entry.stopReason;
  if (stopReason && target !== "completed" && target !== "pending") next.stopReason = stopReason;
  const checkpointId = context.checkpointId ?? entry.checkpointId;
  if (checkpointId) next.checkpointId = checkpointId;
  const resultId = context.resultId ?? entry.resultId;
  if (resultId) next.resultId = resultId;
  validateTaskLedgerEntry(next);
  return next;
};

const taskPayload = (event: EventEnvelope): TaskLedgerEventPayload => {
  const payload = event.payload as TaskLedgerEventPayload;
  if (!payload || (payload.kind !== "created" && payload.kind !== "transitioned")) {
    throw new GraphCoreError(
      "event-replay-failure",
      `invalid task event payload: ${event.eventId}`,
    );
  }
  return payload;
};

export const replayTaskLedger = (events: readonly EventEnvelope[]): TaskLedgerState => {
  verifyReplay([...events]);
  const state: TaskLedgerState = { revision: 0, entries: {} };
  for (const event of events) {
    if (event.type !== "task.created" && event.type !== "task.transitioned") {
      state.revision = event.resultRevision;
      continue;
    }
    const payload = taskPayload(event);
    if (payload.kind === "created") {
      if (state.entries[payload.entry.id]) {
        throw new GraphCoreError("event-replay-failure", `duplicate task: ${payload.entry.id}`);
      }
      validateTaskLedgerEntry(payload.entry);
      state.entries[payload.entry.id] = structuredClone(payload.entry);
    } else {
      const current = state.entries[payload.taskId];
      if (!current || current.status !== payload.from) {
        throw new GraphCoreError(
          "event-replay-failure",
          `task transition does not match state: ${payload.taskId}`,
        );
      }
      validateTaskLedgerEntry(payload.entry);
      state.entries[payload.taskId] = structuredClone(payload.entry);
    }
    state.revision = event.resultRevision;
  }
  return state;
};

export class TaskLedgerRuntime {
  private state: TaskLedgerState = { revision: 0, entries: {} };

  constructor(
    private readonly projectId: string,
    private readonly actor: string,
    private readonly eventLog: EventLog,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  async load(): Promise<TaskLedgerState> {
    this.state = replayTaskLedger(await this.eventLog.readAll());
    return structuredClone(this.state);
  }

  async assertConsistent(held: TaskLedgerState): Promise<void> {
    const replayed = await this.load();
    if (canonicalize(replayed) !== canonicalize(held)) {
      throw new GraphCoreError(
        "event-replay-failure",
        "held task ledger differs from event replay",
      );
    }
  }

  async create(entry: TaskLedgerEntry): Promise<TaskLedgerState> {
    validateTaskLedgerEntry(entry);
    if (this.state.entries[entry.id]) fail(`task already exists: ${entry.id}`);
    await this.append("task.created", { kind: "created", entry });
    return structuredClone(this.state);
  }

  async transition(
    taskId: string,
    target: TaskLedgerStatus,
    context: TaskTransitionContext = {},
  ): Promise<TaskLedgerState> {
    const entry = this.state.entries[taskId];
    if (!entry) throw new GraphCoreError("reference-integrity", `unknown task: ${taskId}`);
    const next = transitionTask(entry, target, Object.values(this.state.entries), context);
    await this.append("task.transitioned", {
      kind: "transitioned",
      taskId,
      from: entry.status,
      to: target,
      entry: next,
    });
    return structuredClone(this.state);
  }

  private async append(
    type: "task.created" | "task.transitioned",
    payload: TaskLedgerEventPayload,
  ) {
    const event = createEvent({
      eventId: this.ids.next("event"),
      type,
      occurredAt: this.clock.now(),
      actor: this.actor,
      projectId: this.projectId,
      baseRevision: this.state.revision,
      resultRevision: this.state.revision + 1,
      payload,
    });
    verifyEvent(event);
    await this.eventLog.append(event);
    this.state = replayTaskLedger([...(await this.eventLog.readAll()).slice(0, -1), event]);
  }
}
