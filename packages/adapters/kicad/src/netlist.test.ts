import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import { canonicalFixtureNetlist, compareNetlists } from "./netlist.js";

describe("Phase 1 canonical netlist", () => {
  it("matches the generated schematic and PCB readback formats", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("../../../../fixtures/phase1/smoke.json", import.meta.url), "utf8"),
    ) as Phase1Fixture;
    const expected = canonicalFixtureNetlist(fixture);
    const netlist = `(nets
      (net (name "/+5V") (node (ref "C1") (pin "1")) (node (ref "J1") (pin "1")) (node (ref "R1") (pin "1")))
      (net (name "/GND") (node (ref "C1") (pin "2")) (node (ref "D1") (pin "1")) (node (ref "J1") (pin "2")))
      (net (name "/LED_A") (node (ref "D1") (pin "2")) (node (ref "R1") (pin "2")))
    )`;
    const ipc = [
      "327+5V              J1    -1",
      "327+5V              R1    -1",
      "327+5V              C1    -1",
      "327GND              J1    -2",
      "327GND              D1    -1",
      "327GND              C1    -2",
      "327LED_A            R1    -2",
      "327LED_A            D1    -2",
    ].join("\n");
    const result = compareNetlists(fixture, netlist, ipc);

    expect(result.expected).toEqual(expected);
    expect(result.graphVsSchematic).toBe(true);
    expect(result.graphVsPcb).toBe(true);
    expect(result.overall).toBe(true);
  });

  it("compares IPC-D-356 pad designators through fixture pin mappings", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("../../../../fixtures/phase1/smoke.json", import.meta.url), "utf8"),
    ) as Phase1Fixture;
    for (const mapping of fixture.mappings) {
      for (const pinPad of mapping.pinPads) pinPad.pad = `P${pinPad.pad}`;
    }
    const ipc = [
      "327+5V              J1    -P1",
      "327+5V              R1    -P1",
      "327+5V              C1    -P1",
      "327GND              J1    -P2",
      "327GND              D1    -P1",
      "327GND              C1    -P2",
      "327LED_A            R1    -P2",
      "327LED_A            D1    -P2",
    ].join("\n");
    const result = compareNetlists(fixture, "", ipc);

    expect(result.graphVsPcb).toBe(true);
  });
});
