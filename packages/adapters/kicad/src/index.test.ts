import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  KicadProjectionError,
  renderBoard,
  renderProject,
  renderSchematic,
  renderSmokeBoard,
} from "./projection.js";
import { kicadAdapterPackageVersion } from "./index.js";
import type { Phase1Fixture } from "@acd/schema";

describe("@acd/adapter-kicad", () => {
  it("exposes the package version", () => {
    expect(kicadAdapterPackageVersion).toBe("0.1.0");
  });

  it("renders deterministic minimal project files", () => {
    expect(renderProject()).toBe(renderProject());
    expect(renderBoard()).toContain('(layer "Edge.Cuts")');
    expect(renderSchematic()).toContain("(kicad_sch");
  });

  it("renders smoke fixture nets and pads", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("../../../../fixtures/phase1/smoke.json", import.meta.url), "utf8"),
    ) as Phase1Fixture;
    const board = renderSmokeBoard(fixture);
    expect(board).toContain('(footprint "R_0603_1608Metric"');
    expect(board).toContain('(net 1 "+5V")');
    expect(board).toContain('(pad "2" smd roundrect');
  });

  it("renders smoke fixture symbols and power labels", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("../../../../fixtures/phase1/smoke.json", import.meta.url), "utf8"),
    ) as Phase1Fixture;
    const schematic = renderSchematic(fixture);

    expect(schematic).toContain('(lib_id "Connector_Generic:Conn_01x02")');
    expect(schematic).toContain('(lib_id "Device:R")');
    expect(schematic).toContain('(lib_id "power:PWR_FLAG")');
    expect(schematic).toContain('(label "+5V"');
  });

  it("stops on unsupported fixture geometry", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("../../../../fixtures/phase1/smoke.json", import.meta.url), "utf8"),
    ) as Phase1Fixture;
    const unsupported = structuredClone(fixture);
    unsupported.mappings[0].pinPads[0].pad = "3";

    expect(() => renderSmokeBoard(unsupported)).toThrowError(KicadProjectionError);
    expect(() => renderSmokeBoard({ ...fixture, fixtureKind: "golden" })).toThrowError(
      KicadProjectionError,
    );
  });
});
