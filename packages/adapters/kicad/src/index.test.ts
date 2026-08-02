import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { KicadProjectionError, renderSchematic, renderSmokeBoard } from "./projection.js";
import { renderProject } from "./project-files.js";
import {
  canonicalGraphNetlist,
  canonicalGraphPcbNetlist,
  renderGraphBoard,
  renderGraphSchematic,
} from "./graph-projection.js";
import { kicadAdapterPackageVersion } from "./index.js";
import { readBoardModel, type DesignGraph } from "@acd/graph-core";
import type { Phase1Fixture } from "@acd/schema";

const loadPhase0Graph = async (): Promise<DesignGraph> =>
  JSON.parse(
    await readFile(
      new URL("../../../../fixtures/design-graphs/normal-2layer.json", import.meta.url),
      "utf8",
    ),
  ) as DesignGraph;

describe("@acd/adapter-kicad", () => {
  it("exposes the package version", () => {
    expect(kicadAdapterPackageVersion).toBe("0.1.0");
  });

  it("renders deterministic minimal project files", () => {
    expect(renderProject()).toBe(renderProject());
  });

  it("projects the Phase 0 design graph into board and schematic geometry", async () => {
    const model = readBoardModel(await loadPhase0Graph());
    const board = renderGraphBoard(model);
    const schematic = renderGraphSchematic(model);

    expect(board).toContain('(footprint "R_0603_1608Metric"');
    expect(board).toContain('(net 1 "+5V")');
    expect(board).toContain("(segment (start 8.75 5) (end 12.75 5)");
    expect(board).toContain("(via (at 2 7.5)");
    expect(schematic).toContain('(lib_id "Connector_Generic:Conn_01x02")');
    expect(schematic).toContain('(lib_id "power:PWR_FLAG")');
    expect(schematic).toContain('(label "LED_A"');
    expect(renderGraphBoard(model)).toBe(board);
  });

  it("renders back-side pads on the back layers", async () => {
    const graph = await loadPhase0Graph();
    const layout = graph.entities.find((entity) => entity.id === "layout:main");
    const placements = (
      layout?.attributes as { placements: { componentId: string; layer: string }[] }
    ).placements;
    const led = placements.find((placement) => placement.componentId === "component:d1");
    if (!led) throw new Error("missing placement for component:d1");
    led.layer = "B.Cu";

    const board = renderGraphBoard(readBoardModel(graph));

    expect(board).toContain('(layers "B.Cu" "B.Paste" "B.Mask")');
  });

  it("stops instead of projecting a rotated schematic symbol", async () => {
    const graph = await loadPhase0Graph();
    const component = graph.entities.find((entity) => entity.id === "component:r1");
    (component?.attributes as { schematic: { rotationDeg: number } }).schematic.rotationDeg = 90;

    expect(() => renderGraphSchematic(readBoardModel(graph))).toThrowError(
      /rotated schematic symbols are not projected/,
    );
  });

  it("derives the canonical netlist from the graph without power flags", async () => {
    const model = readBoardModel(await loadPhase0Graph());

    expect(canonicalGraphNetlist(model)).toEqual([
      { net: "+5V", reference: "C1", pin: "1" },
      { net: "+5V", reference: "J1", pin: "1" },
      { net: "+5V", reference: "R1", pin: "1" },
      { net: "GND", reference: "C1", pin: "2" },
      { net: "GND", reference: "D1", pin: "1" },
      { net: "GND", reference: "J1", pin: "2" },
      { net: "LED_A", reference: "D1", pin: "2" },
      { net: "LED_A", reference: "R1", pin: "2" },
    ]);
    expect(canonicalGraphPcbNetlist(model)).toEqual(canonicalGraphNetlist(model));
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
