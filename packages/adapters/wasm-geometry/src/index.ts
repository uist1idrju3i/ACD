import {
  GraphCoreError,
  canonicalize,
  runGeometryChecks,
  type GeometryCheckInput,
  type GeometryCheckResult,
  type GeometryCheckResults,
  type GeometryFinding,
} from "@acd/graph-core";

const INPUT_MAGIC = 0xacd70001n;
const OUTPUT_MAGIC = 0xacd70002n;
const UNKNOWN = 0n;
const PASSED = 1n;
const FAILED = 2n;
const UNAVAILABLE_THRESHOLD = -1n;
const UNKNOWN_CANONICAL_DATA = 1n;
const UNKNOWN_CONNECTIVITY = 2n;
const OUTPUT_CAPACITY = 16 * 1024 * 1024;

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

type WasmExports = {
  memory: WebAssembly.Memory;
  __heap_base: WebAssembly.Global | number;
  acd_geometry_run: (
    inputPtr: number,
    inputLength: number,
    outputPtr: number,
    outputCapacity: number,
  ) => number;
};

const nativeProvenance = (reason: string): GeometryEngineProvenance => ({
  engine: "native",
  reason,
  moduleVersion: "unavailable",
  buildDigest: "unavailable",
  toolchainVersion: "unavailable",
});

const assertI64 = (value: number, name: string): bigint => {
  if (
    !Number.isSafeInteger(value) ||
    value < Number.MIN_SAFE_INTEGER ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new GraphCoreError("verification-failed", `${name} is outside the safe integer range`);
  }
  return BigInt(value);
};

class PackedWriter {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
  }

  write(value: bigint): void {
    if (this.offset + 8 > this.buffer.byteLength) {
      throw new GraphCoreError("verification-failed", "geometry packed input exceeds buffer");
    }
    this.view.setBigInt64(this.offset, value, true);
    this.offset += 8;
  }

  get length(): number {
    return this.offset;
  }
}

const writeThreshold = (writer: PackedWriter, value: number | undefined): void => {
  writer.write(value === undefined ? UNAVAILABLE_THRESHOLD : assertI64(value, "threshold"));
};

const encodeInput = (input: GeometryCheckInput): Uint8Array => {
  const bytes = new ArrayBuffer(16 * 1024 * 1024);
  const writer = new PackedWriter(bytes);
  const netIds = [...new Set(input.pads.flatMap((pad) => (pad.netId ? [pad.netId] : [])))].sort();
  const layers = [
    ...new Set([
      ...input.pads.flatMap((pad) => (pad.layer ? [pad.layer] : [])),
      ...input.courtyards.flatMap((courtyard) => (courtyard.layer ? [courtyard.layer] : [])),
    ]),
  ].sort();
  const ordinal = (values: string[], value: string | undefined): bigint =>
    value === undefined ? -1n : BigInt(values.indexOf(value));
  writer.write(INPUT_MAGIC);
  writer.write(BigInt(input.pads.length));
  writer.write(BigInt(input.courtyards.length));
  writeThreshold(writer, input.thresholds.minimumCopperClearanceNm);
  writeThreshold(writer, input.thresholds.minimumMaskSliverNm);
  writeThreshold(writer, input.thresholds.minimumCourtyardClearanceNm);
  for (const pad of input.pads) {
    writer.write(BigInt(pad.polygon.points.length));
    for (const point of pad.polygon.points) {
      writer.write(assertI64(point.xNm, "pad xNm"));
      writer.write(assertI64(point.yNm, "pad yNm"));
    }
    writer.write(
      pad.maskExpansionNm === undefined
        ? UNAVAILABLE_THRESHOLD
        : assertI64(pad.maskExpansionNm, "maskExpansionNm"),
    );
    writer.write(ordinal(netIds, pad.netId));
    writer.write(ordinal(layers, pad.layer));
  }
  for (const courtyard of input.courtyards) {
    writer.write(BigInt(courtyard.polygon.points.length));
    for (const point of courtyard.polygon.points) {
      writer.write(assertI64(point.xNm, "courtyard xNm"));
      writer.write(assertI64(point.yNm, "courtyard yNm"));
    }
    writer.write(ordinal(layers, courtyard.layer));
  }
  return new Uint8Array(bytes, 0, writer.length);
};

class PackedReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  read(): bigint {
    if (this.offset + 8 > this.bytes.byteLength) {
      throw new GraphCoreError("verification-failed", "geometry packed output is truncated");
    }
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  assertComplete(): void {
    if (this.offset !== this.bytes.byteLength) {
      throw new GraphCoreError("verification-failed", "geometry packed output has trailing data");
    }
  }
}

const toNumber = (value: bigint, name: string): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new GraphCoreError("verification-failed", `${name} is outside the safe integer range`);
  }
  return number;
};

