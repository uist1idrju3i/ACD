import type { Phase1Fixture } from "@acd/schema";
import { ledBranchCurrents } from "./electrical-lint.js";
import {
  aggregateVerdict,
  sortFindings,
  unresolvedFindings,
  type RuleFinding,
  type RuleVerdict,
} from "./findings.js";

/** How a test item is verified. Analysis and simulation close inside the pipeline. */
export type TestMethod = "inspection" | "analysis" | "measurement";

export type TestItem = {
  id: string;
  title: string;
  subject: string;
  method: TestMethod;
  conditions: string;
  /** Numeric acceptance band, or a stated criterion when the item is not numeric. */
  expected: string;
  /** Gate that decides this item. Measurement items belong to the physical completion gate. */
  verifiedBy: string;
  /** Requirement criteria, rule ids, rationale ids or part ids the item was generated from. */
  sources: string[];
};

export type TestPlan = {
  verdict: RuleVerdict;
  rulesEvaluated: string[];
  items: TestItem[];
  findings: RuleFinding[];
};

type Fixture = Phase1Fixture;
type Rationale = NonNullable<Fixture["rationales"]>[number];

const electricalLintGate = "gate:electrical-lint";
const physicalGate = "gate:physical-completion";

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

const band = (nominal: number, ratio: number, unit: string): string =>
  `${(nominal * (1 - ratio)).toFixed(3)}-${(nominal * (1 + ratio)).toFixed(3)} ${unit}`;

const rationales = (fixture: Fixture): Rationale[] => fixture.rationales ?? [];

const declaredVerification = (fixture: Fixture, index: number): string | undefined =>
  fixture.requirement.acceptanceVerifiedBy?.[index];

/**
 * An acceptance criterion becomes an inspection item only when the requirement declares the
 * gate that decides it. Generating an item for every criterion would let the plan prove its
 * own coverage.
 */
const fromAcceptanceCriteria = (fixture: Fixture): TestItem[] =>
  fixture.requirement.acceptanceCriteria.flatMap((criterion, index) => {
    const verifiedBy = declaredVerification(fixture, index);
    if (verifiedBy === undefined || !verifiedBy.startsWith("gate:")) return [];
    return [
      {
        id: `test:acceptance-${index + 1}-${slug(criterion)}`,
        title: criterion,
        subject: fixture.requirement.id,
        method: "inspection" as const,
        conditions: "golden run artifacts and gate results of the recorded revision",
        expected: "the criterion holds for the run under review",
        verifiedBy,
        sources: [`requirement:acceptanceCriteria[${index}]`],
      },
    ];
  });

const fromSupplyBudget = (fixture: Fixture): TestItem[] => [
  {
    id: "test:supply-current-budget",
    title: "Total supply current stays inside the requirement budget",
    subject: fixture.requirement.id,
    method: "measurement" as const,
    conditions: `${fixture.requirement.electrical.supplyVoltageV} V supply, board active with all functional blocks powered`,
    expected: `<= ${fixture.requirement.electrical.maxCurrentMa} mA`,
    verifiedBy: physicalGate,
    sources: ["requirement:electrical.maxCurrentMa"],
  },
];

/** Declared net voltages are checked by the lint and measured on the assembled board. */
const fromNetVoltages = (fixture: Fixture): TestItem[] =>
  fixture.nets
    .filter((net) => net.nominalVoltageV !== undefined)
    .map((net) => ({
      id: `test:net-voltage-${slug(net.name)}`,
      title: `${net.name} rail voltage`,
      subject: net.id,
      method: "measurement" as const,
      conditions: "board powered from USB-C, no external load",
      expected: band(net.nominalVoltageV ?? 0, 0.05, "V"),
      verifiedBy: physicalGate,
      sources: [net.id, "rule:power-net-voltage-declared"],
    }));

