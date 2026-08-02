/**
 * Three-valued rule evaluation shared by the deterministic Phase 2 gates.
 * See docs/adr/0011-three-valued-rule-evaluation-and-validity-domain.md:
 * an unknown widens verification and never counts as a pass.
 */
export type RuleStatus = "pass" | "fail" | "unknown";
export type RuleVerdict = "pass" | "fail" | "blocked";

export type RuleFinding = {
  ruleId: string;
  status: RuleStatus;
  entity: string;
  expected: string;
  observed: string;
  basis: string;
};

export const sortFindings = (findings: RuleFinding[]): RuleFinding[] =>
  [...findings].sort(
    (left, right) =>
      left.ruleId.localeCompare(right.ruleId) || left.entity.localeCompare(right.entity),
  );

export const aggregateVerdict = (findings: readonly RuleFinding[]): RuleVerdict =>
  findings.some((finding) => finding.status === "fail")
    ? "fail"
    : findings.some((finding) => finding.status === "unknown")
      ? "blocked"
      : "pass";

export const unresolvedFindings = (findings: readonly RuleFinding[]): RuleFinding[] =>
  findings.filter((finding) => finding.status !== "pass");
