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
  rotation?: number;
  drill?: number;
  layers: string[];
  solderMaskMargin?: number;
};

export type FootprintBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  source: "courtyard" | "pad-bbox-fallback";
  regions?: Array<Omit<FootprintBounds, "source" | "regions">>;
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

export const parseFootprintSource = (footprintName: string, source: string): FootprintPad[] => {
  const footprintStart = source.indexOf(`(footprint "${footprintName}"`);
  const footprintSource = footprintStart >= 0 ? blockAt(source, footprintStart) : source;
  const pads: FootprintPad[] = [];
  let cursor = 0;
  while (true) {
    const start = footprintSource.indexOf('(pad "', cursor);
    if (start < 0) break;
    const block = blockAt(footprintSource, start);
    const header = block.match(/^\(pad "([^"]+)" ([^\s]+) ([^\s]+)/);
    const at = block.match(
      /\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?\)/,
    );
    const size = block.match(/\(size\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    const hasDrill = /\(drill(?:\s|\))/.test(block);
    const drill = block.match(/\(drill\s+(-?\d+(?:\.\d+)?)\s*\)/);
    const solderMaskMargin = block.match(/\(solder_mask_margin\s+(-?\d+(?:\.\d+)?)\s*\)/);
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
    if (hasDrill && !drill) {
      throw new KicadLibraryError(`unsupported drill construct in ${footprintName}`);
    }
    if (type === "thru_hole" && !drill) {
      throw new KicadLibraryError(`through-hole pad has no supported drill in ${footprintName}`);
    }
    pads.push({
      number,
      type,
      shape,
      x: Number(at[1]),
      y: Number(at[2]),
      width: Number(size[1]),
      height: Number(size[2]),
      ...(at[3] ? { rotation: Number(at[3]) } : {}),
      ...(drill?.[1] ? { drill: Number(drill[1]) } : {}),
      ...(solderMaskMargin?.[1] !== undefined
        ? { solderMaskMargin: Number(solderMaskMargin[1]) }
        : {}),
      layers: layerText.match(/"[^"]+"/g)?.map((layer) => layer.slice(1, -1)) ?? [],
    });
    cursor = start + block.length;
  }
  if (pads.length === 0) throw new KicadLibraryError(`footprint ${footprintName} has no pads`);
  return pads;
};

export const parseFootprintPads = (
  footprintName: string,
  sourceOverride?: string,
): FootprintPad[] => {
  const entry = snapshotManifest.files.find(
    (candidate) => candidate.kind === "footprint" && candidate.id === footprintName,
  );
  if (!entry) throw new KicadLibraryError(`missing footprint manifest entry ${footprintName}`);
  const source = sourceOverride ?? snapshotFiles[entry.path as keyof typeof snapshotFiles];
  if (!source) throw new KicadLibraryError(`missing footprint snapshot ${entry.path}`);
  return parseFootprintSource(footprintName, source);
};

export const parseFootprintCourtyardSource = (
  footprintName: string,
  source: string,
): FootprintBounds | undefined => {
  const values: Array<[number, number]> = [];
  const regions: Array<Omit<FootprintBounds, "source" | "regions">> = [];
  const shapePattern =
    /\((?:fp_rect|fp_line)[\s\S]*?\(start\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)[\s\S]*?\(end\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)[\s\S]*?\(layer\s+"F\.CrtYd"\)/g;
  for (const match of source.matchAll(shapePattern)) {
    values.push([Number(match[1]), Number(match[2])], [Number(match[3]), Number(match[4])]);
  }
  const rectPattern =
    /\(fp_rect[\s\S]*?\(start\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)[\s\S]*?\(end\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)[\s\S]*?\(layer\s+"F\.CrtYd"\)/g;
  for (const match of source.matchAll(rectPattern)) {
    values.push([Number(match[1]), Number(match[2])], [Number(match[3]), Number(match[4])]);
  }
  let polyCursor = 0;
  while (true) {
    const start = source.indexOf("(fp_poly", polyCursor);
    if (start < 0) break;
    const block = blockAt(source, start);
    if (/\(layer\s+"F\.CrtYd"\)/.test(block)) {
      const points = [...block.matchAll(/\(xy\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)/g)].map(
        (point) => [Number(point[1]), Number(point[2])] as [number, number],
      );
      for (const point of points) {
        values.push(point);
      }
      const ys = [...new Set(points.map(([, y]) => y))].sort((a, b) => a - b);
      for (let index = 0; index < ys.length - 1; index += 1) {
        const minY = ys[index]!;
        const maxY = ys[index + 1]!;
        const midY = (minY + maxY) / 2;
        const crossings: number[] = [];
        for (const [startX, startY] of points.map(
          (point, pointIndex) => [point, points[(pointIndex + 1) % points.length]!] as const,
        )) {
          const [x1, y1] = startX;
          const [x2, y2] = startY;
          if (y1 !== y2 && midY >= Math.min(y1, y2) && midY < Math.max(y1, y2)) {
            crossings.push(x1 + ((midY - y1) * (x2 - x1)) / (y2 - y1));
          }
        }
        crossings.sort((a, b) => a - b);
        for (let crossing = 0; crossing + 1 < crossings.length; crossing += 2) {
          regions.push({
            minX: crossings[crossing]!,
            maxX: crossings[crossing + 1]!,
            minY,
            maxY,
          });
        }
      }
    }
    polyCursor = start + block.length;
  }
  if (values.length === 0) return undefined;
  const xs = values.map(([x]) => x);
  const ys = values.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    source: "courtyard",
    ...(regions.length > 0 ? { regions } : {}),
  };
};

export const parseFootprintCourtyard = (
  footprintName: string,
  sourceOverride?: string,
): FootprintBounds | undefined => {
  const entry = snapshotManifest.files.find(
    (candidate) => candidate.kind === "footprint" && candidate.id === footprintName,
  );
  if (!entry) throw new KicadLibraryError(`missing footprint manifest entry ${footprintName}`);
  const source = sourceOverride ?? snapshotFiles[entry.path as keyof typeof snapshotFiles];
  if (!source) throw new KicadLibraryError(`missing footprint snapshot ${entry.path}`);
  return parseFootprintCourtyardSource(footprintName, source);
};
