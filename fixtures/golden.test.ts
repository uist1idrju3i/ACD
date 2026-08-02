import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../packages/graph-core/src/index.js";

const fixtureNames = [
  "normal-2layer",
  "erc-fail",
  "drc-fail",
  "patch-conflict",
  "stale-result",
  "reopen-fail",
] as const;

type GoldenFixture = {
  taskId: string;
  kind: string;
  inputFixture: string;
  expected: { outcome: string; jidoka: string; errorCode: string | null; gate?: string };
  scenario: Record<string, unknown>;
};

const readFixture = async (fixtureName: string): Promise<GoldenFixture> =>
  JSON.parse(
    await readFile(new URL(`./golden/${fixtureName}.json`, import.meta.url), "utf8"),
  ) as GoldenFixture;

describe("golden task fixtures", () => {
  for (const fixtureName of fixtureNames) {
    it(`defines the expected jidoka outcome for ${fixtureName}`, async () => {
      const fixture = await readFixture(fixtureName);

      expect(fixture.taskId).toBe(`golden:${fixtureName}`);
      expect(["verification", "patch", "tool"]).toContain(fixture.kind);
      expect(["pass", "fail"]).toContain(fixture.expected.outcome);
      expect(["continue", "stop"]).toContain(fixture.expected.jidoka);
      expect(fixture.inputFixture).toBe("design-graphs/normal-2layer.json");
      if (fixture.expected.errorCode === null) {
        expect(fixture.expected.outcome).toBe("pass");
        expect(fixture.expected.jidoka).toBe("continue");
      } else {
        expect(ERROR_CODES).toContain(fixture.expected.errorCode);
        expect(fixture.expected.outcome).toBe("fail");
        expect(fixture.expected.jidoka).toBe("stop");
      }
    });
  }

  it("documents the injected mutation for every failure fixture", async () => {
    for (const fixtureName of ["erc-fail", "drc-fail", "reopen-fail"]) {
      const fixture = await readFixture(fixtureName);
      expect(typeof fixture.scenario["mutation"]).toBe("string");
      expect(typeof fixture.expected.gate).toBe("string");
    }
  });
});
