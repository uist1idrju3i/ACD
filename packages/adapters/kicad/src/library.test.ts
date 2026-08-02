import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseFootprintPads, parseFootprintSource, verifyLibrarySnapshot } from "./library.js";

describe("KiCad library snapshot", () => {
  it("verifies pinned hashes and parses official pad geometry", () => {
    expect(() => verifyLibrarySnapshot()).not.toThrow();
    expect(parseFootprintPads("JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical")).toEqual([
      expect.objectContaining({
        number: "1",
        type: "thru_hole",
        x: 0,
        y: 0,
        drill: 0.75,
      }),
      expect.objectContaining({
        number: "2",
        type: "thru_hole",
        x: 2,
        y: 0,
        drill: 0.75,
      }),
    ]);
    expect(parseFootprintPads("R_0603_1608Metric")).toEqual([
      expect.objectContaining({ number: "1", type: "smd", x: -0.825, y: 0 }),
      expect.objectContaining({ number: "2", type: "smd", x: 0.825, y: 0 }),
    ]);
  });

  it("stops when a footprint is absent from the pinned manifest", () => {
    expect(() => parseFootprintPads("Unknown_Footprint")).toThrow(
      /missing footprint manifest entry/,
    );
  });

  it("stops on unsupported oval drill constructs", () => {
    const footprint = `(footprint "invalid"
      (layer "F.Cu")
      (pad "1" thru_hole oval
        (at 0 0)
        (size 1.2 1.7)
        (drill oval 0.8 1.1)
        (layers "*.Cu" "*.Mask")
      )
    )`;
    expect(() => parseFootprintSource("invalid", footprint)).toThrow(/unsupported drill construct/);
  });

  it("resolves every golden fixture footprint from the pinned snapshot", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL("../../../../fixtures/phase1/golden-esp32.json", import.meta.url),
        "utf8",
      ),
    ) as { mappings: Array<{ footprintName: string }> };
    for (const mapping of fixture.mappings) {
      expect(parseFootprintPads(mapping.footprintName).length).toBeGreaterThan(0);
    }
  });
});
