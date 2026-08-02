import { createHash } from "node:crypto";
import { snapshotFiles, snapshotManifest } from "./library-snapshot.js";

export class KicadLibraryError extends Error {
  readonly code = "verification-failed";
  readonly name = "KicadLibraryError";
}

export type FootprintPad = {
  number: string;
  type: "smd" | "thru_hole";
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  drill?: number;
  layers: string[];
};

const blockAt = (text: string, start: number): string => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new KicadLibraryError(`unbalanced snapshot s-expression at offset ${start}`);
};

export const verifyLibrarySnapshot = (): void => {
  for (const entry of snapshotManifest.files) {
    const content = snapshotFiles[entry.path as keyof typeof snapshotFiles];
    if (!content) throw new KicadLibraryError(`missing library snapshot ${entry.path}`);
    const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (actual !== entry.contentHash) {
      throw new KicadLibraryError(`library snapshot hash mismatch for ${entry.path}`);
    }
  }
};

export const parseFootprintPads = (footprintName: string): FootprintPad[] => {
  const entry = snapshotManifest.files.find(
    (candidate) => candidate.kind === "footprint" && candidate.id === footprintName,
  );
  if (!entry) throw new KicadLibraryError(`missing footprint manifest entry ${footprintName}`);
  const source = snapshotFiles[entry.path as keyof typeof snapshotFiles];
  if (!source) throw new KicadLibraryError(`missing footprint snapshot ${entry.path}`);
  const pads: FootprintPad[] = [];
  let cursor = 0;
  while (true) {
    const start = source.indexOf('(pad "', cursor);
    if (start < 0) break;
    const block = blockAt(source, start);
    const header = block.match(/^\(pad "([^"]+)" ([^\s]+) ([^\s]+)/);
    const at = block.match(/\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+-?\d+(?:\.\d+)?)?\)/);
    const size = block.match(/\(size\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    const drill = block.match(/\(drill\s+(-?\d+(?:\.\d+)?)/);
    const layersBlock = block.match(/\(layers\s+([^)]*)\)/);
    if (!header || !at || !size || !layersBlock) {
      throw new KicadLibraryError(`unsupported pad construct in ${footprintName}`);
    }
    const [, number, type, shape] = header;
    const layerText = layersBlock[1];
    if (!number || !type || !shape || !layerText) {
      throw new KicadLibraryError(`unsupported pad construct in ${footprintName}`);
    }
    if (type !== "smd" && type !== "thru_hole") {
      throw new KicadLibraryError(`unsupported pad type ${type} in ${footprintName}`);
    }
    pads.push({
      number,
      type,
      shape,
      x: Number(at[1]),
      y: Number(at[2]),
      width: Number(size[1]),
      height: Number(size[2]),
      ...(drill?.[1] ? { drill: Number(drill[1]) } : {}),
      layers: layerText.match(/"[^"]+"/g)?.map((layer) => layer.slice(1, -1)) ?? [],
    });
    cursor = start + block.length;
  }
  if (pads.length === 0) throw new KicadLibraryError(`footprint ${footprintName} has no pads`);
  return pads;
};
