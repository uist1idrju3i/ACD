import type { Phase1Fixture } from "@acd/schema";

export type LintStatus = "pass" | "fail" | "unknown";
export type LintVerdict = "pass" | "fail" | "blocked";

export type LintFinding = {
  ruleId: string;
  status: LintStatus;
  entity: string;
  expected: string;
  observed: string;
  basis: string;
};

export type ElectricalLintReport = {
  verdict: LintVerdict;
  rulesEvaluated: string[];
  findings: LintFinding[];
};

export type ElectricalLintProfile = {
  /** Minimum ratio of a capacitor rated voltage to the nominal voltage of its net. */
  capacitorVoltageDerating: number;
  /** Largest capacitance treated as a decoupling capacitor rather than bulk storage. */
  decouplingMaxUf: number;
  /** Resistance window accepted for an I2C pull-up. */
  i2cPullupOhm: { min: number; max: number };
  /** USB Type-C sink CC pull-down (Rd) and its accepted tolerance. */
  usbCcPulldownOhm: number;
  usbCcToleranceRatio: number;
};

export const defaultElectricalLintProfile: ElectricalLintProfile = {
  capacitorVoltageDerating: 1.5,
  decouplingMaxUf: 1,
  i2cPullupOhm: { min: 1000, max: 10000 },
  usbCcPulldownOhm: 5100,
  usbCcToleranceRatio: 0.1,
};

type Fixture = Phase1Fixture;
type Net = Fixture["nets"][number];
type Part = Fixture["parts"][number];
type PinPad = Fixture["mappings"][number]["pinPads"][number];

type Context = {
  fixture: Fixture;
  profile: ElectricalLintProfile;
  parts: Map<string, Part>;
  pinPads: Map<string, PinPad>;
  netsByPart: Map<string, Net[]>;
  netOfPin: Map<string, Net>;
  groundNets: Set<string>;
};

const pinKey = (partId: string, pin: string): string => `${partId}\u0000${pin}`;

const buildContext = (fixture: Fixture, profile: ElectricalLintProfile): Context => {
  const pinPads = new Map<string, PinPad>();
  for (const mapping of fixture.mappings) {
    for (const pinPad of mapping.pinPads) pinPads.set(pinKey(mapping.partId, pinPad.pin), pinPad);
  }
  const netsByPart = new Map<string, Net[]>();
  const netOfPin = new Map<string, Net>();
  for (const net of fixture.nets) {
    for (const pin of net.pins) {
      netOfPin.set(pinKey(pin.partId, pin.pin), net);
      const nets = netsByPart.get(pin.partId) ?? [];
      if (!nets.includes(net)) nets.push(net);
      netsByPart.set(pin.partId, nets);
    }
  }
  return {
    fixture,
    profile,
    parts: new Map(fixture.parts.map((part) => [part.id, part])),
    pinPads,
    netsByPart,
    netOfPin,
    groundNets: new Set(fixture.nets.filter((net) => net.class === "ground").map((net) => net.id)),
  };
};

const netsOfPart = (context: Context, partId: string): Net[] =>
  context.netsByPart.get(partId) ?? [];

const otherNets = (context: Context, partId: string, net: Net): Net[] =>
  netsOfPart(context, partId).filter((candidate) => candidate.id !== net.id);

const partsOnNet = (context: Context, net: Net, kind: Part["kind"]): Part[] => {
  const seen = new Set<string>();
  const found: Part[] = [];
  for (const pin of net.pins) {
    const part = context.parts.get(pin.partId);
    if (!part || part.kind !== kind || seen.has(part.id)) continue;
    seen.add(part.id);
    found.push(part);
  }
  return found;
};

const supplyPins = (context: Context, partId: string): PinPad[] =>
  context.fixture.mappings
    .filter((mapping) => mapping.partId === partId)
    .flatMap((mapping) => mapping.pinPads)
    .filter((pinPad) => pinPad.electricalType === "power-input");

/** Capacitance connected between the given net and any ground net. */
const bypassCapacitanceUf = (
  context: Context,
  net: Net,
  { maxUf }: { maxUf?: number } = {},
): { totalUf: number; unknownParts: string[] } => {
  let totalUf = 0;
  const unknownParts: string[] = [];
  for (const capacitor of partsOnNet(context, net, "capacitor")) {
    const grounded = otherNets(context, capacitor.id, net).some((candidate) =>
      context.groundNets.has(candidate.id),
    );
    if (!grounded) continue;
    const value = capacitor.parameters?.capacitanceUf;
    if (value === undefined) {
      unknownParts.push(capacitor.reference);
      continue;
    }
    if (maxUf !== undefined && value > maxUf) continue;
    totalUf += value;
  }
  return { totalUf, unknownParts };
};

