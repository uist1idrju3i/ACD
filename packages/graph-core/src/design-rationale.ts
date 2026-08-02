import type { Phase1Fixture } from "@acd/schema";
import {
  aggregateVerdict,
  sortFindings,
  unresolvedFindings,
  type RuleFinding,
  type RuleVerdict,
} from "./findings.js";

export type RationaleReport = {
  verdict: RuleVerdict;
  rulesEvaluated: string[];
  findings: RuleFinding[];
  /** Subjects a downstream step may quote, in stable order. Never pass evidence by itself. */
  coverage: { subject: string; rationaleIds: string[] }[];
};

type Fixture = Phase1Fixture;
type Rationale = NonNullable<Fixture["rationales"]>[number];

const blockSubject = (block: string): string => `block:${block}`;

/**
 * Subjects that must not reach a downstream step without a recorded decision:
 * the requirement, every functional block it names, and every selected part.
 */
export const rationaleSubjects = (fixture: Fixture): string[] => [
  fixture.requirement.id,
  ...fixture.requirement.functionalBlocks.map(blockSubject),
  ...fixture.parts.map((part) => part.id),
];

const rationales = (fixture: Fixture): Rationale[] => fixture.rationales ?? [];

const coverageOf = (fixture: Fixture): RationaleReport["coverage"] =>
  rationaleSubjects(fixture).map((subject) => ({
    subject,
    rationaleIds: rationales(fixture)
      .filter((rationale) => rationale.appliesTo.includes(subject))
      .map((rationale) => rationale.id),
  }));

const coverage = (fixture: Fixture): RuleFinding[] =>
  coverageOf(fixture).map((entry) => ({
    ruleId: "rationale-coverage",
    status: entry.rationaleIds.length > 0 ? ("pass" as const) : ("fail" as const),
    entity: entry.subject,
    expected: "at least one rationale applies to the subject",
    observed:
      entry.rationaleIds.length > 0 ? entry.rationaleIds.join(", ") : "no rationale applies",
    basis: "requirement functional decomposition and selected parts",
  }));

const referenceIntegrity = (fixture: Fixture): RuleFinding[] => {
  const subjects = new Set(rationaleSubjects(fixture));
  return rationales(fixture).map((rationale) => {
    const dangling = rationale.appliesTo.filter((subject) => !subjects.has(subject));
    return {
      ruleId: "rationale-reference-integrity",
      status: dangling.length === 0 ? ("pass" as const) : ("fail" as const),
      entity: rationale.id,
      expected: "appliesTo names the requirement, a block:<functional block>, or a part id",
      observed: dangling.length === 0 ? "all subjects resolve" : `unknown: ${dangling.join(", ")}`,
      basis: "fixture requirement and parts",
    };
  });
};

/**
 * An unconfirmed assumption must carry the verification that would confirm it.
 * Without one it stays unknown, which blocks the gate instead of passing.
 */
const assumptionsVerifiable = (fixture: Fixture): RuleFinding[] =>
  rationales(fixture).flatMap((rationale) =>
    rationale.assumptions.map((assumption, index) => {
      const entity = `${rationale.id}:assumption-${index + 1}`;
      const basis = "recorded assumption status";
      if (assumption.status === "confirmed") {
        return assumption.evidenceLink === undefined
          ? {
              ruleId: "rationale-assumption-verifiable",
              status: "unknown" as const,
              entity,
              expected: "a confirmed assumption cites the evidence that confirmed it",
              observed: "evidenceLink is absent",
              basis,
            }
          : {
              ruleId: "rationale-assumption-verifiable",
              status: "pass" as const,
              entity,
              expected: "a confirmed assumption cites the evidence that confirmed it",
              observed: assumption.evidenceLink,
              basis,
            };
      }
      const planned = assumption.testItemId !== undefined || rationale.tuningNeeded;
      return {
        ruleId: "rationale-assumption-verifiable",
        status: planned ? ("pass" as const) : ("unknown" as const),
        entity,
        expected: "an unconfirmed assumption names a test item or marks tuningNeeded",
        observed: planned
          ? (assumption.testItemId ?? "tuningNeeded is true")
          : "no test item and tuningNeeded is false",
        basis,
      };
    }),
  );

/**
 * A rationale explains a decision; it is never the evidence that a gate passed.
 * Quoting a rationale id as evidence is rejected regardless of who authored it.
 */
const notEvidence = (fixture: Fixture): RuleFinding[] => {
  const cited = (rationale: Rationale): string[] => [
    ...(rationale.evidenceLinks ?? []),
    ...rationale.assumptions.flatMap((assumption) =>
      assumption.evidenceLink === undefined ? [] : [assumption.evidenceLink],
    ),
  ];
  return rationales(fixture).map((rationale) => {
    // The namespace decides, not resolvability: an unresolvable `rationale:` link is still
    // a rationale quoted as evidence.
    const offending = cited(rationale).filter((link) => link.startsWith("rationale:"));
    return {
      ruleId: "rationale-not-evidence",
      status: offending.length === 0 ? ("pass" as const) : ("fail" as const),
      entity: rationale.id,
      expected: "evidence links reference gate or measurement evidence, never a rationale",
      observed: offending.length === 0 ? "no rationale is cited as evidence" : offending.join(", "),
      basis: "AI may propose; deterministic gates decide",
    };
  });
};

export const designRationaleRuleIds: readonly string[] = [
  "rationale-assumption-verifiable",
  "rationale-coverage",
  "rationale-not-evidence",
  "rationale-reference-integrity",
];

export const evaluateDesignRationale = (fixture: Fixture): RationaleReport => {
  const findings = sortFindings([
    ...coverage(fixture),
    ...referenceIntegrity(fixture),
    ...assumptionsVerifiable(fixture),
    ...notEvidence(fixture),
  ]);
  return {
    verdict: aggregateVerdict(findings),
    rulesEvaluated: [...designRationaleRuleIds],
    findings,
    coverage: coverageOf(fixture),
  };
};

export const unresolvedRationaleFindings = (report: RationaleReport): RuleFinding[] =>
  unresolvedFindings(report.findings);
