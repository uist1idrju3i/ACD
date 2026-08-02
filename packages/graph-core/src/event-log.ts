import { GraphCoreError } from "./errors.js";
import { sha256 } from "./hash.js";

export type EventType =
  | "snapshot.created"
  | "patch.accepted"
  | "patch.rejected"
  | "verification.started"
  | "verification.completed"
  | "verification.stale"
  | "checkpoint.created"
  | "run.stopped"
  | "run.resumed";

export type EventEnvelope = {
  eventId: string;
  type: EventType;
  occurredAt: string;
  actor: string;
  projectId: string;
  baseRevision: number;
  resultRevision: number;
  payloadHash: string;
  payload: unknown;
};

export interface EventLog {
  append(event: EventEnvelope): Promise<void>;
  readAll(): Promise<EventEnvelope[]>;
}

export const createEvent = (input: Omit<EventEnvelope, "payloadHash">): EventEnvelope => ({
  ...input,
  payloadHash: sha256(input.payload),
});

export const verifyEvent = (event: EventEnvelope): void => {
  if (event.payloadHash !== sha256(event.payload)) {
    throw new GraphCoreError(
      "event-replay-failure",
      `event payload hash mismatch: ${event.eventId}`,
      "critical",
    );
  }
};

export const verifyReplay = (events: EventEnvelope[]): void => {
  let revision = 0;
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.eventId))
      throw new GraphCoreError("event-replay-failure", `duplicate event: ${event.eventId}`);
    ids.add(event.eventId);
    verifyEvent(event);
    if (event.baseRevision !== revision) {
      throw new GraphCoreError(
        "event-replay-failure",
        `event revision gap: ${event.eventId}`,
        "critical",
      );
    }
    if (event.resultRevision < revision || event.resultRevision > revision + 1) {
      throw new GraphCoreError(
        "event-replay-failure",
        `invalid result revision: ${event.eventId}`,
        "critical",
      );
    }
    revision = event.resultRevision;
  }
};

export class InMemoryEventLog implements EventLog {
  private readonly events: EventEnvelope[] = [];

  async append(event: EventEnvelope): Promise<void> {
    verifyEvent(event);
    this.events.push(structuredClone(event));
  }

  async readAll(): Promise<EventEnvelope[]> {
    return structuredClone(this.events);
  }
}
