import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const fixtureNames = [
  "normal-2layer",
  "erc-fail",
  "drc-fail",
  "patch-conflict",
  "stale-result",
  "reopen-fail",
] as const;

describe("golden task fixtures", () => {
  for (const fixtureName of fixtureNames) {
    it(`defines the expected jidoka outcome for ${fixtureName}`, async () => {
      const fixture = JSON.parse(
        await readFile(new URL(`./golden/${fixtureName}.json`, import.meta.url), "utf8"),
      ) as {
        taskId: string;
        expected: { outcome: string; jidoka: string; errorCode: string | null };
      };
      expect(fixture.taskId).toBe(`golden:${fixtureName}`);
      expect(["pass", "fail"]).toContain(fixture.expected.outcome);
      expect(["continue", "stop"]).toContain(fixture.expected.jidoka);
      if (fixture.expected.errorCode !== null)
        expect(fixture.expected.errorCode).toMatch(/^[a-z-]+$/);
    });
  }
});
