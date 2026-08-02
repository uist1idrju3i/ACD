import { appendFile, readFile } from "node:fs/promises";
import { canonicalize } from "@acd/graph-core";
import { verifyEvent, type EventEnvelope, type EventLog } from "@acd/graph-core";

export class FileEventLog implements EventLog {
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
}
