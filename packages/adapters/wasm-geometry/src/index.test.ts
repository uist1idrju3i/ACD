import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGeometryChecks } from "@acd/graph-core";
import { loadWasmGeometryModule, runGeometryChecksWithFallback } from "./index.js";

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
    const wasmPath = resolve(
      import.meta.dirname,
      "../rust/target/wasm32-unknown-unknown/release/acd_geometry_wasm.wasm",
    );
    let wasmBytes: Buffer;
    try {
      wasmBytes = await readFile(wasmPath);
    } catch {
      throw new Error(`WASM未ビルドのため未検証: ${wasmPath}`);
    }
    const module = await loadWasmGeometryModule(wasmBytes, {
      moduleVersion: "0.1.0",
      buildDigest: `sha256:${createHash("sha256").update(wasmBytes).digest("hex")}`,
      toolchainVersion: "rustc 1.97.1",
    });
    const canonical = () =>
      fixture.cases.map(({ input: candidate }) => ({
        native: runGeometryChecks(candidate),
        wasm: runGeometryChecksWithFallback(candidate, module).results,
      }));
    const first = JSON.stringify(canonical());
    const second = JSON.stringify(canonical());
    expect(first).toBe(second);
    for (const { native, wasm } of canonical()) {
      expect(JSON.stringify(wasm)).toBe(JSON.stringify(native));
    }
    const execution = runGeometryChecksWithFallback(fixture.cases[0]!.input, module);
    expect(execution.provenance).toMatchObject({
      engine: "wasm",
      reason: "wasm-parity-verified",
      moduleVersion: "0.1.0",
    });
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

  it("stops deterministically on parity mismatch", () => {
    expect(() =>
      runGeometryChecksWithFallback(input, {
        moduleVersion: "0.1.0",
        buildDigest: "sha256:test",
        toolchainVersion: "rustc 1.97.1",
        run: () => ({
          padClearance: { status: "passed", findings: [] },
          maskSliver: { status: "passed", findings: [] },
          courtyardOverlap: { status: "passed", findings: [] },
        }),
      }),
    ).toThrow("parity mismatch");
  });
});
