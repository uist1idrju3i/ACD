import { isDeepStrictEqual } from "node:util";
import type { KnowledgeItem } from "./knowledge-lifecycle.js";
import { GraphCoreError } from "./errors.js";

/** Persistence contract: saves are idempotent for equal IDs and reject conflicting IDs. */
export interface KnowledgeRepository {
  save(item: KnowledgeItem): Promise<void>;
  get(id: string): Promise<KnowledgeItem | undefined>;
  list(): Promise<KnowledgeItem[]>;
}

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly items = new Map<string, KnowledgeItem>();

  async save(item: KnowledgeItem): Promise<void> {
    const existing = this.items.get(item.id);
    if (existing) {
      if (!isDeepStrictEqual(existing, item)) {
        throw new GraphCoreError(
          "reference-integrity",
          `knowledge ID already exists with different content: ${item.id}`,
        );
      }
      return;
    }
    this.items.set(item.id, structuredClone(item));
  }

  async get(id: string): Promise<KnowledgeItem | undefined> {
    const item = this.items.get(id);
    return item ? structuredClone(item) : undefined;
  }

  async list(): Promise<KnowledgeItem[]> {
    return structuredClone([...this.items.values()]);
  }
}
