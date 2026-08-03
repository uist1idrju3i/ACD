import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { GraphCoreError, type KnowledgeItem, type KnowledgeRepository } from "@acd/graph-core";
import { loadKnowledgeItemValidator } from "@acd/schema";

export class FileKnowledgeRepository implements KnowledgeRepository {
  constructor(private readonly path: string) {}

  async save(item: KnowledgeItem): Promise<void> {
    const validator = await loadKnowledgeItemValidator();
    if (!(validator(item) as boolean))
      throw new GraphCoreError("schema-invalid", `invalid knowledge item: ${item.id}`);
    const existing = await this.get(item.id);
    if (existing) {
      if (!isDeepStrictEqual(existing, item))
        throw new GraphCoreError("reference-integrity", `knowledge ID already exists: ${item.id}`);
      return;
    }
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
      const validator = await loadKnowledgeItemValidator();
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parsed: unknown = JSON.parse(line);
          if (!(validator(parsed) as boolean))
            throw new GraphCoreError(
              "schema-invalid",
              "persisted knowledge item failed JSON Schema validation",
            );
          return parsed as KnowledgeItem;
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
