import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  intakeFabFeedback,
  type FabFeedbackReferenceIndex,
  type FabFeedbackReport,
} from "@acd/graph-core";
import {
  loadSchemaValidator,
  type FabFeedbackReport as SchemaFabFeedbackReport,
} from "@acd/schema";

export interface FabFeedbackReader {
  read(): Promise<FabFeedbackReport>;
}

const sha256Text = (content: string): string =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;

const fixtureArtifactHash = (report: SchemaFabFeedbackReport): string =>
  sha256Text(
    JSON.stringify({
      ...report,
      source: { ...report.source, contentHash: "" },
    }),
  );

export class FixtureFabFeedbackReader implements FabFeedbackReader {
  constructor(private readonly path: string) {}

  async read(): Promise<FabFeedbackReport> {
    const content = await readFile(this.path, "utf8");
    const report = JSON.parse(content) as SchemaFabFeedbackReport;
    const validator = await loadSchemaValidator("fab-feedback");
    if (!validator(report)) {
      throw new Error(
        `fab feedback schema-invalid: ${(validator.errors ?? [])
          .map((error) => `${error.instancePath} ${error.message ?? "invalid"}`)
          .join("; ")}`,
      );
    }
    const typed = report as FabFeedbackReport;
    const rawHash = sha256Text(typed.rawReport.content);
    if (
      typed.rawReport.contentHash !== rawHash ||
      typed.source.contentHash !== fixtureArtifactHash(report)
    ) {
      throw new Error("fab feedback raw report content hash mismatch");
    }
    return typed;
  }
}

export const referenceIndexFromPhase1Fixture = (fixture: {
  fixtureId: string;
  requirement: { provenance: { version: string } };
  parts: { id: string }[];
  mappings: { partId: string; footprintLibraryId: string; footprintName: string }[];
  nets: { id?: string; name?: string }[];
}): FabFeedbackReferenceIndex => {
  const entityIds = new Set<string>(fixture.parts.map((part) => part.id));
  for (const mapping of fixture.mappings) {
    entityIds.add(`footprint:${mapping.footprintName}`);
    entityIds.add(`${mapping.footprintLibraryId}:${mapping.footprintName}`);
    entityIds.add(`footprint:${mapping.footprintLibraryId}:${mapping.footprintName}`);
  }
  for (const net of fixture.nets) {
    if (net.id) entityIds.add(net.id);
    if (net.name) entityIds.add(`net:${net.name}`);
  }
  return {
    projectId: fixture.fixtureId,
    designRevision: fixture.requirement.provenance.version,
    entityIds,
  };
};

export { intakeFabFeedback };
export { fabFeedbackUnknownError } from "@acd/graph-core";
export type {
  FabFeedbackEvidence,
  FabFeedbackFinding,
  FabFeedbackIntakeResult,
  FabFeedbackVerdict,
  FabFeedbackReferenceIndex,
  FabFeedbackReport,
} from "@acd/graph-core";
