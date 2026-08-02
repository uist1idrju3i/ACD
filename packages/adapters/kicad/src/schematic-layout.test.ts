import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import { KicadProjectionError } from "./errors.js";
import {
  assertNoPinOverlap,
  labelJustification,
  renderTitleBlock,
  schematicBlocks,
  schematicLayout,
  type SymbolExtent,
} from "./schematic-layout.js";

const golden = JSON.parse(
  await readFile(new URL("../../../../fixtures/phase1/golden-esp32.json", import.meta.url), "utf8"),
) as Phase1Fixture;

const uniformExtent = (): SymbolExtent => ({
  minXMm: -5.08,
  maxXMm: 5.08,
  minYMm: -5.08,
  maxYMm: 5.08,
});

describe("schematic layout", () => {
  it("groups parts into the requirement's functional blocks using the rationale", () => {
    const blocks = schematicBlocks(golden);
    expect(blocks.map((block) => block.block)).toEqual(golden.requirement.functionalBlocks);
    const usb = blocks.find((block) => block.block === "usb-power-input");
    expect(usb?.partIds).toEqual(["part:c4", "part:j1", "part:r6", "part:r7"]);
  });

  it("places every part exactly once and keeps a block contiguous", () => {
    const layout = schematicLayout(golden, uniformExtent);
    expect(layout.origins.size).toBe(golden.parts.length);
    for (const block of layout.blocks) {
      const xs = block.partIds.map((partId) => layout.origins.get(partId)![0]);
      expect(new Set(xs).size).toBe(1);
    }
  });

  it("is deterministic for the same fixture", () => {
    const first = schematicLayout(golden, uniformExtent);
    const second = schematicLayout(golden, uniformExtent);
    expect([...first.origins.entries()]).toEqual([...second.origins.entries()]);
    expect(first.annotations).toEqual(second.annotations);
  });

  it("annotates every block it lays out", () => {
    const layout = schematicLayout(golden, uniformExtent);
    expect(layout.annotations.map((annotation) => annotation.text)).toEqual(
      layout.blocks.map((block) => block.title),
    );
  });

  it("refuses to leave a part unplaced", () => {
    const orphan: Phase1Fixture = {
      ...golden,
      requirement: { ...golden.requirement, functionalBlocks: ["usb-power-input"] },
      rationales: [],
    };
    const layout = schematicLayout(orphan, uniformExtent);
    expect(layout.blocks.map((block) => block.block)).toEqual(["unassigned"]);
    expect(layout.origins.size).toBe(orphan.parts.length);
  });

  it("stacks symbols clear of the reference and value text bands", () => {
    const flatExtent = (): SymbolExtent => ({
      minXMm: -5.08,
      maxXMm: 5.08,
      minYMm: 0,
      maxYMm: 0,
    });
    const layout = schematicLayout(golden, flatExtent);
    const block = layout.blocks[0]!;
    const [first, second] = block.partIds;
    const pitch = layout.origins.get(second!)![1] - layout.origins.get(first!)![1];
    // The renderer draws the value 5 mm below one origin and the reference 5 mm above the next.
    expect(pitch).toBeGreaterThan(10);
  });

  it("refuses a layout that runs off the sheet", () => {
    const oversized = (): SymbolExtent => ({
      minXMm: -5.08,
      maxXMm: 5.08,
      minYMm: -101.6,
      maxYMm: 101.6,
    });
    expect(() => schematicLayout(golden, oversized)).toThrowError(KicadProjectionError);
  });

  it("refuses a layout that overlaps pins of two symbols", () => {
    expect(() =>
      assertNoPinOverlap([
        { partId: "part:a", entity: "R1:1", xMm: 10, yMm: 20 },
        { partId: "part:b", entity: "R2:1", xMm: 10, yMm: 20 },
      ]),
    ).toThrowError(KicadProjectionError);
    expect(() =>
      assertNoPinOverlap([
        { partId: "part:a", entity: "J1:A9", xMm: 10, yMm: 20 },
        { partId: "part:a", entity: "J1:B9", xMm: 10, yMm: 20 },
      ]),
    ).not.toThrow();
  });

  it("keeps a label off the symbol body", () => {
    expect(labelJustification(-2.54)).toBe("right");
    expect(labelJustification(2.54)).toBe("left");
  });

  it("names the sheet after the requirement without changing the design", () => {
    const titleBlock = renderTitleBlock(golden);
    expect(titleBlock).toContain(`(title "${golden.requirement.name}")`);
    expect(titleBlock).toContain(`(comment 1 "${golden.fixtureId}")`);
  });
});
