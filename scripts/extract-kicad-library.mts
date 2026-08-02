import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const image = "kicad/kicad@sha256:182c8005cb775a2c448a4c18681d489f1ff472a761885eba3e08b07e3c0564de";
const libraryRoot = join(root, "packages/adapters/kicad/library-snapshot");
const fixturePath = join(root, "fixtures/phase1/smoke.json");
const license = "CC-BY-SA-4.0-with-exception";

type Fixture = {
  mappings: Array<{
    partId: string;
    symbolLibraryId: string;
    symbolName: string;
    footprintLibraryId: string;
    footprintName: string;
    provenance: Record<string, unknown>;
  }>;
};

type Pad = {
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

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const dockerRead = (path: string): string =>
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--user",
      "root",
      "-e",
      "HOME=/tmp",
      "-e",
      "KICAD_CONFIG_HOME=/tmp/kicad-config",
      image,
      "cat",
      path,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

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
  throw new Error(`unbalanced s-expression at offset ${start}`);
};

const namedSymbol = (source: string, libraryId: string, symbolName: string): string => {
  const localMarker = `(symbol "${symbolName}"`;
  const qualifiedMarker = `(symbol "${libraryId}:${symbolName}"`;
  const start = source.indexOf(localMarker);
  const qualifiedStart = source.indexOf(qualifiedMarker);
  if (start < 0 && qualifiedStart < 0) {
    throw new Error(`missing official symbol ${libraryId}:${symbolName}`);
  }
  const block = blockAt(source, qualifiedStart >= 0 ? qualifiedStart : start);
  if (qualifiedStart >= 0) return block;
  return block.replace(localMarker, qualifiedMarker);
};

const parsePads = (source: string, footprintName: string): Pad[] => {
  const pads: Pad[] = [];
  let cursor = 0;
  while (true) {
    const start = source.indexOf('(pad "', cursor);
    if (start < 0) break;
    const block = blockAt(source, start);
    const header = block.match(/^\(pad "([^"]+)" ([^\s]+) ([^\s]+)/);
    const at = block.match(/\(at\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)(?:\s+-?\d+(?:\.\d+)?)?\)/);
    const size = block.match(/\(size\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
    const hasDrill = /\(drill(?:\s|\))/.test(block);
    const drill = block.match(/\(drill\s+(-?\d+(?:\.\d+)?)\s*\)/);
    const layersBlock = block.match(/\(layers\s+([^)]*)\)/);
    if (!header || !at || !size || !layersBlock) {
      throw new Error(`unsupported pad construct in ${footprintName}`);
    }
    const [, number, type, shape] = header;
    if (type !== "smd" && type !== "thru_hole") {
      throw new Error(`unsupported pad type ${type} in ${footprintName}`);
    }
    if (hasDrill && !drill) {
      throw new Error(`unsupported drill construct in ${footprintName}`);
    }
    if (type === "thru_hole" && !drill) {
      throw new Error(`through-hole pad has no supported drill in ${footprintName}`);
    }
    pads.push({
      number,
      type,
      shape,
      x: Number(at[1]),
      y: Number(at[2]),
      width: Number(size[1]),
      height: Number(size[2]),
      drill: drill?.[1] ? Number(drill[1]) : undefined,
      layers: layersBlock[1].match(/"[^"]+"/g)?.map((layer) => layer.slice(1, -1)) ?? [],
    });
    cursor = start + block.length;
  }
  if (pads.length === 0) throw new Error(`footprint ${footprintName} has no pads`);
  return pads;
};

