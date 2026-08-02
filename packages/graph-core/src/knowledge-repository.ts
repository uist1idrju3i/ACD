import type { KnowledgeItem } from "./knowledge-lifecycle.js";

export interface KnowledgeRepository {
  save(item: KnowledgeItem): Promise<void>;
  get(id: string): Promise<KnowledgeItem | undefined>;
  list(): Promise<KnowledgeItem[]>;
}

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private readonly items = new Map<string, KnowledgeItem>();

  async save(item: KnowledgeItem): Promise<void> {
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
