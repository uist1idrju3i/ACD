import { createHash } from "node:crypto";
import type { KnowledgeApproval, KnowledgeItem } from "@acd/graph-core";
import {
  assertKnowledgeLibraryWideApproval,
  GraphCoreError,
  rulesForFabProfile,
} from "@acd/graph-core";
import { parseFootprintCourtyard, parseFootprintPads, verifyLibrarySnapshot } from "./library.js";
import { snapshotFiles, snapshotManifest } from "./library-snapshot.js";

export type LibraryPatchStatus = "candidate" | "reviewed" | "adopted" | "rejected";
export type LibraryPatchScope = "project-local" | "library-wide";

export type LibraryPatchOperation = {
  kind: "set-pad-mask-clearance";
  target: string;
  requiredValueMm: number;
  padNumber?: string;
};

export type LibraryOverlayPatch = {
  id: string;
  type: "LibraryOverlayPatch";
  patchId: string;
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
  previousRevisionId?: string;
  materializedContentHash?: string;
  verification?: {
    geometry: "passed" | "failed";
    reopen: "passed" | "failed" | "blocked";
    drc: "passed" | "failed" | "blocked";
    inputHash: string;
    boardInputHash?: string;
    failureEvidence?: string;
  };
};

const hash = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const hashText = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const snapshotManifestHash = (): string => hash(snapshotManifest);
export const officialLibraryRevision = (): string =>
  `library:official:${snapshotManifestHash().slice("sha256:".length)}`;

const conditionValue = (item: KnowledgeItem, field: string): string | undefined =>
  item.appliesWhen.find((condition) => condition.field === field)?.value;

const snapshotFootprintName = (value: string): string => {
  const withoutPrefix = value.startsWith("footprint:") ? value.slice("footprint:".length) : value;
  return withoutPrefix.includes(":")
    ? withoutPrefix.slice(withoutPrefix.lastIndexOf(":") + 1)
    : withoutPrefix;
};

const sourceForFootprint = (footprintId: string): string => {
  const entry = snapshotManifest.files.find(
    (candidate) => candidate.kind === "footprint" && candidate.id === footprintId,
  );
  if (!entry)
    throw new GraphCoreError("reference-integrity", `unknown snapshot footprint: ${footprintId}`);
  const source = snapshotFiles[entry.path as keyof typeof snapshotFiles];
  if (!source)
    throw new GraphCoreError("reference-integrity", `missing snapshot footprint: ${entry.path}`);
  return source;
};

const blockAt = (text: string, start: number): string => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new GraphCoreError("schema-invalid", "unbalanced footprint source");
};