const powerNetsOfPart = (context: Context, partId: string): Net[] =>
  netsOfPart(context, partId).filter((net) => {
    if (net.class !== "power") return false;
    return net.pins.some(
      (pin) =>
        pin.partId === partId &&
        context.pinPads.get(pinKey(pin.partId, pin.pin))?.electricalType === "power-input",
    );
  });

const twoTerminalKinds: Part["kind"][] = ["resistor", "capacitor", "led"];

const pinConnected = (context: Context): LintFinding[] =>
  context.fixture.mappings.flatMap((mapping) => {
    const part = context.parts.get(mapping.partId);
    const required = (pinPad: PinPad): boolean =>
      pinPad.electricalType === "power-input" ||
      pinPad.electricalType === "power-output" ||
      (part !== undefined && twoTerminalKinds.includes(part.kind));
    return mapping.pinPads
      .filter((pinPad) => pinPad.electricalType !== "no-connect" && required(pinPad))
      .filter((pinPad) => !context.netOfPin.has(pinKey(mapping.partId, pinPad.pin)))
      .map((pinPad) => ({
        ruleId: "pin-connected",
        status: "fail" as const,
        entity: `${mapping.partId}:${pinPad.pin}`,
        expected: "power pins and two-terminal passive pins are connected to a net",
        observed: "pin is not a member of any net",
        basis: "fixture nets and symbol pin electrical types",
      }));
  });

const powerNetVoltageDeclared = (context: Context): LintFinding[] =>
  context.fixture.nets
    .filter((net) => net.class === "power")
    .map((net) =>
      net.nominalVoltageV === undefined
        ? {
            ruleId: "power-net-voltage-declared",
            status: "unknown" as const,
            entity: net.id,
            expected: "power net declares nominalVoltageV",
            observed: "nominalVoltageV is absent",
            basis: "fixture net declaration",
          }
        : {
            ruleId: "power-net-voltage-declared",
            status: "pass" as const,
            entity: net.id,
            expected: "power net declares nominalVoltageV",
            observed: `${net.nominalVoltageV} V`,
            basis: "fixture net declaration",
          },
    );

const regulatorBulkCapacitance = (context: Context): LintFinding[] => {
  const findings: LintFinding[] = [];
  for (const regulator of context.fixture.parts.filter((part) => part.kind === "regulator")) {
    const sides = [
      { pinType: "power-input" as const, requirement: "inputCapacitanceMinUf" as const },
      { pinType: "power-output" as const, requirement: "outputCapacitanceMinUf" as const },
    ];
    for (const side of sides) {
      const required = regulator.parameters?.[side.requirement];
      const net = netsOfPart(context, regulator.id).find(
        (candidate) =>
          candidate.class === "power" &&
          candidate.pins.some(
            (pin) =>
              pin.partId === regulator.id &&
              context.pinPads.get(pinKey(pin.partId, pin.pin))?.electricalType === side.pinType,
          ),
      );
      const entity = `${regulator.id}:${side.pinType}`;
      if (required === undefined || !net) {
        findings.push({
          ruleId: "regulator-bulk-capacitance",
          status: "unknown",
          entity,
          expected: "regulator declares required bulk capacitance on an identified power net",
          observed:
            required === undefined ? "requirement is absent" : "power net is not identified",
          basis: "regulator datasheet parameters",
        });
        continue;
      }
      const { totalUf, unknownParts } = bypassCapacitanceUf(context, net);
      if (unknownParts.length > 0) {
        findings.push({
          ruleId: "regulator-bulk-capacitance",
          status: "unknown",
          entity,
          expected: `>= ${required} uF on ${net.id}`,
          observed: `capacitance of ${unknownParts.join(", ")} is undeclared`,
          basis: "regulator datasheet parameters",
        });
        continue;
      }
      findings.push({
        ruleId: "regulator-bulk-capacitance",
        status: totalUf >= required ? "pass" : "fail",
        entity,
        expected: `>= ${required} uF on ${net.id}`,
        observed: `${totalUf} uF`,
        basis: "regulator datasheet parameters",
      });
    }
  }
  return findings;
};

