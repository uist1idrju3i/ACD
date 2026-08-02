import { createHash } from "node:crypto";
import type { KnowledgeApproval, KnowledgeItem } from "@acd/graph-core";
import {
  assertKnowledgeLibraryWideApproval,
  GraphCoreError,
  rulesForFabProfile,
} from "@acd/graph-core";
import { parseFootprintCourtyard, parseFootprintPads, verifyLibrarySnapshot } from "./library.js";
import { snapshotManifest } from "./library-snapshot.js";

export type LibraryPatchStatus = "candidate" | "reviewed" | "adopted" | "rejected";
export type LibraryPatchScope = "project-local" | "library-wide";

export type LibraryPatchOperation = {
  kind: "set-pad-mask-clearance";
  target: string;
  requiredValueMm: number;
};

export type LibraryOverlayPatch = {
  id: string;
  type: "LibraryOverlayPatch";
  revision: number;
  libraryRevision: string;
  snapshotManifestHash: string;
  footprintId: string;
  sourceKnowledgeId: string;
  sourceEventIds: string[];
  operations: LibraryPatchOperation[];
  content: string;
  contentHash: string;
  status: LibraryPatchStatus;
  scope: LibraryPatchScope;
  failureReason?: string;
  approvalId?: string;
  verification?: {
    geometry: "passed" | "failed";
    reopen: "passed" | "failed" | "blocked";
    drc: "passed" | "failed" | "blocked";
    inputHash: string;
    failureEvidence?: string;
  };
};

const hash = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

export const snapshotManifestHash = (): string => hash(snapshotManifest);

const conditionValue = (item: KnowledgeItem, field: string): string | undefined =>
  item.appliesWhen.find((condition) => condition.field === field)?.value;

const snapshotFootprintName = (value: string): string => {
  const withoutPrefix = value.startsWith("footprint:") ? value.slice("footprint:".length) : value;
  return withoutPrefix.includes(":")
    ? withoutPrefix.slice(withoutPrefix.lastIndexOf(":") + 1)
    : withoutPrefix;
};

const ruleForKnowledge = (item: KnowledgeItem) => {
  const profileId = conditionValue(item, "fabProfileId");
  const ruleId = conditionValue(item, "ruleId");
  if (!profileId || !ruleId) {
    throw new GraphCoreError("schema-invalid", `knowledge item lacks fab profile/rule: ${item.id}`);
  }
  const profile = rulesForFabProfile(profileId);
  const rule = profile?.rules.find((candidate) => candidate.ruleId === ruleId);
  if (!profile || !rule) {
    throw new GraphCoreError("schema-invalid", `unknown fab profile rule: ${profileId}/${ruleId}`);
  }
  if (!rule.correction) {
    throw new GraphCoreError(
      "schema-invalid",
      `fab profile rule has no declared correction: ${profileId}/${ruleId}`,
    );
  }
  return rule;
};

export const createLibraryPatchCandidate = (knowledgeItem: KnowledgeItem): LibraryOverlayPatch => {
  if (knowledgeItem.status !== "reviewed" && knowledgeItem.status !== "adopted") {
    throw new GraphCoreError(
      "verification-failed",
      `library patch requires reviewed or adopted knowledge: ${knowledgeItem.id}`,
    );
  }
  const footprintCondition = conditionValue(knowledgeItem, "footprintId");
  if (!footprintCondition) {
    throw new GraphCoreError(
      "schema-invalid",
      `knowledge item lacks footprint: ${knowledgeItem.id}`,
    );
  }
  const footprintId = snapshotFootprintName(footprintCondition);
  const rule = ruleForKnowledge(knowledgeItem);
  const operation: LibraryPatchOperation = {
    kind: "set-pad-mask-clearance",
    target: rule.correction!.target,
    requiredValueMm: rule.correction!.requiredValueMm,
  };
  const content = JSON.stringify({ footprintId, operation });
  const manifestHash = snapshotManifestHash();
  const patchIdentity = {
    base: manifestHash,
    footprintId,
    sourceKnowledgeId: knowledgeItem.knowledgeId,
    sourceEventIds: [...knowledgeItem.sourceEventIds].sort(),
    operation,
  };
  const libraryRevision = `library:overlay:${hash(patchIdentity).slice("sha256:".length)}`;
  return {
    id: `library-patch:${knowledgeItem.knowledgeId}`,
    type: "LibraryOverlayPatch",
    revision: 0,
    libraryRevision,
    snapshotManifestHash: manifestHash,
    footprintId,
    sourceKnowledgeId: knowledgeItem.knowledgeId,
    sourceEventIds: [...knowledgeItem.sourceEventIds].sort(),
    operations: [operation],
    content,
    contentHash: hash(content),
    status: "candidate",
    scope: "project-local",
  };
};

