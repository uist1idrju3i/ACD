import { readFile } from "node:fs/promises";
import { gateMatrixDataPath } from "./paths.js";
import type { ACDGateMatrix as GateMatrix } from "./generated/gate-matrix.js";

export type GateDefinition = GateMatrix["gates"][number];
export type GateScope = GateDefinition["appliesTo"][number];

export const loadGateMatrix = async (): Promise<GateMatrix> =>
  JSON.parse(await readFile(gateMatrixDataPath, "utf8")) as GateMatrix;

/**
 * Orders gates for execution. `order` is the stable gate number used by documentation
 * and evidence; a gate declaring `runsAfter` executes directly after the gate it names,
 * so a later phase can insert a gate without renumbering the existing contract.
 */
export const gatesInExecutionOrder = (matrix: GateMatrix): GateDefinition[] => {
  const byId = new Map(matrix.gates.map((gate) => [gate.id, gate]));
  const followers = new Map<string, GateDefinition[]>();
  for (const gate of matrix.gates) {
    if (gate.runsAfter === undefined) continue;
    if (!byId.has(gate.runsAfter)) {
      throw new Error(
        `reference-integrity: gate ${gate.id} runs after unknown gate ${gate.runsAfter}`,
      );
    }
    followers.set(gate.runsAfter, [...(followers.get(gate.runsAfter) ?? []), gate]);
  }
  const ordered: GateDefinition[] = [];
  const append = (gate: GateDefinition): void => {
    if (ordered.includes(gate)) throw new Error(`reference-integrity: gate ${gate.id} is cyclic`);
    ordered.push(gate);
    for (const follower of [...(followers.get(gate.id) ?? [])].sort(
      (left, right) => left.order - right.order,
    )) {
      append(follower);
    }
  };
  for (const gate of [...matrix.gates].sort((left, right) => left.order - right.order)) {
    if (gate.runsAfter === undefined) append(gate);
  }
  if (ordered.length !== matrix.gates.length) {
    throw new Error("reference-integrity: gate matrix execution order is incomplete");
  }
  return ordered;
};

export const gatesForScope = (matrix: GateMatrix, scope: GateScope): GateDefinition[] =>
  gatesInExecutionOrder(matrix).filter((gate) => gate.appliesTo.includes(scope));

export const gateByOrder = (matrix: GateMatrix, order: number): GateDefinition => {
  const gate = matrix.gates.find((candidate) => candidate.order === order);
  if (!gate) throw new Error(`reference-integrity: gate matrix has no gate with order ${order}`);
  return gate;
};

/**
 * Reports the gate matrix rows a run must still execute. Callers stop on a
 * non-empty result so a runner cannot silently skip a contracted gate.
 */
export const missingExecutedGates = (
  matrix: GateMatrix,
  scope: GateScope,
  executedOrders: readonly number[],
  { includeContractOnly = false }: { includeContractOnly?: boolean } = {},
): GateDefinition[] =>
  gatesForScope(matrix, scope)
    .filter(
      (gate) =>
        gate.status === "implemented" || (includeContractOnly && gate.status === "contract-only"),
    )
    .filter((gate) => !executedOrders.includes(gate.order));

export const gateMatrixSectionStart = "<!-- generated:gate-matrix:start -->";
export const gateMatrixSectionEnd = "<!-- generated:gate-matrix:end -->";

const columns = ["順序", "Gate", "Phase", "状態", "適用", "入力", "合格条件", "不合格時"];

export type GateTableOptions = { phases?: readonly number[] };

export const renderGateMatrixTable = (
  matrix: GateMatrix,
  { phases }: GateTableOptions = {},
): string => {
  const rows = gatesInExecutionOrder(matrix)
    .filter((gate) => phases === undefined || phases.includes(gate.phase))
    .map((gate) =>
      [
        String(gate.order),
        gate.name,
        String(gate.phase),
        gate.status,
        gate.appliesTo.join("／"),
        gate.inputs,
        gate.passCondition,
        gate.onFailure,
      ].join(" | "),
    );
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
};

export const replaceGateMatrixSection = (document: string, table: string): string => {
  const start = document.indexOf(gateMatrixSectionStart);
  const end = document.indexOf(gateMatrixSectionEnd);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("reference-integrity: gate matrix markers are missing in the document");
  }
  return `${document.slice(0, start)}${gateMatrixSectionStart}\n\n${table}\n\n${document.slice(end)}`;
};

const normalizeTable = (table: string): string[][] =>
  table
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));

/** Compares a document's generated section with the matrix, ignoring table padding. */
export const gateMatrixSectionMatches = (
  document: string,
  matrix: GateMatrix,
  options: GateTableOptions = {},
): boolean => {
  const start = document.indexOf(gateMatrixSectionStart);
  const end = document.indexOf(gateMatrixSectionEnd);
  if (start < 0 || end < 0 || end < start) return false;
  const section = document.slice(start + gateMatrixSectionStart.length, end);
  return (
    JSON.stringify(normalizeTable(section)) ===
    JSON.stringify(normalizeTable(renderGateMatrixTable(matrix, options)))
  );
};

export type { GateMatrix };