const main = async (): Promise<void> => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const uniqueSymbols = [
    ...new Map(
      fixture.mappings.map((mapping) => [
        `${mapping.symbolLibraryId}:${mapping.symbolName}`,
        mapping,
      ]),
    ).values(),
  ];
  const uniqueFootprints = [
    ...new Map(
      fixture.mappings.map((mapping) => [
        `${mapping.footprintLibraryId}:${mapping.footprintName}`,
        mapping,
      ]),
    ).values(),
  ];
  const symbolRequests = [
    ...uniqueSymbols.map((mapping) => ({
      symbolLibraryId: mapping.symbolLibraryId,
      symbolName: mapping.symbolName,
    })),
    { symbolLibraryId: "power", symbolName: "PWR_FLAG" },
  ];
  const files: Record<string, string> = {};
  const manifestEntries: Array<Record<string, unknown>> = [];
  const symbolBlocks: string[] = [];

  for (const mapping of symbolRequests) {
    const symbolPath = `/usr/share/kicad/symbols/${mapping.symbolLibraryId}.kicad_sym`;
    const symbolSource = dockerRead(symbolPath);
    const symbolBlock = namedSymbol(symbolSource, mapping.symbolLibraryId, mapping.symbolName);
    const symbolRelative = `symbols/${mapping.symbolLibraryId}_${mapping.symbolName}.kicad_sym`;
    files[symbolRelative] = symbolBlock;
    symbolBlocks.push(symbolBlock);
    manifestEntries.push({
      kind: "symbol",
      id: `${mapping.symbolLibraryId}:${mapping.symbolName}`,
      path: symbolRelative,
      source: symbolPath,
      sourceUrl: "https://gitlab.com/kicad/libraries/kicad-symbols",
      version: "10.0.5",
      containerDigest: image.split("@")[1],
      license,
      contentHash: sha256(symbolBlock),
    });
  }

  const footprintHashes = new Map<string, string>();
  for (const mapping of uniqueFootprints) {
    const sourcePath = `/usr/share/kicad/footprints/${mapping.footprintLibraryId}.pretty/${mapping.footprintName}.kicad_mod`;
    const footprintSource = dockerRead(sourcePath);
    parsePads(footprintSource, mapping.footprintName);
    const footprintRelative = `footprints/${mapping.footprintName}.kicad_mod`;
    files[footprintRelative] = footprintSource;
    const contentHash = sha256(footprintSource);
    footprintHashes.set(`${mapping.footprintLibraryId}:${mapping.footprintName}`, contentHash);
    manifestEntries.push({
      kind: "footprint",
      id: mapping.footprintName,
      path: footprintRelative,
      source: sourcePath,
      sourceUrl: "https://gitlab.com/kicad/libraries/kicad-footprints",
      version: "10.0.5",
      containerDigest: image.split("@")[1],
      license,
      contentHash,
    });
  }

  for (const mapping of fixture.mappings) {
    const contentHash = footprintHashes.get(
      `${mapping.footprintLibraryId}:${mapping.footprintName}`,
    );
    if (!contentHash) {
      throw new Error(`missing extracted footprint hash for ${mapping.footprintName}`);
    }
    mapping.provenance = {
      source: "KiCad official libraries",
      version: "10.0.5",
      license,
      contentHash,
    };
  }

  for (const [path, content] of Object.entries(files)) {
    const target = join(libraryRoot, path);
    await writeFile(target, content, "utf8");
  }
  const manifest = {
    schemaVersion: "1.0.0",
    status: "pinned",
    container: {
      image: "kicad/kicad:10.0",
      version: "10.0.5",
      digest: image.split("@")[1],
      source: "https://hub.docker.com/r/kicad/kicad",
      license: "GPL-3.0-or-later",
    },
    license,
    sources: {
      symbols: "https://gitlab.com/kicad/libraries/kicad-symbols",
      footprints: "https://gitlab.com/kicad/libraries/kicad-footprints",
    },
    files: manifestEntries,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(libraryRoot, "manifest.json"), manifestText, "utf8");
  await writeFile(join(root, "spikes/kicad-library/manifest.json"), manifestText, "utf8");
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  execFileSync("pnpm", ["exec", "prettier", "--write", fixturePath], {
    cwd: root,
    stdio: "ignore",
  });

  const snapshotModule = `/* Generated by scripts/extract-kicad-library.mts. Do not edit by hand. */\nexport const snapshotManifest = ${JSON.stringify(manifest)} as const;\nexport const snapshotFiles = ${JSON.stringify(files)} as const;\nexport const smokeLibrarySymbols = ${JSON.stringify(symbolBlocks.join("\n"))};\n`;
  const snapshotModulePath = join(root, "packages/adapters/kicad/src/library-snapshot.ts");
  await writeFile(snapshotModulePath, snapshotModule, "utf8");
  console.log(`extracted ${manifestEntries.length} pinned library files`);
  console.log(`snapshot module: ${relative(root, snapshotModulePath)}`);
};

await main();
