import type { Phase1Fixture } from "@acd/schema";
import { evaluateDesignRationale } from "./design-rationale.js";
import { electricalLintRuleIds, lintElectricalTopology } from "./electrical-lint.js";
import { GraphCoreError } from "./errors.js";
import { sortFindings, unresolvedFindings, type RuleFinding } from "./findings.js";
import { sha256 } from "./hash.js";
import { buildTestPlan } from "./test-items.js";

/** JSON Pointer operations, the same shape the patch envelope uses. */
export type FixturePatchOperation = {
  op: "add" | "remove" | "replace" | "test";
  path: string;
  value?: unknown;
};

/**
 * A repair candidate. `origin` records who proposed it; it never affects acceptance,
 * which is decided by re-running the deterministic gates on the patched fixture.
 */
export type RepairProposal = {
  proposalId: string;
  origin: "recorded-llm" | "live-llm" | "deterministic";
  targets: string[];
  rationale: string;
  operations: FixturePatchOperation[];
  provenance: { source: string; responseHash: string };
};

export type RepairProposer = {
  id: string;
  /** Called with the unresolved findings of the current fixture, in canonical order. */
  propose: (input: { fixture: Phase1Fixture; findings: RuleFinding[] }) => RepairProposal[];
};

export type RepairAttempt = {
  proposalId: string;
  origin: RepairProposal["origin"];
  accepted: boolean;
  reason: string;
  unresolvedBefore: number;
  unresolvedAfter?: number;
};

export type RepairIteration = {
  iteration: number;
  promptHash: string;
  unresolved: RuleFinding[];
  attempts: RepairAttempt[];
};

export type RepairLoopResult = {
  status: "repaired" | "already-passing" | "not-repaired";
  iterations: RepairIteration[];
  fixture: Phase1Fixture;
  appliedProposalIds: string[];
  stopReason?: string;
};

const clone = (fixture: Phase1Fixture): Phase1Fixture =>
  JSON.parse(JSON.stringify(fixture)) as Phase1Fixture;

const decode = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");

const segmentsOf = (path: string): string[] => {
  if (path === "") throw new GraphCoreError("patch-conflict", "root replacement is not supported");
  if (!path.startsWith("/"))
    throw new GraphCoreError("patch-conflict", `invalid JSON Pointer: ${path}`);
  return path.slice(1).split("/").map(decode);
};

const childOf = (container: unknown, segment: string, path: string): unknown => {
  if (Array.isArray(container)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index >= container.length) {
      throw new GraphCoreError("patch-conflict", `invalid array segment ${segment} in ${path}`);
    }
    return container[index];
  }
  if (container && typeof container === "object" && segment in container) {
    return (container as Record<string, unknown>)[segment];
  }
  throw new GraphCoreError("patch-conflict", `path not found: ${path}`);
};

const applyOperation = (fixture: Phase1Fixture, operation: FixturePatchOperation): void => {
  const segments = segmentsOf(operation.path);
  const key = segments[segments.length - 1];
  if (key === undefined) throw new GraphCoreError("patch-conflict", "missing path segment");
  let parent: unknown = fixture;
  for (const segment of segments.slice(0, -1)) {
    parent = childOf(parent, segment, operation.path);
  }
  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > parent.length) {
      throw new GraphCoreError("patch-conflict", `invalid array index in ${operation.path}`);
    }
    if (operation.op === "add") parent.splice(index, 0, operation.value);
    else if (operation.op === "remove") {
      if (index >= parent.length)
        throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
      parent.splice(index, 1);
    } else if (operation.op === "replace") {
      if (index >= parent.length)
        throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
      parent[index] = operation.value;
    } else if (sha256(parent[index]) !== sha256(operation.value)) {
      throw new GraphCoreError("patch-conflict", `test failed at ${operation.path}`);
    }
    return;
  }
  if (!parent || typeof parent !== "object") {
    throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
  }
  const record = parent as Record<string, unknown>;
  if (operation.op === "add" || operation.op === "replace") {
    if (operation.op === "replace" && !(key in record)) {
      throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
    }
    record[key] = operation.value;
  } else if (operation.op === "remove") {
    if (!(key in record))
      throw new GraphCoreError("patch-conflict", `path not found: ${operation.path}`);
    delete record[key];
  } else if (sha256(record[key]) !== sha256(operation.value)) {
    throw new GraphCoreError("patch-conflict", `test failed at ${operation.path}`);
  }
};

/** Applies operations to a copy of the fixture. Throws `patch-conflict` on any mismatch. */
export const applyFixturePatch = (
  fixture: Phase1Fixture,
  operations: readonly FixturePatchOperation[],
): Phase1Fixture => {
  const patched = clone(fixture);
  for (const operation of operations) applyOperation(patched, operation);
  return patched;
};

/**
 * A repair may change the design. It may not rewrite the recorded facts the gates judge
 * against: datasheet-sourced device characteristics, part provenance, or order-relevant
 * BOM state. Rewriting those turns a defect into a passing run without changing the board.
 */
export const inadmissibleReason = (
  fixture: Phase1Fixture,
  operations: readonly FixturePatchOperation[],
): string | undefined => {
  for (const operation of operations) {
    const segments = segmentsOf(operation.path);
    if (segments[0] === "parts" && segments[2] === "provenance") {
      return `${operation.path} rewrites part provenance`;
    }
    if (segments[0] === "bom" && segments[2] !== undefined) {
      const field = segments[2];
      if (["provenance", "availability", "lifecycle", "supplier", "sku"].includes(field)) {
        return `${operation.path} rewrites order-relevant sourcing state`;
      }
    }
    if (segments[0] === "parts" && segments[2] === "parameters" && segments[3] !== undefined) {
      const index = Number(segments[1]);
      const source = fixture.parts[index]?.parameters?.source ?? "";
      if (source.startsWith("datasheet:")) {
        return `${operation.path} rewrites a datasheet-sourced parameter (${source})`;
      }
    }
  }
  return undefined;
};

