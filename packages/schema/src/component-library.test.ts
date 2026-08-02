import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  componentLibraryFixturePath,
  phase1GoldenFixturePath,
  phase1Prototype2FixturePath,
} from "./paths.js";

type Fixture = {
  mappings: Array<{
    symbolLibraryId: string;
    symbolName: string;
    footprintLibraryId: string;
    footprintName: string;
  }>;
};

type ComponentLibrary = {
  components: Array<{
    id: string;
    footprintCandidates: Array<{ id: string; source: { contentHash: string } }>;
  }>;
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

describe("component library coverage", () => {
  it("covers both Phase 1 fixture mappings with component-library footprint records", async () => {
    const [golden, prototype2, records] = await Promise.all([
      readJson<Fixture>(phase1GoldenFixturePath),
      readJson<Fixture>(phase1Prototype2FixturePath),
      readJson<ComponentLibrary>(componentLibraryFixturePath),
    ]);
    const recordById = new Map(records.components.map((component) => [component.id, component]));
    for (const mapping of [...golden.mappings, ...prototype2.mappings]) {
      const componentId = `${mapping.symbolLibraryId}:${mapping.symbolName}`;
      const record = recordById.get(componentId);
      expect(record, `missing component record ${componentId}`).toBeDefined();
      const footprintId = `footprint:${mapping.footprintLibraryId}:${mapping.footprintName}`;
      expect(
        record?.footprintCandidates.some((candidate) => candidate.id === footprintId),
        `missing candidate ${footprintId} for ${componentId}`,
      ).toBe(true);
      expect(record?.footprintCandidates.some((candidate) => candidate.id === footprintId)).toBe(
        true,
      );
    }
  });
});