/** LED series current is a numeric decision, so it becomes a numeric measurement. */
const fromLeds = (fixture: Fixture): TestItem[] =>
  ledBranchCurrents(fixture).map((branch) => ({
    id: `test:led-current-${slug(branch.reference)}`,
    title: `${branch.reference} forward current`,
    subject: branch.partId,
    method: "measurement" as const,
    conditions:
      branch.driveVoltageV === undefined
        ? "LED driven continuously at room temperature"
        : `${branch.driveVoltageV} V drive, LED on continuously at room temperature`,
    expected:
      branch.currentMa === undefined || branch.minMa === undefined || branch.maxMa === undefined
        ? "unknown: LED parameters, drive voltage or series resistance are not declared"
        : `${band(branch.currentMa, 0.2, "mA")} and inside the ${branch.minMa}-${branch.maxMa} mA rating`,
    verifiedBy: physicalGate,
    sources: [branch.partId, ...branch.seriesResistorRefs, "rule:led-series-current"],
  }));

const fromRegulators = (fixture: Fixture): TestItem[] =>
  fixture.parts
    .filter((part) => part.kind === "regulator")
    .map((regulator) => {
      const output = regulator.parameters?.outputVoltageV;
      return {
        id: `test:regulator-output-${slug(regulator.reference)}`,
        title: `${regulator.reference} output voltage under load`,
        subject: regulator.id,
        method: "measurement" as const,
        conditions: "input at the nominal supply voltage, output loaded with the board",
        expected:
          output === undefined
            ? "unknown: output voltage is not declared"
            : band(output, 0.03, "V"),
        verifiedBy: physicalGate,
        sources: [regulator.id, "rule:regulator-bulk-capacitance"],
      };
    });

/** Topology decisions the lint already decides stay in the plan as analysis items. */
const fromLintRules = (fixture: Fixture, ruleIds: readonly string[]): TestItem[] =>
  ruleIds.map((ruleId) => ({
    id: `test:lint-${slug(ruleId)}`,
    title: `Topology rule ${ruleId} holds for the design`,
    subject: fixture.fixtureId,
    method: "analysis" as const,
    conditions: "typed fixture of the recorded revision",
    expected: "no fail and no unknown finding for the rule",
    verifiedBy: electricalLintGate,
    sources: [`rule:${ruleId}`],
  }));

/** An unconfirmed assumption becomes the measurement that would confirm it. */
const fromRationales = (fixture: Fixture): TestItem[] =>
  rationales(fixture).flatMap((rationale) =>
    rationale.assumptions
      // The index is taken over all assumptions so confirming one does not renumber the rest.
      .map((assumption, index) => ({ assumption, index }))
      .filter(({ assumption }) => assumption.status === "unconfirmed")
      .map(({ assumption, index }) => ({
        id:
          assumption.testItemId ??
          `test:${slug(rationale.id.replace("rationale:", ""))}-${index + 1}`,
        title: assumption.statement,
        subject: rationale.appliesTo[0] ?? fixture.requirement.id,
        method: "measurement" as const,
        conditions: rationale.tuningNeeded
          ? "assembled board, tuning permitted before acceptance"
          : "assembled board in the nominal operating condition",
        expected: "the assumption holds, or the design decision is revised",
        verifiedBy: physicalGate,
        sources: [rationale.id],
      })),
  );

const byId = (items: TestItem[]): TestItem[] =>
  [...items].sort((left, right) => left.id.localeCompare(right.id));

export const generateTestItems = (fixture: Fixture, lintRuleIds: readonly string[]): TestItem[] =>
  byId([
    ...fromAcceptanceCriteria(fixture),
    ...fromSupplyBudget(fixture),
    ...fromNetVoltages(fixture),
    ...fromLeds(fixture),
    ...fromRegulators(fixture),
    ...fromLintRules(fixture, lintRuleIds),
    ...fromRationales(fixture),
  ]);

/**
 * Coverage is decided by the declared verification, not by the item this module generates
 * from the criterion, so the plan cannot certify itself.
 */
