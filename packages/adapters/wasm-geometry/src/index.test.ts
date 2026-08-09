import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalize, runGeometryChecks } from "@acd/graph-core";
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
    const exportNames = WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes)).map(
      (entry) => entry.name,
    );
    expect(exportNames).toContain("__heap_base");
    const rawInstance = await WebAssembly.instantiate(wasmBytes, {});
    const rawExports = rawInstance.instance.exports as unknown as {
      memory: WebAssembly.Memory;
      __heap_base: WebAssembly.Global | number;
      acd_geometry_run: (
        inputPtr: number,
        inputLength: number,
        outputPtr: number,
        outputCapacity: number,
      ) => number;
      acd_geometry_module_version_ptr: () => number;
      acd_geometry_module_version_len: () => number;
    };
    const heapBase =
      typeof rawExports.__heap_base === "number"
        ? rawExports.__heap_base
        : Number(rawExports.__heap_base.value);
    expect(heapBase).toBeGreaterThan(1_048_840);
    const versionPtr = rawExports.acd_geometry_module_version_ptr();
    const versionLength = rawExports.acd_geometry_module_version_len();
    const versionBefore = [...new Uint8Array(rawExports.memory.buffer, versionPtr, versionLength)];
    const largeInputLength = 1024 * 1024;
    const largeOutputOffset = heapBase + largeInputLength;
    const requiredBytes = largeOutputOffset + largeInputLength;
    const requiredPages = Math.ceil(requiredBytes / 65_536);
    const currentPages = rawExports.memory.buffer.byteLength / 65_536;
    if (requiredPages > currentPages) rawExports.memory.grow(requiredPages - currentPages);
    new Uint8Array(rawExports.memory.buffer, heapBase, largeInputLength).fill(0xa5);
    rawExports.acd_geometry_run(heapBase, largeInputLength, largeOutputOffset, largeInputLength);
    const versionAfter = new Uint8Array(rawExports.memory.buffer, versionPtr, versionLength);
    expect([...versionAfter]).toEqual(versionBefore);
    const canonical = () =>
      fixture.cases.map(({ input: candidate }) => ({
        native: runGeometryChecks(candidate),
        wasm: runGeometryChecksWithFallback(candidate, module).results,
      }));
    const first = canonicalize(canonical());
    const second = canonicalize(canonical());
    expect(first).toBe(second);
    for (const { native, wasm } of canonical()) {
      expect(canonicalize(wasm)).toBe(canonicalize(native));
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
    const unsorted = fixture.cases.find(({ id }) => id === "pad-clearance-unsorted-subjects")!;
    expect(runGeometryChecks(unsorted.input).padClearance.findings[0]?.id).toBe(
      "finding:pad-clearance:pad:a:1:pad:z:1",
    );
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