export const materializeLibraryPatchContent = (
  footprintId: string,
  operations: LibraryPatchOperation[],
): string => {
  let source = sourceForFootprint(footprintId);
  for (const operation of operations) {
    if (operation.kind !== "set-pad-mask-clearance" || operation.target !== "pad-mask-clearance") {
      throw new GraphCoreError(
        "schema-invalid",
        `unsupported library patch operation: ${operation.kind}`,
      );
    }
    if (!Number.isFinite(operation.requiredValueMm)) {
      throw new GraphCoreError("schema-invalid", "mask clearance must be finite");
    }
    let cursor = 0;
    let output = "";
    while (true) {
      const start = source.indexOf('(pad "', cursor);
      if (start < 0) {
        output += source.slice(cursor);
        break;
      }
      const block = blockAt(source, start);
      const padNumber = block.trimStart().match(/^\(pad "([^"]+)"/)?.[1];
      output += source.slice(cursor, start);
      if (/\(solder_mask_margin\s/.test(block)) {
        throw new GraphCoreError("schema-invalid", "official footprint already has mask margin");
      }
      output +=
        !operation.padNumber || operation.padNumber === padNumber
          ? `${block.slice(0, -1)}\n\t\t(solder_mask_margin ${operation.requiredValueMm})\n\t)`
          : block;
      cursor = start + block.length;
    }
    source = output;
  }
  return source;
};

export const materializeLibraryPatchInBoardSource = (
  boardSource: string,
  footprintId: string,
  operations: LibraryPatchOperation[],
): string => {
  let source = boardSource;
  for (const operation of operations) {
    if (operation.kind !== "set-pad-mask-clearance" || operation.target !== "pad-mask-clearance") {
      throw new GraphCoreError(
        "schema-invalid",
        `unsupported library patch operation: ${operation.kind}`,
      );
    }
    let cursor = 0;
    let output = "";
    let applied = false;
    while (true) {
      const start = source.indexOf('(footprint "', cursor);
      if (start < 0) {
        output += source.slice(cursor);
        break;
      }
      const block = blockAt(source, start);
      output += source.slice(cursor, start);
      if (!applied && block.startsWith(`(footprint "${footprintId}"`)) {
        applied = true;
        const marker = `(property "ACD_LibraryOverlay" "pad-mask-clearance=${operation.requiredValueMm}" (at 0 0 0) (layer "F.Fab") hide (effects (font (size 1 1) (thickness 0.15))))`;
        output += `${block.slice(0, -1)}\n\t${marker}\n)`;
      } else {
        output += block;
      }
      cursor = start + block.length;
    }
    source = output;
  }
  return source;
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
    ...(rule.correction!.padNumber ? { padNumber: rule.correction!.padNumber } : {}),
  };
  const content = materializeLibraryPatchContent(footprintId, [operation]);
  const manifestHash = snapshotManifestHash();
  const patchIdentity = {
    base: manifestHash,
    footprintId,
    sourceKnowledgeId: knowledgeItem.knowledgeId,
    sourceEventIds: [...knowledgeItem.sourceEventIds].sort(),
    operation,
    contentHash: hashText(content),
  };
  const libraryRevision = `library:overlay:${hash(patchIdentity).slice("sha256:".length)}`;
  const patchId = `library-patch:${knowledgeItem.knowledgeId}`;
  return {
    id: patchId,
    type: "LibraryOverlayPatch",
    patchId,
    revision: 0,
    libraryRevision,
    snapshotManifestHash: manifestHash,
    footprintId,
    sourceKnowledgeId: knowledgeItem.knowledgeId,
    sourceEventIds: [...knowledgeItem.sourceEventIds].sort(),
    operations: [operation],
    content,
    contentHash: hashText(content),
    materializedContentHash: hashText(content),
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
    const officialContent = sourceForFootprint(patch.footprintId);
    const expectedContent = materializeLibraryPatchContent(patch.footprintId, patch.operations);
    if (patch.content !== expectedContent || patch.contentHash !== hashText(patch.content)) {
      throw new Error("materialized patch content does not match declared correction");
    }
    const officialPads = parseFootprintPads(patch.footprintId);
    const pads = parseFootprintPads(patch.footprintId, patch.content);
    if (officialContent === patch.content)
      throw new Error("patch did not change footprint content");
    if (officialPads.some((pad) => pad.solderMaskMargin !== undefined)) {
      throw new Error("official footprint unexpectedly contains a mask margin");
    }
    const officialCourtyard = parseFootprintCourtyard(patch.footprintId, officialContent);
    const courtyard = parseFootprintCourtyard(patch.footprintId, patch.content);
    if (!courtyard || courtyard.minX >= courtyard.maxX || courtyard.minY >= courtyard.maxY) {
      throw new Error("footprint has no valid courtyard");
    }
    if (JSON.stringify(courtyard) !== JSON.stringify(officialCourtyard)) {
      throw new Error("patch changed courtyard geometry");
    }
    for (const pad of pads) {
      if (pad.width <= 0 || pad.height <= 0) throw new Error(`invalid pad geometry: ${pad.number}`);
      if (pad.type === "thru_hole" && (!pad.drill || pad.drill <= 0)) {
        throw new Error(`invalid drill geometry: ${pad.number}`);
      }
    }
    for (const operation of patch.operations) {
      if (!Number.isFinite(operation.requiredValueMm))
        throw new Error("mask clearance must be finite");
      if (
        Math.abs(operation.requiredValueMm) >=
        Math.min(...pads.map((pad) => Math.min(pad.width, pad.height)))
      ) {
        throw new Error("mask clearance exceeds pad geometry");
      }
      const targetPads = operation.padNumber
        ? pads.filter((pad) => pad.number === operation.padNumber)
        : pads;
      if (
        targetPads.length === 0 ||
        targetPads.some(
          (pad) => pad.type === "smd" && pad.solderMaskMargin !== operation.requiredValueMm,
        )
      ) {
        throw new Error("materialized correction is missing from a pad");
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

export const reviseLibraryPatch = (
  patch: LibraryOverlayPatch,
  content: string,
): LibraryOverlayPatch => {
  if (content === patch.content) {
    throw new GraphCoreError(
      "schema-invalid",
      `library patch revision does not change content: ${patch.id}`,
    );
  }
  const revision = patch.revision + 1;
  const id = `${patch.patchId}:r${revision}`;
  const base = { ...patch };
  delete base.verification;
  delete base.failureReason;
  return {
    ...base,
    id,
    revision,
    content,
    contentHash: hashText(content),
    materializedContentHash: hashText(content),
    libraryRevision: `library:overlay:${hash({ patchId: patch.patchId, revision, contentHash: hashText(content) }).slice("sha256:".length)}`,
    previousRevisionId: patch.id,
    status: "candidate",
  };
};

export const resolveLibraryRevision = (
  requestedRevision: string,
  patches: LibraryOverlayPatch[],
  allowUnadopted = false,
): LibraryOverlayPatch | undefined => {
  if (requestedRevision === officialLibraryRevision()) return undefined;
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
  if (!allowUnadopted && patch.status !== "adopted") {
    throw new GraphCoreError(
      "verification-failed",
      `library revision is not adopted: ${requestedRevision}`,
    );
  }
  return patch;
};
