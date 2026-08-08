import { GraphCoreError } from "./errors.js";

export type ProgressObservation = {
  inputHash: string;
  proposalHash: string;
  artifactHash: string;
  gateResultHash: string;
  unresolvedFindingCount: number;
  gateStatus: "unknown" | "blocked" | "failed" | "passed";
  stateHash: string;
};

export type NoProgressThresholds = {
  repeatedProposal: number;
  unchangedArtifact: number;
  unchangedGate: number;
  oscillation: number;
};

export const defaultNoProgressThresholds: NoProgressThresholds = {
  repeatedProposal: 2,
  unchangedArtifact: 2,
  unchangedGate: 2,
  oscillation: 2,
};

export type NoProgressReason =
  | "repeated-proposal"
  | "unchanged-artifact"
  | "unchanged-gate"
  | "oscillation";

const tailRepeatCount = (
  observations: readonly ProgressObservation[],
  same: (previous: ProgressObservation, current: ProgressObservation) => boolean,
): number => {
  const last = observations.at(-1);
  if (!last) return 0;
  let count = 1;
  for (let index = observations.length - 2; index >= 0; index -= 1) {
    const current = observations[index];
    if (!current || !same(current, last)) break;
    count += 1;
  }
  return count;
};

const gateRank: Record<ProgressObservation["gateStatus"], number> = {
  unknown: 0,
  blocked: 0,
  failed: 0,
  passed: 1,
};

const hasImprovement = (previous: ProgressObservation, current: ProgressObservation): boolean =>
  current.unresolvedFindingCount < previous.unresolvedFindingCount ||
  gateRank[current.gateStatus] > gateRank[previous.gateStatus] ||
  current.artifactHash !== previous.artifactHash;

const noGateImprovementCount = (observations: readonly ProgressObservation[]): number => {
  let count = 0;
  for (let index = observations.length - 1; index > 0; index -= 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    if (!previous || !current || hasImprovement(previous, current)) break;
    count += 1;
  }
  return count + (observations.length > 0 ? 1 : 0);
};

export const detectNoProgress = (
  observations: readonly ProgressObservation[],
  thresholds: NoProgressThresholds = defaultNoProgressThresholds,
): NoProgressReason[] => {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isInteger(value) || value < 2) {
      throw new GraphCoreError("schema-invalid", `${name} threshold must be an integer >= 2`);
    }
  }
  if (observations.length === 0) return [];
  const reasons: NoProgressReason[] = [];
  if (
    tailRepeatCount(
      observations,
      (previous, current) =>
        previous.inputHash === current.inputHash && previous.proposalHash === current.proposalHash,
    ) >= thresholds.repeatedProposal
  ) {
    reasons.push("repeated-proposal");
  }
  if (
    tailRepeatCount(
      observations,
      (previous, current) => previous.artifactHash === current.artifactHash,
    ) >= thresholds.unchangedArtifact
  ) {
    reasons.push("unchanged-artifact");
  }
  if (
    tailRepeatCount(
      observations,
      (previous, current) => previous.gateResultHash === current.gateResultHash,
    ) >= thresholds.unchangedGate ||
    noGateImprovementCount(observations) >= thresholds.unchangedGate
  ) {
    reasons.push("unchanged-gate");
  }
  const last = observations.at(-1);
  const prior = observations
    .slice(0, -1)
    .map((observation) => observation.stateHash)
    .filter((stateHash) => stateHash === last?.stateHash).length;
  if (last && prior >= thresholds.oscillation - 1) reasons.push("oscillation");
  return reasons;
};
