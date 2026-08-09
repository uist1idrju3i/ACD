import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGeometryChecks } from "@acd/graph-core";
import { runGeometryChecksWithFallback } from "./index.js";

const input = {
  pads: [
    {
      id: "pad:a:1",
      polygon: {
        points: [
          { xNm: 0, yNm: 0 },
          { xNm: 1, yNm: 0 },
          { xNm: 1, yNm: 1 },
        ],
      },
    },
  ],
  courtyards: [],
  thresholds: {},
};

describe("WASM geometry boundary", () => {
  it("keeps the parity fixture deterministic across two canonical runs", async () => {
    const fixture = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../../fixtures/phase4/wp7-geometry-parity/geometry-cases.json",
        ),
        "utf8",
      ),
    ) as {
      cases: Array<{ id: string; input: Parameters<typeof runGeometryChecks>[0] }>;
    };
    const nativeBytes = JSON.stringify(
      fixture.cases.map(({ input: candidate }) => runGeometryChecks(candidate)),
    );
    const wasmBytes = JSON.stringify(
      fixture.cases.map(
        ({ input: candidate }) =>
          runGeometryChecksWithFallback(candidate, {
            moduleVersion: "fixture",
            buildDigest: "fixture",
            toolchainVersion: "fixture",
            run: runGeometryChecks,
          }).results,
      ),
    );
    expect(wasmBytes).toBe(nativeBytes);
    expect(
      JSON.stringify(fixture.cases.map(({ input: candidate }) => runGeometryChecks(candidate))),
    ).toBe(nativeBytes);
    expect(
      runGeometryChecks(fixture.cases.find(({ id }) => id === "pad-clearance-violation")!.input)
        .padClearance.status,
    ).toBe("failed");
    expect(
      runGeometryChecks(fixture.cases.find(({ id }) => id === "mask-sliver-non-violation")!.input)
        .maskSliver.status,
    ).toBe("passed");
    expect(
      runGeometryChecks(fixture.cases.find(({ id }) => id === "canonical-data-missing")!.input)
        .courtyardOverlap.status,
    ).toBe("unknown");
  });

  it("falls back to native with explicit provenance when WASM is unavailable", () => {
    const execution = runGeometryChecksWithFallback(input);
    expect(execution.provenance).toMatchObject({
      engine: "native",
      reason: "wasm-module-unavailable",
    });
    expect(execution.results.padClearance.status).toBe("unknown");
  });

  it("accepts a parity-checked module and records its provenance", () => {
    const native = runGeometryChecksWithFallback(input).results;
    const execution = runGeometryChecksWithFallback(input, {
      moduleVersion: "0.1.0",
      buildDigest: "sha256:test",
      toolchainVersion: "rustc 1.97.1",
      run: () => native,
    });
    expect(execution.provenance).toMatchObject({
      engine: "wasm",
      reason: "wasm-parity-verified",
      buildDigest: "sha256:test",
    });
  });

  it("falls back deterministically on parity mismatch", () => {
    const execution = runGeometryChecksWithFallback(input, {
      moduleVersion: "0.1.0",
      buildDigest: "sha256:test",
      toolchainVersion: "rustc 1.97.1",
      run: () => ({
        padClearance: { status: "passed", findings: [] },
        maskSliver: { status: "passed", findings: [] },
        courtyardOverlap: { status: "passed", findings: [] },
      }),
    });
    expect(execution.provenance).toMatchObject({
      engine: "native",
      reason: "wasm-parity-mismatch",
    });
  });
});