const requirementCoverage = (
  fixture: Fixture,
  items: TestItem[],
  gateIds: readonly string[],
): RuleFinding[] =>
  fixture.requirement.acceptanceCriteria.map((criterion, index) => {
    const source = `requirement:acceptanceCriteria[${index}]`;
    const declared = declaredVerification(fixture, index);
    const resolved =
      declared === undefined
        ? undefined
        : declared.startsWith("gate:")
          ? gateIds.includes(declared)
          : items.some((item) => item.id === declared);
    return {
      ruleId: "test-item-requirement-coverage",
      status: declared === undefined ? ("unknown" as const) : resolved ? ("pass" as const) : "fail",
      entity: source,
      expected: "the acceptance criterion declares a gate or test item that decides it",
      observed:
        declared === undefined
          ? "no verification method is declared for the criterion"
          : resolved
            ? declared
            : `${declared} is not a contracted gate or a generated test item`,
      basis: criterion,
    };
  });

/**
 * An open assumption must have a test item that would close it; a confirmed one must name the
 * evidence that closed it. A rationale is never that evidence.
 */
const assumptionCoverage = (fixture: Fixture, items: TestItem[]): RuleFinding[] => {
  const generated = new Set(items.map((item) => item.id));
  return rationales(fixture).flatMap((rationale) =>
    rationale.assumptions.map((assumption) => {
      const unconfirmed = assumption.status === "unconfirmed";
      const evidence = assumption.evidenceLink;
      const covered = unconfirmed
        ? assumption.testItemId !== undefined && generated.has(assumption.testItemId)
        : evidence !== undefined && !evidence.startsWith("rationale:");
      return {
        // A generated id nobody references cannot close an assumption, so the rationale has to
        // name the item; an id that is named but not generated is a broken link.
        ruleId: "test-item-assumption-coverage",
        status: covered ? ("pass" as const) : ("unknown" as const),
        entity: assumption.testItemId ?? assumption.statement,
        expected: unconfirmed
          ? "the open assumption names a test item that the plan generates"
          : "the confirmed assumption names evidence outside the rationale set",
        observed: covered
          ? (evidence ?? "generated")
          : unconfirmed
            ? "no generated test item is named for the open assumption"
            : "confirmed without recorded evidence",
        basis: rationale.id,
      };
    }),
  );
};

/** An item whose acceptance band could not be derived is unknown, never a pass. */
const completeness = (items: TestItem[]): RuleFinding[] =>
  items.map((item) => ({
    ruleId: "test-item-completeness",
    status: item.expected.startsWith("unknown:") ? ("unknown" as const) : ("pass" as const),
    entity: item.id,
    expected: "method, conditions and an acceptance criterion are resolved",
    observed: item.expected,
    basis: item.sources.join(", "),
  }));

const uniqueIds = (items: TestItem[]): RuleFinding[] => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({
    ruleId: "test-item-unique-id",
    status: count === 1 ? ("pass" as const) : ("fail" as const),
    entity: id,
    expected: "one test item per id",
    observed: `${count} items`,
    basis: "generated test plan",
  }));
};

export const testPlanRuleIds: readonly string[] = [
  "test-item-assumption-coverage",
  "test-item-completeness",
  "test-item-requirement-coverage",
  "test-item-unique-id",
];

export const buildTestPlan = (
  fixture: Fixture,
  lintRuleIds: readonly string[],
  gateIds: readonly string[],
): TestPlan => {
  const items = generateTestItems(fixture, lintRuleIds);
  const findings = sortFindings([
    ...requirementCoverage(fixture, items, gateIds),
    ...assumptionCoverage(fixture, items),
    ...completeness(items),
    ...uniqueIds(items),
  ]);
  return {
    verdict: aggregateVerdict(findings),
    rulesEvaluated: [...testPlanRuleIds],
    items,
    findings,
  };
};

export const unresolvedTestPlanFindings = (plan: TestPlan): RuleFinding[] =>
  unresolvedFindings(plan.findings);
