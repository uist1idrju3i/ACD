import { describe, expect, it } from "vitest";
import { fabProfileRules, maskSliverReproductionCondition } from "./fab-profile-rules.js";

describe("fab profile rules", () => {
  it("derives the mask-sliver reproduction condition from its minimum", () => {
    const rule = fabProfileRules
      .find((profile) => profile.profileId === "fab:jlcpcb-class-2layer")
      ?.rules.find((candidate) => candidate.ruleId === "mask-sliver-min");

    expect(rule?.minimumSliverMm).toBe(0.3);
    expect(rule?.reproductionConditions).toContain(
      maskSliverReproductionCondition(rule?.minimumSliverMm ?? 0),
    );
  });
});
