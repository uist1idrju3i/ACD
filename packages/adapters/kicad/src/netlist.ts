import type { Phase1Fixture } from "@acd/schema";
import { GraphCoreError } from "@acd/graph-core";

export type CanonicalPin = {
  reference: string;
  pin: string;
  net: string;
};

export type NetlistComparison = {
  expected: CanonicalPin[];
  expectedPcb: CanonicalPin[];
  schematic: CanonicalPin[];
  pcb: CanonicalPin[];
  graphVsSchematic: boolean;
  graphVsPcb: boolean;
  overall: boolean;
};

const sorted = (pins: CanonicalPin[]): CanonicalPin[] =>
  [...pins].sort((left, right) => {
    const leftKey = `${left.net}:${left.reference}-${left.pin}`;
    const rightKey = `${right.net}:${right.reference}-${right.pin}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

export const canonicalFixtureNetlist = (fixture: Phase1Fixture): CanonicalPin[] => {
  const references = new Map(fixture.parts.map((part) => [part.id, part.reference]));
  return sorted(
    fixture.nets.flatMap((net) =>
      net.pins.map((pin) => {
        const reference = references.get(pin.partId);
        if (!reference) {
          throw new GraphCoreError("reference-integrity", `unknown part ${pin.partId}`);
        }
        return { net: net.name, reference, pin: pin.pin };
      }),
    ),
  );
};

export const canonicalFixturePcbNetlist = (fixture: Phase1Fixture): CanonicalPin[] => {
  const references = new Map(fixture.parts.map((part) => [part.id, part.reference]));
  const mappings = new Map(fixture.mappings.map((mapping) => [mapping.partId, mapping.pinPads]));
  return sorted(
    fixture.nets.flatMap((net) =>
      net.pins.map((pin) => {
        const reference = references.get(pin.partId);
        const pad = mappings.get(pin.partId)?.find((candidate) => candidate.pin === pin.pin)?.pad;
        if (!reference || !pad) {
          throw new GraphCoreError(
            "reference-integrity",
            `missing PCB mapping for ${pin.partId}:${pin.pin}`,
          );
        }
        return { net: net.name, reference, pin: pad };
      }),
    ),
  );
};

export const parseKicadNetlist = (netlist: string): CanonicalPin[] => {
  const pins: CanonicalPin[] = [];
  let cursor = 0;
  while (true) {
    const candidate = netlist.indexOf("(net", cursor);
    if (candidate < 0) break;
    if (!/\s/.test(netlist[candidate + 4] ?? "")) {
      cursor = candidate + 4;
      continue;
    }
    const start = candidate;
    let depth = 0;
    let end = start;
    for (; end < netlist.length; end += 1) {
      if (netlist[end] === "(") depth += 1;
      if (netlist[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const content = netlist.slice(start, end + 1);
    const name = content.match(/\(name "([^"]+)"\)/)?.[1]?.replace(/^\//, "");
    if (name) {
      for (const node of content.matchAll(/\(node\s+\(ref "([^"]+)"\)\s+\(pin "([^"]+)"\)/g)) {
        const [, reference, pin] = node;
        if (reference && pin) pins.push({ net: name, reference, pin });
      }
    }
    cursor = end + 1;
  }
  return sorted(pins);
};

export const parseIpc356 = (ipc: string): CanonicalPin[] => {
  const pins: CanonicalPin[] = [];
  for (const line of ipc.split(/\r?\n/)) {
    if (!line.startsWith("317") && !line.startsWith("327")) continue;
    const match = line.match(/^3(?:17|27)(.+?)\s{2,}(\S+)\s+-([A-Za-z0-9]+)/);
    if (match) {
      const [, net, reference, pin] = match;
      if (net && reference && pin) pins.push({ net: net.trim(), reference, pin });
    }
  }
  return sorted(pins);
};

const equal = (left: CanonicalPin[], right: CanonicalPin[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const compareNetlists = (
  fixture: Phase1Fixture,
  schematicNetlist: string,
  ipc356: string,
): NetlistComparison => {
  const expected = canonicalFixtureNetlist(fixture);
  const expectedPcb = canonicalFixturePcbNetlist(fixture);
  const schematic = parseKicadNetlist(schematicNetlist);
  const pcb = parseIpc356(ipc356);
  return {
    expected,
    expectedPcb,
    schematic,
    pcb,
    graphVsSchematic: equal(expected, schematic),
    graphVsPcb: equal(expectedPcb, pcb),
    overall: equal(expected, schematic) && equal(expectedPcb, pcb),
  };
};
