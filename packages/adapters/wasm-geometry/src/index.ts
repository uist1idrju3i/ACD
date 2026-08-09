import {
  runGeometryChecks,
  type GeometryCheckInput,
  type GeometryCheckResults,
} from "@acd/graph-core";

export type GeometryEngineProvenance = {
  engine: "native" | "wasm";
  reason: string;
  moduleVersion: string;
  buildDigest: string;
  toolchainVersion: string;
};

export type GeometryExecution = {
  results: GeometryCheckResults;
  provenance: GeometryEngineProvenance;
};

export type WasmGeometryModule = {
  moduleVersion: string;
  buildDigest: string;
  toolchainVersion: string;
  run(input: GeometryCheckInput): GeometryCheckResults;
};

const nativeProvenance = (reason: string): GeometryEngineProvenance => ({
  engine: "native",
  reason,
  moduleVersion: "unavailable",
  buildDigest: "unavailable",
  toolchainVersion: "unavailable",
});

export const runGeometryChecksWithFallback = (
  input: GeometryCheckInput,
  wasmModule?: WasmGeometryModule,
): GeometryExecution => {
  const native = runGeometryChecks(input);
  if (!wasmModule) {
    return { results: native, provenance: nativeProvenance("wasm-module-unavailable") };
  }
  const wasm = wasmModule.run(input);
  if (JSON.stringify(wasm) !== JSON.stringify(native)) {
    return {
      results: native,
      provenance: nativeProvenance("wasm-parity-mismatch"),
    };
  }
  return {
    results: wasm,
    provenance: {
      engine: "wasm",
      reason: "wasm-parity-verified",
      moduleVersion: wasmModule.moduleVersion,
      buildDigest: wasmModule.buildDigest,
      toolchainVersion: wasmModule.toolchainVersion,
    },
  };
};
