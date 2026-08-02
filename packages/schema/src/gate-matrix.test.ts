import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  gateByOrder,
  gateMatrixSectionMatches,
  gatesForScope,
  gatesInExecutionOrder,
  loadGateMatrix,
  missingExecutedGates,
} from "./gate-matrix.js";
import { errorTaxonomyDataPath, gatesDocPath, phase1GatesDocPath } from "./paths.js";

const matrix = await loadGateMatrix();

describe("gate matrix", () => {
  it("has unique, contiguous orders and ids", () => {
    const orders = matrix.gates.map((gate) => gate.order).sort((left, right) => left - right);
    expect(orders).toEqual(orders.map((_, index) => index + 1));
    expect(new Set(matrix.gates.map((gate) => gate.id)).size).toBe(matrix.gates.length);
    expect(new Set(matrix.gates.map((gate) => gate.name)).size).toBe(matrix.gates.length);
  });

  it("references only known error codes", async () => {
    const taxonomy = JSON.parse(await readFile(errorTaxonomyDataPath, "utf8")) as {
      errors: { code: string }[];
    };
    const codes = new Set(taxonomy.errors.map((entry) => entry.code));
    for (const gate of matrix.gates) {
      for (const code of gate.errorCodes) expect(codes.has(code)).toBe(true);
    }
  });

  it("keeps the generated gate tables in sync with the matrix data", async () => {
    expect(
      gateMatrixSectionMatches(await readFile(phase1GatesDocPath, "utf8"), matrix, {
        phases: [0, 1],
      }),
    ).toBe(true);
    expect(gateMatrixSectionMatches(await readFile(gatesDocPath, "utf8"), matrix)).toBe(true);
  });

  it("runs a gate declaring runsAfter directly after the gate it names", () => {
    const orders = gatesInExecutionOrder(matrix).map((gate) => gate.order);
    expect(orders).toEqual([1, 2, 3, 4, 5, 14, 15, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(gateByOrder(matrix, 14).runsAfter).toBe("gate:netlist-consistency");
    expect(gateByOrder(matrix, 15).runsAfter).toBe("gate:electrical-lint");
  });

  it("scopes smoke to gates 1-11 and golden through pre-order readiness", () => {
    expect(gatesForScope(matrix, "smoke").map((gate) => gate.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(gatesForScope(matrix, "golden").map((gate) => gate.order)).toEqual([
      1, 2, 3, 4, 5, 14, 15, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(gateByOrder(matrix, 13).status).toBe("contract-only");
  });

  it("reports contracted gates a run skipped", () => {
    const executed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];
    expect(missingExecutedGates(matrix, "golden", executed)).toEqual([]);
    expect(
      missingExecutedGates(
        matrix,
        "golden",
        executed.filter((order) => order !== 14),
      ).map((gate) => gate.order),
    ).toEqual([14]);
    expect(
      missingExecutedGates(matrix, "golden", executed, {
        includeContractOnly: true,
      }).map((gate) => gate.order),
    ).toEqual([13]);
  });

  it("stops when an unknown gate order is requested", () => {
    expect(() => gateByOrder(matrix, 99)).toThrow(/reference-integrity/);
  });
});
