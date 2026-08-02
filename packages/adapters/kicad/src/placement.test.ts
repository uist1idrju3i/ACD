import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Phase1Fixture } from "@acd/schema";
import { KicadProjectionError } from "./errors.js";
import { placeFixture } from "./placement.js";

const loadGolden = async (): Promise<Phase1Fixture> =>
  JSON.parse(
    await readFile(
      new URL("../../../../fixtures/phase1/golden-esp32.json", import.meta.url),
      "utf8",
    ),
  ) as Phase1Fixture;

describe("deterministic golden placement", () => {
  it("is stable for the same seed and fixture", async () => {
    const fixture = await loadGolden();
    expect(placeFixture(fixture)).toEqual(placeFixture(structuredClone(fixture)));
  });

  it("rejects overlapping components", async () => {
    const fixture = await loadGolden();
    const overlapping = structuredClone(fixture);
    overlapping.placementConstraints.components[1]!.xMm =
      overlapping.placementConstraints.components[0]!.xMm;
    overlapping.placementConstraints.components[1]!.yMm =
      overlapping.placementConstraints.components[0]!.yMm;
    expect(() => placeFixture(overlapping)).toThrowError(KicadProjectionError);
  });

  it("rejects components outside the board boundary", async () => {
    const fixture = await loadGolden();
    const outside = structuredClone(fixture);
    outside.placementConstraints.components[0]!.xMm = fixture.requirement.board.widthMm;
    expect(() => placeFixture(outside)).toThrowError(/does not fit board/);
  });
});
