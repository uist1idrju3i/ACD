import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { repositoryRoot } from "./paths.js";

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
    footprintCandidates: Array<{ id: string }>;
  }>;
};

type Manifest = {
  files: Array<{ kind: string; id: string }>;
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const fixturePath = (path: string): string => `${repositoryRoot}/${path}`;

describe("component library coverage", () => {
  it("covers both Phase 1 fixture mappings with pinned snapshot footprints", async () => {
    const [golden, prototype2, records, manifest] = await Promise.all([
      readJson<Fixture>(fixturePath("fixtures/phase1/golden-esp32.json")),
      readJson<Fixture>(fixturePath("fixtures/phase1/prototype-2.json")),
      readJson<ComponentLibrary>(fixturePath("fixtures/phase3/component-library.json")),
      readJson<Manifest>(fixturePath("packages/adapters/kicad/library-snapshot/manifest.json")),
    ]);
    const recordById = new Map(records.components.map((component) => [component.id, component]));
    const pinnedFootprints = new Set(
      manifest.files.filter((entry) => entry.kind === "footprint").map((entry) => entry.id),
    );

    for (const mapping of [...golden.mappings, ...prototype2.mappings]) {
      const componentId = `${mapping.symbolLibraryId}:${mapping.symbolName}`;
      const record = recordById.get(componentId);
      expect(record, `missing component record ${componentId}`).toBeDefined();
      const footprintId = `footprint:${mapping.footprintLibraryId}:${mapping.footprintName}`;
      expect(
        record?.footprintCandidates.some((candidate) => candidate.id === footprintId),
        `missing candidate ${footprintId} for ${componentId}`,
      ).toBe(true);
      expect(
        pinnedFootprints.has(mapping.footprintName),
        `candidate is absent from pinned snapshot: ${mapping.footprintName}`,
      ).toBe(true);
    }
  });
});