const decouplingPerSupplyPin = (context: Context): LintFinding[] => {
  const findings: LintFinding[] = [];
  const consumers = context.fixture.parts.filter((part) =>
    ["ic", "module", "sensor"].includes(part.kind),
  );
  for (const part of consumers) {
    const nets = new Set<string>();
    for (const pinPad of supplyPins(context, part.id)) {
      const net = context.netOfPin.get(pinKey(part.id, pinPad.pin));
      if (!net || net.class !== "power" || nets.has(net.id)) continue;
      nets.add(net.id);
      const { totalUf, unknownParts } = bypassCapacitanceUf(context, net, {
        maxUf: context.profile.decouplingMaxUf,
      });
      const entity = `${part.id}@${net.id}`;
      if (totalUf === 0 && unknownParts.length > 0) {
        findings.push({
          ruleId: "decoupling-present",
          status: "unknown",
          entity,
          expected: "at least one decoupling capacitor between the supply net and ground",
          observed: `capacitance of ${unknownParts.join(", ")} is undeclared`,
          basis: "supply pins declared by the symbol mapping",
        });
        continue;
      }
      findings.push({
        ruleId: "decoupling-present",
        status: totalUf > 0 ? "pass" : "fail",
        entity,
        expected: `decoupling capacitance <= ${context.profile.decouplingMaxUf} uF between ${net.id} and ground`,
        observed: `${totalUf} uF`,
        basis: "supply pins declared by the symbol mapping",
      });
    }
  }
  return findings;
};

type LedBranch = {
  resistanceOhm?: number;
  undeclaredResistors: string[];
  driveVoltageV?: number;
  reachedGround: boolean;
};

/** Walks the two-terminal chain around an LED to collect series resistance and the drive node. */
const traceLedBranch = (context: Context, led: Part): LedBranch => {
  const branch: LedBranch = { resistanceOhm: 0, undeclaredResistors: [], reachedGround: false };
  const visited = new Set<string>([led.id]);
  for (const start of netsOfPart(context, led.id)) {
    let net: Net | undefined = start;
    while (net) {
      if (context.groundNets.has(net.id)) {
        branch.reachedGround = true;
        break;
      }
      if (net.class === "power" && net.nominalVoltageV !== undefined) {
        branch.driveVoltageV = net.nominalVoltageV;
        break;
      }
      const driver = net.pins.find((pin) => {
        const type = context.pinPads.get(pinKey(pin.partId, pin.pin))?.electricalType;
        return type === "output" || type === "bidirectional";
      });
      if (driver) {
        const supply = powerNetsOfPart(context, driver.partId).find(
          (candidate) => candidate.nominalVoltageV !== undefined,
        );
        if (supply?.nominalVoltageV !== undefined) branch.driveVoltageV = supply.nominalVoltageV;
        break;
      }
      const next: Net | undefined = net.pins
        .map((pin) => context.parts.get(pin.partId))
        .filter((part): part is Part => part !== undefined && part.kind === "resistor")
        .filter((part) => !visited.has(part.id))
        .flatMap((resistor) => {
          visited.add(resistor.id);
          const value = resistor.parameters?.resistanceOhm;
          if (value === undefined) branch.undeclaredResistors.push(resistor.reference);
          else if (branch.resistanceOhm !== undefined) branch.resistanceOhm += value;
          return otherNets(context, resistor.id, net as Net);
        })[0];
      net = next;
    }
  }
  return branch;
};

