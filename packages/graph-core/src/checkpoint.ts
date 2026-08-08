import type { Checkpoint as SchemaCheckpoint } from "@acd/schema";
import { createEvent, type EventEnvelope, type EventLog } from "./event-log.js";
import { GraphCoreError } from "./errors.js";
import { canonicalize } from "./hash.js";

export type Checkpoint = SchemaCheckpoint;

export type CheckpointInvalidationField =
  | "inputRevision"
  | "inputHash"
  | "graphRevision"
  | "toolVersion"
  | "modelVersion"
  | "libraryVersion"
  | "containerVersion"
  | "provenance"
  | "measurementSystemQualification"
  | "fabProfileId"
  | "manufacturingProfileId"
  | "knowledgeItemStatuses";

export type CheckpointContext = Pick<Checkpoint, CheckpointInvalidationField>;

export type CheckpointStalenessReason = {
  field: CheckpointInvalidationField;
  kind: "changed" | "unknown";
  checkpointValue: unknown;
  currentValue: unknown;
};

export type CheckpointStaleness = {
  stale: boolean;
  reasons: CheckpointStalenessReason[];
};

export const assessCheckpointStaleness = (
  checkpoint: CheckpointContext,
  current: Partial<CheckpointContext>,
): CheckpointStaleness => {
  const fields: CheckpointInvalidationField[] = [
    "inputRevision",
    "inputHash",
    "graphRevision",
    "toolVersion",
    "modelVersion",
    "libraryVersion",
    "containerVersion",
    "provenance",
    "measurementSystemQualification",
    "fabProfileId",
    "manufacturingProfileId",
    "knowledgeItemStatuses",
  ];
  const reasons: CheckpointStalenessReason[] = [];
  for (const field of fields) {
    const checkpointValue = checkpoint[field];
    const currentValue = current[field];
    if (currentValue === undefined) {
      reasons.push({ field, kind: "unknown", checkpointValue, currentValue });
      continue;
    }
    if (canonicalize(checkpointValue) !== canonicalize(currentValue)) {
      reasons.push({ field, kind: "changed", checkpointValue, currentValue });
    }
  }
  return { stale: reasons.length > 0, reasons };
};

export interface CheckpointStore {
  write(checkpoint: Checkpoint): Promise<void>;
  readAll(): Promise<Checkpoint[]>;
}

export interface CheckpointIds {
  next(prefix: string): string;
}

export interface CheckpointClock {
  now(): string;
}

export type CheckpointCreateInput = Omit<
  Checkpoint,
  "id" | "type" | "revision" | "eventPosition"
> & {
  revision?: number;
};

export class CheckpointRuntime {
  constructor(
    private readonly projectId: string,
    private readonly actor: string,
    private readonly eventLog: EventLog,
    private readonly store: CheckpointStore,
    private readonly clock: CheckpointClock,
    private readonly ids: CheckpointIds,
  ) {}

  async create(input: CheckpointCreateInput): Promise<Checkpoint> {
    const events = await this.eventLog.readAll();
    const checkpoint = {
      ...input,
      id: this.ids.next("checkpoint"),
      type: "Checkpoint",
      revision: input.revision ?? 0,
      eventPosition: events.length,
    } as Checkpoint;
    await this.store.write(checkpoint);
    await this.eventLog.append(
      createEvent({
        eventId: this.ids.next("event"),
        type: "checkpoint.created",
        occurredAt: this.clock.now(),
        actor: this.actor,
        projectId: this.projectId,
        baseRevision: events.length,
        resultRevision: events.length + 1,
        payload: { checkpointId: checkpoint.id, checkpoint },
      }),
    );
    return structuredClone(checkpoint);
  }

  async list(): Promise<Checkpoint[]> {
    return this.store.readAll();
  }
}

export type ResumeStage = {
  id: string;
};

export type ResumePlan = {
  resumeId: string;
  checkpoint: Checkpoint;
  rerunStageIds: string[];
  skippedStageIds: string[];
  idempotent: boolean;
};

