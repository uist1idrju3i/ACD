import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [fixtureFile, netlistFile, ipcFile, outputFile] = process.argv.slice(2);
if (!fixtureFile || !netlistFile || !ipcFile) {
  throw new Error("usage: compare-netlist.mjs FIXTURE NETLIST IPC356 [OUTPUT]");
}
const fixture = JSON.parse(await readFile(resolve(fixtureFile), "utf8"));
const netlist = await readFile(resolve(netlistFile), "utf8");
const ipc = await readFile(resolve(ipcFile), "utf8");
const references = new Map(fixture.parts.map((part) => [part.id, part.reference]));
const expected = fixture.nets
  .flatMap((net) => net.pins.map((pin) => `${net.name}:${references.get(pin.partId)}-${pin.pin}`))
  .sort();
const actualPcb = ipc
  .split("\n")
  .filter((line) => line.startsWith("327"))
  .map((line) => {
    const match = line.match(/^327(.+?)\s{2,}(\S+)\s+-([0-9]+)/);
    return match ? `${match[1].trim()}:${match[2]}-${match[3]}` : null;
  })
  .filter(Boolean)
  .sort();
const actualSchematic = [...netlist.matchAll(/\(ref "([^"]+)"\)/g)].map((match) => match[1]).sort();
const result = {
  expectedGraphPins: expected,
  pcbPins: actualPcb,
  schematicReferences: actualSchematic,
  graphVsPcb:
    expected.length === actualPcb.length &&
    expected.every((pin, index) => pin === actualPcb[index]),
  graphVsSchematic: actualSchematic.length === fixture.parts.length,
};
result.overall = result.graphVsPcb && result.graphVsSchematic;
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputFile) await writeFile(resolve(outputFile), serialized, "utf8");
process.stdout.write(serialized);
process.exitCode = result.overall ? 0 : 1;
