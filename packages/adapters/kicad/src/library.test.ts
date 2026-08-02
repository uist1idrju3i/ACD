import { describe, expect, it } from "vitest";
import { parseFootprintPads, verifyLibrarySnapshot } from "./library.js";

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
});
