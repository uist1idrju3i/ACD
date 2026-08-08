import { mkdir, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalize } from "@acd/graph-core";
import { verifyEvent, type EventEnvelope, type EventLog } from "@acd/graph-core";

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