type VerificationPayload = {
  verificationResultId?: string;
  status?: string;
  result?: { id?: string; status?: string };
};

const checkpointIsVerified = (checkpoint: Checkpoint, events: EventEnvelope[]): boolean => {
  const passed = new Set(
    events
      .filter((event) => event.type === "verification.completed")
      .flatMap((event) => {
        const payload = event.payload as VerificationPayload;
        const id = payload.verificationResultId ?? payload.result?.id;
        const status = payload.status ?? payload.result?.status;
        return id && status === "passed" ? [id] : [];
      }),
  );
  return (
    checkpoint.verificationResultIds.length > 0 &&
    checkpoint.verificationResultIds.every((id) => passed.has(id))
  );
};

export class ResumeOrchestrator {
  constructor(
    private readonly projectId: string,
    private readonly actor: string,
    private readonly eventLog: EventLog,
    private readonly store: CheckpointStore,
    private readonly clock: CheckpointClock,
    private readonly ids: CheckpointIds,
  ) {}

  async resume(
    resumeId: string,
    current: Partial<CheckpointContext>,
    stages: readonly ResumeStage[],
  ): Promise<ResumePlan> {
    const events = await this.eventLog.readAll();
    const existing = events.find(
      (event) =>
        event.type === "run.resumed" &&
        (event.payload as { resumeId?: string }).resumeId === resumeId,
    );
    if (existing) {
      return {
        ...structuredClone((existing.payload as { plan: ResumePlan }).plan),
        idempotent: true,
      };
    }

    const candidates = (await this.store.readAll())
      .filter((checkpoint) => checkpointIsVerified(checkpoint, events))
      .map((checkpoint) => ({
        checkpoint,
        staleness: assessCheckpointStaleness(checkpoint, current),
      }))
      .filter(({ staleness }) => !staleness.stale)
      .sort((left, right) => right.checkpoint.eventPosition - left.checkpoint.eventPosition);
    const selected = candidates[0]?.checkpoint;
    if (!selected) {
      const reasons = (await this.store.readAll()).flatMap((checkpoint) => ({
        checkpointId: checkpoint.id,
        reasons: assessCheckpointStaleness(checkpoint, current).reasons,
      }));
      await this.eventLog.append(
        createEvent({
          eventId: this.ids.next("event"),
          type: "run.stopped",
          occurredAt: this.clock.now(),
          actor: this.actor,
          projectId: this.projectId,
          baseRevision: events.length,
          resultRevision: events.length + 1,
          payload: { reason: "no-reusable-verified-checkpoint", reasons },
        }),
      );
      throw new GraphCoreError(
        "stale-result",
        "no reusable verified checkpoint is available",
        "critical",
        { reasons },
      );
    }

    const checkpointIndex = stages.findIndex((stage) => stage.id === selected.gate);
    const skippedStageIds =
      checkpointIndex < 0 ? [] : stages.slice(0, checkpointIndex + 1).map((stage) => stage.id);
    const rerunStageIds =
      checkpointIndex < 0
        ? stages.map((stage) => stage.id)
        : stages.slice(checkpointIndex + 1).map((stage) => stage.id);
    const plan: ResumePlan = {
      resumeId,
      checkpoint: selected,
      rerunStageIds,
      skippedStageIds,
      idempotent: false,
    };
    await this.eventLog.append(
      createEvent({
        eventId: this.ids.next("event"),
        type: "run.resumed",
        occurredAt: this.clock.now(),
        actor: this.actor,
        projectId: this.projectId,
        baseRevision: events.length,
        resultRevision: events.length + 1,
        payload: { resumeId, plan },
      }),
    );
    return structuredClone(plan);
  }
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints: Checkpoint[] = [];

  async write(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.push(structuredClone(checkpoint));
  }

  async readAll(): Promise<Checkpoint[]> {
    return structuredClone(this.checkpoints);
  }
}