export const verifyLibraryPatchGeometry = (
  patch: LibraryOverlayPatch,
): LibraryOverlayPatch["verification"] => {
  const inputHash = hash({
    snapshotManifestHash: patch.snapshotManifestHash,
    footprintId: patch.footprintId,
    operations: patch.operations,
  });
  try {
    verifyLibrarySnapshot();
    const pads = parseFootprintPads(patch.footprintId);
    const courtyard = parseFootprintCourtyard(patch.footprintId);
    if (!courtyard || courtyard.minX >= courtyard.maxX || courtyard.minY >= courtyard.maxY) {
      throw new Error("footprint has no valid courtyard");
    }
    for (const pad of pads) {
      if (pad.width <= 0 || pad.height <= 0) throw new Error(`invalid pad geometry: ${pad.number}`);
      if (pad.type === "thru_hole" && (!pad.drill || pad.drill <= 0)) {
        throw new Error(`invalid drill geometry: ${pad.number}`);
      }
    }
    for (const operation of patch.operations) {
      if (operation.requiredValueMm <= 0) throw new Error("mask clearance must be positive");
      if (
        operation.requiredValueMm >= Math.min(...pads.map((pad) => Math.min(pad.width, pad.height)))
      ) {
        throw new Error("mask clearance exceeds pad geometry");
      }
    }
    return { geometry: "passed", reopen: "blocked", drc: "blocked", inputHash };
  } catch (error) {
    return {
      geometry: "failed",
      reopen: "blocked",
      drc: "blocked",
      inputHash,
      failureEvidence: error instanceof Error ? error.message : String(error),
    };
  }
};

export const adoptVerifiedLibraryPatch = (
  patch: LibraryOverlayPatch,
  verification: NonNullable<LibraryOverlayPatch["verification"]>,
): LibraryOverlayPatch => {
  if (
    verification.geometry !== "passed" ||
    verification.reopen !== "passed" ||
    verification.drc !== "passed"
  ) {
    return {
      ...patch,
      status: "rejected",
      failureReason: "patch verification did not pass geometry, reopen, and DRC",
      verification,
    };
  }
  return { ...patch, status: "adopted", verification };
};

export const promoteLibraryPatch = (
  patch: LibraryOverlayPatch,
  approval: KnowledgeApproval | undefined,
  now: string,
): LibraryOverlayPatch => {
  assertKnowledgeLibraryWideApproval(patch.sourceKnowledgeId, approval, now);
  return { ...patch, scope: "library-wide", approvalId: approval!.approvalId };
};

export const resolveLibraryRevision = (
  requestedRevision: string,
  patches: LibraryOverlayPatch[],
): LibraryOverlayPatch | undefined => {
  const matches = patches.filter((patch) => patch.libraryRevision === requestedRevision);
  if (matches.length > 1) {
    throw new GraphCoreError(
      "verification-failed",
      `ambiguous library revision: ${requestedRevision}`,
    );
  }
  if (matches.length === 0) {
    throw new GraphCoreError(
      "verification-failed",
      `unresolved library revision: ${requestedRevision}`,
    );
  }
  const patch = matches[0]!;
  if (patch.status !== "adopted") {
    throw new GraphCoreError(
      "verification-failed",
      `library revision is not adopted: ${requestedRevision}`,
    );
  }
  return patch;
};
