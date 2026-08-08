import { createHash } from "node:crypto";

export type PipelineStage = {
  id: string;
  gate: number;
  execute: () => Promise<Record<string, unknown>>;
};

export type PipelineStageResult = {
  id: string;
  gate: number;
  evidence: Record<string, unknown>;
};

/** Hashes artifact content using the historical raw-byte/raw-text semantics. */
export const rawSha256 = (content: string | Buffer): string =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

export const normalizedArtifact = (content: Buffer): Buffer =>
  Buffer.from(
    content
      .toString("utf8")
      .replace(/(%TF\.CreationDate,|Created on |CreationDate,)[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/("CreationDate":\s*)"[^"]*"/g, '$1"TIMESTAMP"')
      .replace(/(G04 Created by KiCad .* date )[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/(; DRILL file KiCad .* date )[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/(; #@! TF\.CreationDate,)[^\r\n]*/g, "$1TIMESTAMP")
      .replace(/(ERC report \()[^,\r\n]+(, Encoding UTF8\))/g, "$1TIMESTAMP$2")
      .replace(/(\(date\s+")[^"]+("\))/g, "$1TIMESTAMP$2")
      .replace(/("sha256":\s*)"[^"]+",(\s*"normalizedSha256":\s*")([^"]+)(")/g, '$1"$3",$2$3$4'),
  );

export const runPipelineStages = async (
  stages: readonly PipelineStage[],
  completedStageIds: ReadonlySet<string> = new Set(),
): Promise<PipelineStageResult[]> => {
  const results: PipelineStageResult[] = [];
  for (const stage of stages) {
    if (completedStageIds.has(stage.id)) continue;
    results.push({ id: stage.id, gate: stage.gate, evidence: await stage.execute() });
  }
  return results;
};
