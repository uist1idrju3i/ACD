import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const snapshotRoot = join(root, "packages/adapters/kicad/library-snapshot");
const manifestText = await readFile(join(snapshotRoot, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText) as {
  files: Array<{ path: string; contentHash: string }>;
};
const embedded = await import("../packages/adapters/kicad/src/library-snapshot.ts");

if (JSON.stringify(embedded.snapshotManifest) !== JSON.stringify(manifest)) {
  throw new Error("generated library snapshot manifest differs from committed manifest");
}

const duplicateManifestText = await readFile(
  join(root, "spikes/kicad-library/manifest.json"),
  "utf8",
);
if (duplicateManifestText !== manifestText) {
  throw new Error("spikes/kicad-library/manifest.json differs from committed manifest");
}

for (const entry of manifest.files) {
  const content = await readFile(join(snapshotRoot, entry.path), "utf8");
  const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actual !== entry.contentHash) {
    throw new Error(`library snapshot hash mismatch for ${entry.path}`);
  }
  if (embedded.snapshotFiles[entry.path as keyof typeof embedded.snapshotFiles] !== content) {
    throw new Error(`generated library snapshot differs for ${entry.path}`);
  }
}

const manifestPaths = new Set(manifest.files.map((entry) => entry.path));
const snapshotPaths = (await readdir(snapshotRoot, { recursive: true }))
  .filter((path) => path !== "manifest.json")
  .map((path) => path.replaceAll("\\", "/"));
const orphanedPaths = snapshotPaths.filter((path) => !manifestPaths.has(path));
if (orphanedPaths.length > 0) {
  throw new Error(`orphaned library snapshot files: ${orphanedPaths.join(", ")}`);
}

console.log(`verified ${manifest.files.length} KiCad library snapshot files`);
