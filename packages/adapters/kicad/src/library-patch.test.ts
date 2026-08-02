import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { KnowledgeItem } from "@acd/graph-core";
import {
  adoptVerifiedLibraryPatch,
  createLibraryPatchCandidate,
  officialLibraryRevision,
  promoteLibraryPatch,
  resolveLibraryRevision,
  reviseLibraryPatch,
  snapshotManifestHash,
  verifyLibraryPatchGeometry,
} from "./library-patch.js";
import { snapshotFiles, snapshotManifest } from "./library-snapshot.js";

const adoptedKnowledge = (): KnowledgeItem => ({
  id: "knowledge:test:r2",
  type: "KnowledgeItem",
  revision: 2,
  knowledgeId: "knowledge:test",
  scope: "project-local",
  sourceEventIds: ["event:fab-feedback:test"],
  provenance: [
    {
      kind: "fab-rule",
      locator: "fab-report:test",
      capturedAt: "2026-01-01T00:00:00.000Z",
      capturedBy: "fab:jlcpcb-class-2layer",
      contentHash: "sha256:" + "a".repeat(64),
      designRevision: "prototype-1",
      fabProfileId: "fab:jlcpcb-class-2layer",
      derivationInputHash: "sha256:" + "b".repeat(64),
      derivationOutputHash: "sha256:" + "c".repeat(64),
    },
  ],
  content: "mask-clearance: solder mask sliver near R1",
  status: "adopted",
  appliesWhen: [
    { field: "fabProfileId", operator: "equals", value: "fab:jlcpcb-class-2layer" },
    { field: "footprintId", operator: "equals", value: "R_0603_1608Metric" },
    { field: "ruleId", operator: "equals", value: "mask-sliver-min" },
  ],
  excludesWhen: [
    { field: "fabProfileId", operator: "notEquals", value: "fab:jlcpcb-class-2layer" },
  ],
  confidence: 0.98,
  reproduced: true,
});

describe("KiCad library overlay patches", () => {
  it("derives a deterministic patch and revision from declared rule data", () => {
    const first = createLibraryPatchCandidate(adoptedKnowledge());
    const second = createLibraryPatchCandidate(adoptedKnowledge());
    expect(second).toEqual(first);
    expect(first.operations).toEqual([
      {
        kind: "set-pad-mask-clearance",
        target: "pad-mask-clearance",
        requiredValueMm: 0,
      },
    ]);
    expect(first.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.libraryRevision).toMatch(/^library:overlay:[a-f0-9]{64}$/);
    expect(first.content).toContain("(solder_mask_margin 0)");
    expect(first.patchId).toBe(first.id);
    expect(first.revision).toBe(0);
    expect(verifyLibraryPatchGeometry(first)?.geometry).toBe("passed");
  });

  it("rejects content changed outside the declared correction", () => {
    const patch = createLibraryPatchCandidate(adoptedKnowledge());
    const verification = verifyLibraryPatchGeometry({
      ...patch,
      content: `${patch.content}\n(unapproved "change")`,
    })!;
    expect(verification.geometry).toBe("failed");
    expect(verification.failureEvidence).toMatch(/does not match declared correction/);
  });

  it("keeps the official snapshot manifest and file hashes immutable", () => {
    expect(() => {
      for (const entry of snapshotManifest.files) {
        const source = snapshotFiles[entry.path as keyof typeof snapshotFiles];
        expect(source).toBeDefined();
        expect(`sha256:${createHash("sha256").update(source!).digest("hex")}`).toBe(
          entry.contentHash,
        );
      }
    }).not.toThrow();
    expect(snapshotManifestHash()).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("retains a geometry failure and excludes it from adoption", () => {
    const patch = createLibraryPatchCandidate(adoptedKnowledge());
    const verification = verifyLibraryPatchGeometry({
      ...patch,
      operations: [{ ...patch.operations[0]!, requiredValueMm: 2 }],
    })!;
    expect(verification.geometry).toBe("failed");
    expect(adoptVerifiedLibraryPatch(patch, verification).status).toBe("rejected");
  });

  it("requires the shared approval boundary for library-wide promotion", () => {
    const patch = createLibraryPatchCandidate(adoptedKnowledge());
    expect(() => promoteLibraryPatch(patch, undefined, "2026-01-01T00:00:00.000Z")).toThrow(
      /approval/,
    );
    const promoted = promoteLibraryPatch(
      patch,
      {
        approvalId: "approval:test",
        subject: "knowledge:test",
        scope: "library-wide",
        approvedBy: "reviewer",
        approvedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      "2026-01-01T00:00:00.000Z",
    );
    expect(promoted.scope).toBe("library-wide");
  });

  it("stops on unresolved or ambiguous library revisions", () => {
    const patch = createLibraryPatchCandidate(adoptedKnowledge());
    expect(resolveLibraryRevision(officialLibraryRevision(), [])).toBeUndefined();
    expect(() => resolveLibraryRevision("library:missing", [patch])).toThrow(/unresolved/);
    expect(() =>
      resolveLibraryRevision(patch.libraryRevision, [patch, { ...patch, id: "duplicate" }]),
    ).toThrow(/ambiguous/);
    expect(
      resolveLibraryRevision(patch.libraryRevision, [{ ...patch, status: "adopted" }]),
    ).toEqual({ ...patch, status: "adopted" });
  });

  it("creates superseding patch revisions without changing the stable patch id", () => {
    const patch = createLibraryPatchCandidate(adoptedKnowledge());
    const revised = reviseLibraryPatch(patch, patch.content.replace("margin 0", "margin 0.01"));
    expect(revised.patchId).toBe(patch.patchId);
    expect(revised.id).toBe(`${patch.patchId}:r1`);
    expect(revised.previousRevisionId).toBe(patch.id);
    expect(revised.revision).toBe(1);
  });

  it("does not adopt when reopen or DRC evidence is missing", () => {
    const patch = createLibraryPatchCandidate(adoptedKnowledge());
    const verification = verifyLibraryPatchGeometry(patch)!;
    expect(
      adoptVerifiedLibraryPatch(patch, {
        ...verification,
        reopen: "blocked",
        drc: "blocked",
      }).status,
    ).toBe("rejected");
  });
});
