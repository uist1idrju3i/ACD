import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  componentLibraryFixturePath,
  phase1GoldenFixturePath,
  phase1Prototype2FixturePath,
} from "./paths.js";
import { loadSchemaValidator } from "./validator.js";

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

  it("rejects verified entries without a content hash", async () => {
    const [validator, records] = await Promise.all([
      loadSchemaValidator("component-library"),
      readJson<Record<string, unknown>>(componentLibraryFixturePath),
    ]);
    const invalid = structuredClone(records) as {
      components: Array<{
        implementationNotes: Array<{
          status: string;
          provenance: { contentHash: string | null; pendingReason?: string };
        }>;
      }>;
    };
    const verifiedNote = invalid.components
      .flatMap((component) => component.implementationNotes)
      .find((note) => note.status === "verified");
    expect(verifiedNote).toBeDefined();
    verifiedNote!.provenance.contentHash = null;
    verifiedNote!.provenance.pendingReason = "test";
    expect(validator(invalid)).toBe(false);
  });

  it("requires unknown status when an entry has no content hash", async () => {
    const [validator, records] = await Promise.all([
      loadSchemaValidator("component-library"),
      readJson<Record<string, unknown>>(componentLibraryFixturePath),
    ]);
    const invalid = structuredClone(records) as {
      components: Array<{
        datasheetReferences: Array<{
          status: string;
          provenance: { contentHash: string | null; pendingReason?: string };
        }>;
      }>;
    };
    const pendingReference = invalid.components
      .flatMap((component) => component.datasheetReferences)
      .find((reference) => reference.provenance.contentHash === null);
    expect(pendingReference).toBeDefined();
    pendingReference!.status = "verified";
    expect(validator(invalid)).toBe(false);
  });
});
