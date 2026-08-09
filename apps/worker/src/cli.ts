import { startWorkerServer } from "./index.js";
import { readFile } from "node:fs/promises";

const rootArgument = process.argv.find((value) => value.startsWith("--root="));
const portArgument = process.argv.find((value) => value.startsWith("--port="));
const runRoot = rootArgument?.slice("--root=".length) ?? ".acd/runs/browser-fixture";
const port = portArgument ? Number(portArgument.slice("--port=".length)) : 4174;
const graphArgument = process.argv.find((value) => value.startsWith("--graph="));
const graph = graphArgument
  ? (JSON.parse(
      await readFile(graphArgument.slice("--graph=".length), "utf8"),
    ) as import("@acd/graph-core").DesignGraph)
  : undefined;

const main = async (): Promise<void> => {
  await startWorkerServer({
    runRoot,
    port,
    ...(graph ? { graph } : {}),
  });
  process.stdout.write(`worker listening on ${port}\n`);
};

void main();