const ledSeriesCurrent = (context: Context): LintFinding[] =>
  context.fixture.parts
    .filter((part) => part.kind === "led")
    .map((led) => {
      const forwardVoltageV = led.parameters?.forwardVoltageV;
      const minMa = led.parameters?.forwardCurrentMinMa;
      const maxMa = led.parameters?.forwardCurrentMaxMa;
      const branch = traceLedBranch(context, led);
      const basis = "LED datasheet parameters and the series resistor topology";
      if (
        forwardVoltageV === undefined ||
        minMa === undefined ||
        maxMa === undefined ||
        branch.driveVoltageV === undefined ||
        branch.undeclaredResistors.length > 0 ||
        branch.resistanceOhm === undefined
      ) {
        return {
          ruleId: "led-series-current",
          status: "unknown" as const,
          entity: led.id,
          expected: "declared LED forward voltage, current window, drive voltage and resistance",
          observed:
            branch.undeclaredResistors.length > 0
              ? `resistance of ${branch.undeclaredResistors.join(", ")} is undeclared`
              : "LED parameters or drive voltage are undeclared",
          basis,
        };
      }
      if (branch.resistanceOhm <= 0) {
        return {
          ruleId: "led-series-current",
          status: "fail" as const,
          entity: led.id,
          expected: `series resistance limiting current to ${minMa}-${maxMa} mA`,
          observed: "no series resistance in the LED branch",
          basis,
        };
      }
      const currentMa = ((branch.driveVoltageV - forwardVoltageV) / branch.resistanceOhm) * 1000;
      const rounded = Math.round(currentMa * 100) / 100;
      return {
        ruleId: "led-series-current",
        status: currentMa >= minMa && currentMa <= maxMa ? ("pass" as const) : ("fail" as const),
        entity: led.id,
        expected: `${minMa}-${maxMa} mA at ${branch.driveVoltageV} V drive`,
        observed: `${rounded} mA through ${branch.resistanceOhm} ohm`,
        basis,
      };
    });

const usbCcTermination = (context: Context): LintFinding[] =>
  context.fixture.nets
    .filter((net) => net.role === "usb-cc")
    .map((net) => {
      const { usbCcPulldownOhm, usbCcToleranceRatio } = context.profile;
      const tolerance = usbCcPulldownOhm * usbCcToleranceRatio;
      const expected = `${usbCcPulldownOhm} ohm +/-${usbCcToleranceRatio * 100}% pull-down to ground`;
      const basis = "USB Type-C sink Rd termination";
      const resistors = partsOnNet(context, net, "resistor").filter((resistor) =>
        otherNets(context, resistor.id, net).some((candidate) =>
          context.groundNets.has(candidate.id),
        ),
      );
      if (resistors.length === 0) {
        return {
          ruleId: "usb-cc-termination",
          status: "fail" as const,
          entity: net.id,
          expected,
          observed: "no pull-down resistor to ground",
          basis,
        };
      }
      const undeclared = resistors.filter(
        (resistor) => resistor.parameters?.resistanceOhm === undefined,
      );
      if (undeclared.length > 0) {
        return {
          ruleId: "usb-cc-termination",
          status: "unknown" as const,
          entity: net.id,
          expected,
          observed: `resistance of ${undeclared.map((resistor) => resistor.reference).join(", ")} is undeclared`,
          basis,
        };
      }
      const matched = resistors.filter(
        (resistor) =>
          Math.abs((resistor.parameters?.resistanceOhm ?? 0) - usbCcPulldownOhm) <= tolerance,
      );
      return {
        ruleId: "usb-cc-termination",
        status: matched.length > 0 ? ("pass" as const) : ("fail" as const),
        entity: net.id,
        expected,
        observed: resistors
          .map((resistor) => `${resistor.reference}=${resistor.parameters?.resistanceOhm} ohm`)
          .join(", "),
        basis,
      };
    });

const i2cPullup = (context: Context): LintFinding[] =>
  context.fixture.nets
    .filter((net) => net.role === "i2c")
    .map((net) => {
      const { min, max } = context.profile.i2cPullupOhm;
      const expected = `pull-up of ${min}-${max} ohm to a power net`;
      const basis = "I2C open-drain bus termination";
      const resistors = partsOnNet(context, net, "resistor").filter((resistor) =>
        otherNets(context, resistor.id, net).some((candidate) => candidate.class === "power"),
      );
      if (resistors.length === 0) {
        return {
          ruleId: "i2c-pullup",
          status: "fail" as const,
          entity: net.id,
          expected,
          observed: "no pull-up resistor to a power net",
          basis,
        };
      }
      const values = resistors.map((resistor) => resistor.parameters?.resistanceOhm);
      if (values.some((value) => value === undefined)) {
        return {
          ruleId: "i2c-pullup",
          status: "unknown" as const,
          entity: net.id,
          expected,
          observed: "pull-up resistance is undeclared",
          basis,
        };
      }
      const inRange = values.filter(
        (value): value is number => value !== undefined && value >= min && value <= max,
      );
      return {
        ruleId: "i2c-pullup",
        status: inRange.length > 0 ? ("pass" as const) : ("fail" as const),
        entity: net.id,
        expected,
        observed: `${values.join(", ")} ohm`,
        basis,
      };
    });

