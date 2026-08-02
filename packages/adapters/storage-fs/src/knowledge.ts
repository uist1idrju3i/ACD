import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { KnowledgeItem, KnowledgeRepository } from "@acd/graph-core";

export class FileKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly path: string) {}

  async save(item: KnowledgeItem): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(item)}\n`, "utf8");
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const items = await this.list();
    return items.reverse().find((item) => item.id === id);
  }

  async list(): Promise<KnowledgeItem[]> {
    try {
      const content = await readFile(this.path, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as KnowledgeItem);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
