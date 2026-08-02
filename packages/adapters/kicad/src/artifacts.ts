import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type ArtifactHash = {
  path: string;
  filename: string;
  sha256: string;
  bytes: number;
};

export const hashFile = async (path: string): Promise<ArtifactHash> => {
  const content = await readFile(path);
  return {
    path,
    filename: basename(path),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  };
};

export const hashFiles = async (
  directory: string,
  filenames: string[],
): Promise<ArtifactHash[]> =>
  Promise.all(filenames.sort().map((filename) => hashFile(join(directory, filename))));
