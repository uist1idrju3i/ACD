import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Phase1Fixture } from "@acd/schema";
import { describe, expect, it } from "vitest";
import {
  electricalLintRuleIds,
  failedFindings,
  lintElectricalTopology,
} from "./electrical-lint.js";

const goldenPath = fileURLToPath(
  new URL("../../../fixtures/phase1/golden-esp32.json", import.meta.url),
);
const golden = JSON.parse(await readFile(goldenPath, "utf8")) as Phase1Fixture;

const clone = (fixture: Phase1Fixture): Phase1Fixture =>
  JSON.parse(JSON.stringify(fixture)) as Phase1Fixture;

const nonEmpty = <T>(items: T[], label: string): [T, ...T[]] => {
  const [first, ...rest] = items;
  if (first === undefined) throw new Error(`${label} became empty`);
  return [first, ...rest];
};

const findPart = (fixture: Phase1Fixture, id: string): Phase1Fixture["parts"][number] => {
  const part = fixture.parts.find((candidate) => candidate.id === id);
  if (!part) throw new Error(`fixture has no part ${id}`);
  return part;
};

const withoutPart = (fixture: Phase1Fixture, id: string): Phase1Fixture => {
  const stripped = clone(fixture);
  stripped.parts = nonEmpty(
    stripped.parts.filter((part) => part.id !== id),
    "parts",
  );
  stripped.mappings = nonEmpty(
    stripped.mappings.filter((mapping) => mapping.partId !== id),
    "mappings",
  );
  stripped.bom = nonEmpty(
    stripped.bom.filter((line) => line.partId !== id),
    "bom",
  );
  stripped.placementConstraints.components = nonEmpty(
    stripped.placementConstraints.components.filter((placement) => placement.partId !== id),
    "placements",
  );
  stripped.nets = nonEmpty(
    stripped.nets
      .map((net) => ({ ...net, pins: net.pins.filter((pin) => pin.partId !== id) }))
      .filter((net) => net.pins.length > 0)
      .map((net) => ({ ...net, pins: nonEmpty(net.pins, net.id) })),
    "nets",
  );
  return stripped;
};

const rulesOf = (fixture: Phase1Fixture, status: "fail" | "unknown"): string[] => [
  ...new Set(
    lintElectricalTopology(fixture)
      .findings.filter((finding) => finding.status === status)
      .map((finding) => finding.ruleId),
  ),
];

describe("electrical lint", () => {
  it("passes the golden fixture with every rule evaluated", () => {
    const report = lintElectricalTopology(golden);
    expect(failedFindings(report)).toEqual([]);
    expect(report.verdict).toBe("pass");
    expect([...new Set(report.findings.map((finding) => finding.ruleId))].sort()).toEqual(
      [...electricalLintRuleIds].filter((id) => id !== "pin-connected").sort(),
    );
  });

  it("is deterministic for the same input", () => {
    expect(JSON.stringify(lintElectricalTopology(golden))).toBe(
      JSON.stringify(lintElectricalTopology(clone(golden))),
    );
  });

  it("reports a finding with rule, entity, expectation, observation and basis", () => {
    const finding = lintElectricalTopology(golden).findings.find(
      (candidate) => candidate.ruleId === "led-series-current",
    );
    expect(finding).toMatchObject({
      status: "pass",
      entity: "part:d1",
      expected: "1-20 mA at 3.3 V drive",
      observed: "3.94 mA through 330 ohm",
    });
    expect(finding?.basis).not.toBe("");
  });

  it("fails when the USB-C CC pull-down is missing", () => {
    expect(rulesOf(withoutPart(golden, "part:r6"), "fail")).toEqual(["usb-cc-termination"]);
  });

  it("fails when the USB-C CC termination uses the wrong value", () => {
    const wrong = clone(golden);
    findPart(wrong, "part:r6").parameters = { source: "injected", resistanceOhm: 10000 };
    expect(rulesOf(wrong, "fail")).toEqual(["usb-cc-termination"]);
  });

  it("fails when the LED series resistor lets too much current through", () => {
    const wrong = clone(golden);
    findPart(wrong, "part:r3").parameters = { source: "injected", resistanceOhm: 22 };
    expect(rulesOf(wrong, "fail")).toEqual(["led-series-current"]);
  });

  it("fails when the regulator output bulk capacitor is missing", () => {
    expect(rulesOf(withoutPart(golden, "part:c5"), "fail")).toEqual(["regulator-bulk-capacitance"]);
  });

  it("fails when a footprint does not match the part package", () => {
    const wrong = clone(golden);
    const mapping = wrong.mappings.find((candidate) => candidate.partId === "part:r3");
    if (!mapping) throw new Error("fixture has no mapping for part:r3");
    mapping.footprintName = "R_0805_2012Metric";
    expect(rulesOf(wrong, "fail")).toEqual(["footprint-package-consistency"]);
  });

  it("fails when a decoupling capacitor is removed from a supply net", () => {
    const stripped = withoutPart(withoutPart(golden, "part:c1"), "part:c2");
    expect(rulesOf(stripped, "fail")).toEqual(["decoupling-present"]);
  });

  it("fails when an I2C pull-up is missing", () => {
    expect(rulesOf(withoutPart(golden, "part:r8"), "fail")).toEqual(["i2c-pullup"]);
  });

  it("fails when a two-terminal passive pin is left floating", () => {
    const floating = clone(golden);
    floating.nets = nonEmpty(
      floating.nets.map((net) =>
        net.id === "net:gnd"
          ? {
              ...net,
              pins: nonEmpty(
                net.pins.filter((pin) => pin.partId !== "part:r5"),
                net.id,
              ),
            }
          : net,
      ),
      "nets",
    );
    expect(rulesOf(floating, "fail")).toEqual(["pin-connected"]);
  });

  it("fails when a capacitor rating does not cover the net voltage with margin", () => {
    const wrong = clone(golden);
    findPart(wrong, "part:c4").parameters = {
      source: "injected",
      capacitanceUf: 10,
      ratedVoltageV: 6.3,
    };
    expect(rulesOf(wrong, "fail")).toEqual(["capacitor-voltage-derating"]);
  });

  it("blocks instead of passing when a parameter is undeclared", () => {
    const incomplete = clone(golden);
    findPart(incomplete, "part:d1").parameters = { source: "injected" };
    const report = lintElectricalTopology(incomplete);
    expect(report.verdict).toBe("blocked");
    expect(rulesOf(incomplete, "unknown")).toEqual(["led-series-current"]);
  });
});