const decodeResult = (
  reader: PackedReader,
  ruleId: GeometryFinding["ruleId"],
  subjects: (left: number, right: number) => string[],
): GeometryCheckResult => {
  const status = reader.read();
  const reason = reader.read();
  const findingCount = toNumber(reader.read(), `${ruleId} finding count`);
  if (findingCount < 0) {
    throw new GraphCoreError("verification-failed", `${ruleId} finding count is negative`);
  }
  if (status === UNKNOWN) {
    if (
      findingCount !== 0 ||
      (reason !== UNKNOWN_CANONICAL_DATA && reason !== UNKNOWN_CONNECTIVITY)
    ) {
      throw new GraphCoreError("verification-failed", `${ruleId} unknown result contains findings`);
    }
    return {
      status: "unknown",
      reason:
        reason === UNKNOWN_CONNECTIVITY
          ? "pad-connectivity-not-provided"
          : "canonical-data-not-provided",
      findings: [],
    };
  }
  if (status !== PASSED && status !== FAILED) {
    throw new GraphCoreError("verification-failed", `${ruleId} returned an invalid status`);
  }
  const findings: GeometryFinding[] = [];
  for (let index = 0; index < findingCount; index += 1) {
    const left = toNumber(reader.read(), `${ruleId} finding left index`);
    const right = toNumber(reader.read(), `${ruleId} finding right index`);
    const measuredNm = toNumber(reader.read(), `${ruleId} measuredNm`);
    const thresholdNm = toNumber(reader.read(), `${ruleId} thresholdNm`);
    const subjectIds = subjects(left, right).sort();
    findings.push({
      id: `finding:${ruleId === "mask-sliver" && measuredNm === 0 ? "mask-fusion" : ruleId}:${subjectIds.join(":")}`,
      ruleId: ruleId === "mask-sliver" && measuredNm === 0 ? "mask-fusion" : ruleId,
      status: "violation",
      subjectIds,
      measuredNm,
      thresholdNm,
    });
  }
  findings.sort((left, right) => left.id.localeCompare(right.id));
  const expectedStatus = findings.length === 0 ? "passed" : "failed";
  if ((status === PASSED ? "passed" : "failed") !== expectedStatus) {
    throw new GraphCoreError("verification-failed", `${ruleId} status does not match findings`);
  }
  return { status: expectedStatus, findings };
};

const decodeResults = (bytes: Uint8Array, input: GeometryCheckInput): GeometryCheckResults => {
  const reader = new PackedReader(bytes);
  if (reader.read() !== OUTPUT_MAGIC) {
    throw new GraphCoreError("verification-failed", "geometry packed output has an invalid magic");
  }
  const padSubjects = (left: number, right: number): string[] => {
    const a = input.pads[left];
    const b = input.pads[right];
    if (!a || !b)
      throw new GraphCoreError("verification-failed", "WASM returned an invalid pad index");
    return [a.id, b.id];
  };
  const courtyardSubjects = (left: number, right: number): string[] => {
    const a = input.courtyards[left];
    const b = input.courtyards[right];
    if (!a || !b) {
      throw new GraphCoreError("verification-failed", "WASM returned an invalid courtyard index");
    }
    return [a.componentId, b.componentId];
  };
  const results = {
    padClearance: decodeResult(reader, "pad-clearance", padSubjects),
    maskSliver: decodeResult(reader, "mask-sliver", padSubjects),
    courtyardOverlap: decodeResult(reader, "courtyard-overlap", courtyardSubjects),
  };
  reader.assertComplete();
  return results;
};

const instantiateModule = (
  bytes: ArrayBuffer,
  moduleVersion: string,
  buildDigest: string,
  toolchainVersion: string,
): Promise<WasmGeometryModule> =>
  WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
    const exports = instance.exports as unknown as Partial<WasmExports>;
    if (
      !exports.memory ||
      typeof exports.acd_geometry_run !== "function" ||
      exports.__heap_base === undefined
    ) {
      throw new GraphCoreError("verification-failed", "WASM geometry ABI exports are incomplete");
    }
    const heapBase =
      typeof exports.__heap_base === "number"
        ? exports.__heap_base
        : Number(exports.__heap_base.value);
    if (!Number.isSafeInteger(heapBase) || heapBase <= 0) {
      throw new GraphCoreError("verification-failed", "WASM geometry ABI heap base is invalid");
    }
    const run = (input: GeometryCheckInput): GeometryCheckResults => {
      const encoded = encodeInput(input);
      const inputOffset = heapBase;
      const outputOffset = inputOffset + encoded.byteLength;
      const requiredBytes = outputOffset + OUTPUT_CAPACITY;
      const pageSize = 64 * 1024;
      const requiredPages = Math.ceil(requiredBytes / pageSize);
      if (exports.memory!.buffer.byteLength < requiredBytes) {
        exports.memory!.grow(requiredPages - exports.memory!.buffer.byteLength / pageSize);
      }
      new Uint8Array(exports.memory!.buffer, inputOffset, encoded.byteLength).set(encoded);
      const outputLength = exports.acd_geometry_run!(
        inputOffset,
        encoded.byteLength,
        outputOffset,
        OUTPUT_CAPACITY,
      );
      if (outputLength < 0 || outputLength > OUTPUT_CAPACITY) {
        throw new GraphCoreError(
          "verification-failed",
          `WASM geometry returned error ${outputLength}`,
        );
      }
      return decodeResults(
        new Uint8Array(exports.memory!.buffer, outputOffset, outputLength),
        input,
      );
    };
    return { moduleVersion, buildDigest, toolchainVersion, run };
  });

export const loadWasmGeometryModule = async (
  bytes: ArrayBuffer,
  metadata: Omit<GeometryEngineProvenance, "engine" | "reason">,
): Promise<WasmGeometryModule> =>
  instantiateModule(bytes, metadata.moduleVersion, metadata.buildDigest, metadata.toolchainVersion);

export const runGeometryChecksWithFallback = (
  input: GeometryCheckInput,
  wasmModule?: WasmGeometryModule,
): GeometryExecution => {
  const native = runGeometryChecks(input);
  if (!wasmModule) {
    return { results: native, provenance: nativeProvenance("wasm-module-unavailable") };
  }
  const wasm = wasmModule.run(input);
  if (canonicalize(wasm) !== canonicalize(native)) {
    throw new GraphCoreError(
      "verification-failed",
      "WASM/native geometry parity mismatch; execution stopped",
      "critical",
      { engine: "wasm", reason: "wasm-parity-mismatch" },
    );
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