const capacitorVoltageDerating = (context: Context): LintFinding[] => {
  const findings: LintFinding[] = [];
  for (const capacitor of context.fixture.parts.filter((part) => part.kind === "capacitor")) {
    const voltages = netsOfPart(context, capacitor.id)
      .map((net) => net.nominalVoltageV)
      .filter((voltage): voltage is number => voltage !== undefined);
    if (voltages.length === 0) continue;
    const netVoltageV = Math.max(...voltages);
    const required = netVoltageV * context.profile.capacitorVoltageDerating;
    const rated = capacitor.parameters?.ratedVoltageV;
    findings.push(
      rated === undefined
        ? {
            ruleId: "capacitor-voltage-derating",
            status: "unknown",
            entity: capacitor.id,
            expected: `rated voltage >= ${required} V`,
            observed: "ratedVoltageV is undeclared",
            basis: "capacitor datasheet parameters and net nominal voltage",
          }
        : {
            ruleId: "capacitor-voltage-derating",
            status: rated >= required ? "pass" : "fail",
            entity: capacitor.id,
            expected: `rated voltage >= ${required} V`,
            observed: `${rated} V`,
            basis: "capacitor datasheet parameters and net nominal voltage",
          },
    );
  }
  return findings;
};

const alphanumeric = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Package tokens carrying a size code, plus the manufacturer part number prefix. */
const footprintTokens = (part: Part): string[] => {
  const packageTokens = part.package
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter((token) => /[0-9]/.test(token))
    .map(alphanumeric)
    .filter((token) => token.length >= 3);
  const mpn = alphanumeric(part.mpn);
  return [...packageTokens, ...(mpn.length >= 5 ? [mpn.slice(0, 5)] : [])];
};

const footprintPackageConsistency = (context: Context): LintFinding[] =>
  context.fixture.mappings.map((mapping) => {
    const part = context.parts.get(mapping.partId);
    const tokens = part ? footprintTokens(part) : [];
    const basis = "part package descriptor, MPN and mapped footprint name";
    if (!part || tokens.length === 0) {
      return {
        ruleId: "footprint-package-consistency",
        status: "unknown" as const,
        entity: mapping.partId,
        expected: "part package or MPN carries a comparable token",
        observed: part ? `package "${part.package}" has no comparable token` : "part is missing",
        basis,
      };
    }
    const footprint = alphanumeric(mapping.footprintName);
    return {
      ruleId: "footprint-package-consistency",
      status: tokens.some((token) => footprint.includes(token))
        ? ("pass" as const)
        : ("fail" as const),
      entity: mapping.partId,
      expected: `footprint name contains one of ${tokens.join(", ")}`,
      observed: mapping.footprintName,
      basis,
    };
  });

const rules = [
  { id: "pin-connected", evaluate: pinConnected },
  { id: "power-net-voltage-declared", evaluate: powerNetVoltageDeclared },
  { id: "regulator-bulk-capacitance", evaluate: regulatorBulkCapacitance },
  { id: "decoupling-present", evaluate: decouplingPerSupplyPin },
  { id: "led-series-current", evaluate: ledSeriesCurrent },
  { id: "usb-cc-termination", evaluate: usbCcTermination },
  { id: "i2c-pullup", evaluate: i2cPullup },
  { id: "capacitor-voltage-derating", evaluate: capacitorVoltageDerating },
  { id: "footprint-package-consistency", evaluate: footprintPackageConsistency },
] as const;

export const electricalLintRuleIds: readonly string[] = rules.map((rule) => rule.id);

/**
 * Deterministic topology-level electrical lint. Findings are three-valued: an unknown
 * finding blocks the run instead of passing it, so missing parameters widen verification.
 */
export const lintElectricalTopology = (
  fixture: Phase1Fixture,
  profile: ElectricalLintProfile = defaultElectricalLintProfile,
): ElectricalLintReport => {
  const context = buildContext(fixture, profile);
  const findings = rules
    .flatMap((rule) => rule.evaluate(context))
    .sort(
      (left, right) =>
        left.ruleId.localeCompare(right.ruleId) || left.entity.localeCompare(right.entity),
    );
  const verdict: LintVerdict = findings.some((finding) => finding.status === "fail")
    ? "fail"
    : findings.some((finding) => finding.status === "unknown")
      ? "blocked"
      : "pass";
  return { verdict, rulesEvaluated: [...electricalLintRuleIds], findings };
};

export const failedFindings = (report: ElectricalLintReport): LintFinding[] =>
  report.findings.filter((finding) => finding.status !== "pass");
