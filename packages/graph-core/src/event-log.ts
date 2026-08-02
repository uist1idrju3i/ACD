import { appendFile, readFile } from "node:fs/promises";
import { GraphCoreError } from "./errors.js";
import { canonicalize, sha256 } from "./hash.js";

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

export class FileEventLog {
  constructor(private readonly path: string) {}

  async append(event: EventEnvelope): Promise<void> {
    verifyEvent(event);
    await appendFile(this.path, `${canonicalize(event)}\n`, "utf8");
  }

  async readAll(): Promise<EventEnvelope[]> {
    try {
      const content = await readFile(this.path, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventEnvelope);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async verifyReplay(): Promise<void> {
    const events = await this.readAll();
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
  }
}
