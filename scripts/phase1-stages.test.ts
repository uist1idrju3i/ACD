import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failureResult, requireProjectFile } from "./phase1-stages.mts";

describe("phase 1 stage failure evidence", () => {
  it("attributes a failure to the active stage", () => {
    const result = failureResult(
      { activeStage: { id: "gate:later", gate: 9, name: "routing" } } as never,
      new Error("routing failed"),
    );

    expect(result).toMatchObject({
      gate: 9,
      name: "routing",
      status: "failed",
      reason: "routing failed",
    });
  });

  it("reports a missing KiCad sidecar with a typed error", async () => {
    const root = await mkdtemp(join(tmpdir(), "acd-phase1-"));
    try {
      await expect(requireProjectFile(join(root, "design.kicad_prl"))).rejects.toMatchObject({
        name: "GraphCoreError",
        code: "reopen-failure",
      });
      await writeFile(join(root, "design.kicad_prl"), "{}");
      await expect(requireProjectFile(join(root, "design.kicad_prl"))).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