/** Findings of every deterministic Phase 2 gate that judges the typed fixture. */
export const evaluateFixtureGates = (fixture: Phase1Fixture): RuleFinding[] => {
  const lint = lintElectricalTopology(fixture);
  const rationale = evaluateDesignRationale(fixture);
  const plan = buildTestPlan(fixture, electricalLintRuleIds);
  return sortFindings([...lint.findings, ...rationale.findings, ...plan.findings]);
};

const promptHashOf = (findings: readonly RuleFinding[]): string =>
  sha256(findings.map((finding) => [finding.ruleId, finding.entity, finding.status]));

/**
 * Repair loop. A proposal is only accepted when the patch applies cleanly and the
 * deterministic gates report strictly fewer unresolved findings with no new failure,
 * so a proposal that trades one defect for another is rejected.
 */
export const runRepairLoop = (input: {
  fixture: Phase1Fixture;
  proposer: RepairProposer;
  maxIterations?: number;
}): RepairLoopResult => {
  const maxIterations = input.maxIterations ?? 4;
  const iterations: RepairIteration[] = [];
  const appliedProposalIds: string[] = [];
  let current = input.fixture;
  let unresolved = unresolvedFindings(evaluateFixtureGates(current));
  if (unresolved.length === 0) {
    return {
      status: "already-passing",
      iterations,
      fixture: current,
      appliedProposalIds,
    };
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const attempts: RepairAttempt[] = [];
    const proposals = input.proposer.propose({ fixture: current, findings: unresolved });
    const before = unresolved.length;
    let advanced = false;
    for (const proposal of proposals) {
      const inadmissible = inadmissibleReason(current, proposal.operations);
      if (inadmissible !== undefined) {
        attempts.push({
          proposalId: proposal.proposalId,
          origin: proposal.origin,
          accepted: false,
          reason: inadmissible,
          unresolvedBefore: before,
        });
        continue;
      }
      let patched: Phase1Fixture;
      try {
        patched = applyFixturePatch(current, proposal.operations);
      } catch (error) {
        attempts.push({
          proposalId: proposal.proposalId,
          origin: proposal.origin,
          accepted: false,
          reason: error instanceof Error ? error.message : "patch did not apply",
          unresolvedBefore: before,
        });
        continue;
      }
      const after = unresolvedFindings(evaluateFixtureGates(patched));
      const newFailures = after.filter(
        (finding) =>
          finding.status === "fail" &&
          !unresolved.some(
            (existing) => existing.ruleId === finding.ruleId && existing.entity === finding.entity,
          ),
      );
      const accepted = newFailures.length === 0 && after.length < before;
      attempts.push({
        proposalId: proposal.proposalId,
        origin: proposal.origin,
        accepted,
        reason: accepted
          ? "gates report fewer unresolved findings and no new failure"
          : newFailures.length > 0
            ? `introduces ${newFailures.map((finding) => finding.ruleId).join(", ")}`
            : "does not reduce unresolved findings",
        unresolvedBefore: before,
        unresolvedAfter: after.length,
      });
      if (accepted) {
        current = patched;
        unresolved = after;
        appliedProposalIds.push(proposal.proposalId);
        advanced = true;
        break;
      }
    }
    iterations.push({
      iteration,
      promptHash: promptHashOf(unresolved),
      unresolved: advanced ? [] : unresolved,
      attempts,
    });
    if (unresolved.length === 0) {
      return { status: "repaired", iterations, fixture: current, appliedProposalIds };
    }
    if (!advanced) {
      return {
        status: "not-repaired",
        iterations,
        fixture: current,
        appliedProposalIds,
        stopReason: `no accepted repair for ${unresolved.map((finding) => `${finding.ruleId}@${finding.entity}`).join(", ")}`,
      };
    }
  }
  return {
    status: "not-repaired",
    iterations,
    fixture: current,
    appliedProposalIds,
    stopReason: `convergence-failure: ${maxIterations} iterations without clearing ${unresolved.length} findings`,
  };
};

export type RecordedProposal = RepairProposal & { promptHash: string };

/**
 * Offline proposer replaying recorded proposals keyed by the hash of the unresolved
 * findings. A recording whose stored hash does not match the replayed content is
 * refused, so a silently edited recording cannot repair a design.
 */
export const recordedProposer = (recordings: readonly RecordedProposal[]): RepairProposer => ({
  id: "recorded",
  propose: ({ findings }) => {
    const promptHash = promptHashOf(findings);
    return recordings
      .filter((recording) => recording.promptHash === promptHash)
      .map((recording) => {
        const replayHash = sha256({
          targets: recording.targets,
          rationale: recording.rationale,
          operations: recording.operations,
        });
        if (replayHash !== recording.provenance.responseHash) {
          throw new GraphCoreError(
            "stale-result",
            `recorded proposal ${recording.proposalId} does not match its response hash`,
          );
        }
        return recording;
      });
  },
});

export const repairLoopEvidence = (result: RepairLoopResult): Record<string, unknown> => ({
  status: result.status,
  iterations: result.iterations.length,
  appliedProposals: result.appliedProposalIds,
  attempts: result.iterations.reduce((total, entry) => total + entry.attempts.length, 0),
  rejected: result.iterations.reduce(
    (total, entry) => total + entry.attempts.filter((attempt) => !attempt.accepted).length,
    0,
  ),
  ...(result.stopReason === undefined ? {} : { stopReason: result.stopReason }),
});
