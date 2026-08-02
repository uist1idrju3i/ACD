import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const snapshotRoot = join(root, "packages/adapters/kicad/library-snapshot");
const manifest = JSON.parse(await readFile(join(snapshotRoot, "manifest.json"), "utf8")) as {
  files: Array<{ path: string; contentHash: string }>;
};

for (const entry of manifest.files) {
  const content = await readFile(join(snapshotRoot, entry.path));
  const actual = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  if (actual !== entry.contentHash) {
    throw new Error(`library snapshot hash mismatch for ${entry.path}`);
  }
}

console.log(`verified ${manifest.files.length} KiCad library snapshot files`);
