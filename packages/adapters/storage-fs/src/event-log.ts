import { mkdir, open, readFile, truncate, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalize } from "@acd/graph-core";
import { GraphCoreError, verifyEvent, type EventEnvelope, type EventLog } from "@acd/graph-core";

export class FileEventLog implements EventLog {
  private handle: FileHandle | undefined;
  private lock: FileHandle | undefined;

  constructor(private readonly path: string) {}

  async append(event: EventEnvelope): Promise<void> {
    verifyEvent(event);
    const handle = await this.openWriter();
    await handle.write(`${canonicalize(event)}\n`, undefined, "utf8");
    await handle.sync();
  }

  async readAll(): Promise<EventEnvelope[]> {
    try {
      const content = await readFile(this.path);
      const lastNewline = content.lastIndexOf(0x0a);
      const complete = content.subarray(0, lastNewline + 1);
      if (lastNewline + 1 !== content.length) {
        if (this.handle) await this.handle.truncate(lastNewline + 1);
        else await truncate(this.path, lastNewline + 1);
      }
      const lines = complete.toString("utf8").split("\n").filter(Boolean);
      return lines.map((line, index) => {
        let event: EventEnvelope;
        try {
          event = JSON.parse(line) as EventEnvelope;
        } catch (error) {
          throw new GraphCoreError(
            "event-replay-failure",
            `invalid event JSON at line ${index + 1}`,
            "critical",
            { cause: error instanceof Error ? error.message : String(error) },
          );
        }
        try {
          verifyEvent(event);
        } catch (error) {
          if (error instanceof GraphCoreError) throw error;
          throw new GraphCoreError(
            "event-replay-failure",
            `invalid event envelope at line ${index + 1}`,
            "critical",
            { cause: error instanceof Error ? error.message : String(error) },
          );
        }
        return event;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.handle?.close();
    await this.lock?.close();
    this.handle = undefined;
    if (this.lock) {
      this.lock = undefined;
      try {
        await unlink(`${this.path}.lock`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  private async openWriter(): Promise<FileHandle> {
    if (this.handle) return this.handle;
    await mkdir(dirname(this.path), { recursive: true });
    try {
      this.lock = await open(`${this.path}.lock`, "wx");
      this.handle = await open(this.path, "a");
      return this.handle;
    } catch (error) {
      await this.lock?.close();
      if (this.lock) {
        this.lock = undefined;
        try {
          await unlink(`${this.path}.lock`);
        } catch {
          // Preserve the original open error.
        }
      }
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`event-log writer lock already held: ${this.path}`);
      }
      throw error;
    }
  }
}
