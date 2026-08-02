import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const fixtureNames = [
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
        expected: { outcome: string; jidoka: string; errorCode: string };
      };
      expect(fixture.taskId).toBe(`golden:${fixtureName}`);
      expect(fixture.expected.outcome).toBe("fail");
      expect(fixture.expected.jidoka).toBe("stop");
      expect(fixture.expected.errorCode).toMatch(/^[a-z-]+$/);
    });
  }
});
