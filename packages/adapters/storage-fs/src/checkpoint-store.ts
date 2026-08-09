import { mkdir, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import {
  canonicalize,
  GraphCoreError,
  type Checkpoint,
  type CheckpointStore,
} from "@acd/graph-core";

export class FileCheckpointStore implements CheckpointStore {
  private handle: FileHandle | undefined;
  private lock: FileHandle | undefined;

  constructor(private readonly path: string) {}

  async write(checkpoint: Checkpoint): Promise<void> {
    const handle = await this.openWriter();
    await handle.write(`${canonicalize(checkpoint)}\n`, undefined, "utf8");
    await handle.sync();
  }

  async readAll(): Promise<Checkpoint[]> {
    try {
      const content = await readFile(this.path, "utf8");
      const lastNewline = content.lastIndexOf("\n");
      return content
        .slice(0, lastNewline + 1)
        .split("\n")
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line) as Checkpoint;
          } catch (error) {
            throw new GraphCoreError(
              "event-replay-failure",
              `invalid checkpoint JSON at line ${index + 1}`,
              "critical",
              { cause: error instanceof Error ? error.message : String(error) },
            );
          }
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
        throw new Error(`checkpoint-store writer lock already held: ${this.path}`);
      }
      throw error;
    }
  }
}
