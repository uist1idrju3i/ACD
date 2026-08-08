import type { BoardTrack, BoardVia } from "@acd/graph-core";
import { KicadProjectionError } from "./errors.js";

type SesAtom = { kind: "atom"; value: string };
type SesList = { kind: "list"; values: SesValue[] };
type SesValue = SesAtom | SesList;

export type SesRawTrack = {
  netName: string;
  layer: string;
  width: number;
  points: { x: number; y: number }[];
};

export type SesRawVia = {
  netName: string;
  padstack: string;
  x: number;
  y: number;
};

export type SesRouteProvenance = {
  resolutionUnit: "um";
  resolution: number;
  rawTracks: SesRawTrack[];
  rawVias: SesRawVia[];
};

export type SesRouteModel = {
  tracks: BoardTrack[];
  vias: BoardVia[];
  provenance: SesRouteProvenance;
};

const fail = (message: string): never => {
  throw new KicadProjectionError(`invalid Specctra SES: ${message}`);
};

const atom = (value: SesValue | undefined, where: string): string => {
  if (value === undefined) return fail(`${where} is missing`);
  if (value.kind !== "atom") return fail(`${where} must be an atom`);
  return value.value;
};

const numberAtom = (value: SesValue | undefined, where: string): number => {
  const text = atom(value, where);
  if (!/^-?\d+$/.test(text)) fail(`${where} must be an integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) fail(`${where} exceeds safe integer range`);
  return parsed;
};

const tokenize = (source: string): string[] => {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === undefined) return fail("unexpected end of input");
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push(character);
      index += 1;
      continue;
    }
    if (character === '"') {
      let token = "";
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === "\\") {
          const escaped = source[index + 1];
          if (escaped === undefined) fail("unterminated quoted atom");
          token += escaped;
          index += 2;
          continue;
        }
        if (current === '"') break;
        token += current;
        index += 1;
      }
      if (source[index] !== '"') fail("unterminated quoted atom");
      tokens.push(token);
      index += 1;
      continue;
    }
    const start = index;
    while (index < source.length) {
      const current = source[index];
      if (current === undefined || /[\s()]/.test(current)) break;
      index += 1;
    }
    tokens.push(source.slice(start, index));
  }
  return tokens;
};

const parseSExpression = (source: string): SesList => {
  const tokens = tokenize(source);
  let index = 0;
  const parseValue = (): SesValue => {
    const token = tokens[index];
    if (token === undefined) fail("unexpected end of input");
    if (token !== "(") {
      if (token === ")") fail("unexpected closing parenthesis");
      index += 1;
      return { kind: "atom", value: token ?? fail("missing atom") };
    }
    index += 1;
    const values: SesValue[] = [];
    while (tokens[index] !== ")") {
      if (tokens[index] === undefined) fail("unclosed list");
      values.push(parseValue());
    }
    index += 1;
    return { kind: "list", values };
  };
  const root = parseValue();
  if (index !== tokens.length) fail("trailing tokens");
  if (root.kind !== "list") return fail("root must be a list");
  return root;
};

const childLists = (value: SesList, name: string): SesList[] =>
  value.values
    .filter((candidate): candidate is SesList => candidate.kind === "list")
    .filter((candidate) => candidate.values[0]?.kind === "atom")
    .filter((candidate) => atom(candidate.values[0], `${name} child`) === name);

const firstChild = (value: SesList, name: string): SesList => {
  const match = childLists(value, name)[0];
  if (!match) return fail(`missing ${name}`);
  return match;
};

const convertCoordinate = (value: number, resolution: number, where: string): number => {
  const nanometersNumerator = value * 1_000_000;
  const denominator = resolution * 1_000;
  if (!Number.isSafeInteger(nanometersNumerator) || nanometersNumerator % denominator !== 0) {
    fail(`${where} cannot be represented at 1 nm resolution`);
  }
  return nanometersNumerator / denominator / 1_000_000;
};

const convertDimension = (value: number, resolution: number, where: string): number =>
  convertCoordinate(value, resolution, where);

const parseResolution = (root: SesList): number => {
  const routes = firstChild(root, "routes");
  const resolution = firstChild(routes, "resolution");
  if (atom(resolution.values[1], "routes.resolution.unit") !== "um") {
    fail("routes.resolution.unit must be um");
  }
  const value = numberAtom(resolution.values[2], "routes.resolution.value");
  if (value !== 10) fail(`unsupported routes.resolution ${value}; expected 10`);
  return value;
};

const parsePadstacks = (
  root: SesList,
  resolution: number,
): Map<string, { diameter: number; drill: number; layers: string[] }> => {
  const routes = firstChild(root, "routes");
  const libraryOut = firstChild(routes, "library_out");
  const result = new Map<string, { diameter: number; drill: number; layers: string[] }>();
  for (const padstack of childLists(libraryOut, "padstack")) {
    if (padstack.values.length < 2) fail("padstack is missing a name");
    const name = atom(padstack.values[1], "padstack.name");
    const shapeValues = childLists(padstack, "shape");
    const circles = shapeValues.flatMap((shape) => childLists(shape, "circle"));
    const layers: string[] = [];
    let diameter: number | undefined;
    for (const circle of circles) {
      if (circle.values.length < 3) fail(`padstack ${name} has malformed circle`);
      const layer = atom(circle.values[1], `padstack ${name} layer`);
      const candidateDiameter = numberAtom(circle.values[2], `padstack ${name} diameter`);
      if (diameter !== undefined && diameter !== candidateDiameter) {
        fail(`padstack ${name} has inconsistent diameters`);
      }
      diameter = candidateDiameter;
      layers.push(layer);
    }
    const match = /^Via\[0-1\]_(\d+):(\d+)_um$/.exec(name);
    if (!match) return fail(`unsupported padstack ${name}`);
    if (diameter === undefined || layers.length === 0) {
      return fail(`unsupported padstack ${name}`);
    }
    const expectedDiameter = Number(match[1]) * resolution;
    const expectedDrill = Number(match[2]) * resolution;
    if (diameter !== expectedDiameter) fail(`padstack ${name} diameter disagrees with its name`);
    const definition = {
      diameter,
      drill: expectedDrill,
      layers: [...new Set(layers)].sort(),
    };
    const existing = result.get(name);
    if (
      existing &&
      (existing.diameter !== definition.diameter ||
        existing.drill !== definition.drill ||
        existing.layers.join(",") !== definition.layers.join(","))
    ) {
      return fail(`conflicting padstack ${name}`);
    }
    result.set(name, definition);
  }
  if (result.size === 0) fail("no padstacks found");
  return result;
};

const parsePointList = (values: SesValue[], where: string): { x: number; y: number }[] => {
  const coordinates = values.slice(3);
  if (coordinates.length === 0 || coordinates.length % 2 !== 0) {
    fail(`${where} must contain at least two complete points`);
  }
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < coordinates.length; index += 2) {
    points.push({
      x: numberAtom(coordinates[index], `${where}[${index}]`),
      y: numberAtom(coordinates[index + 1], `${where}[${index + 1}]`),
    });
  }
  if (points.length < 2) fail(`${where} must contain at least two points`);
  return points;
};

export const parseSpecctraSes = (
  source: string,
  resolveNetId: (netName: string) => string,
): SesRouteModel => {
  const root = parseSExpression(source);
  if (atom(root.values[0], "root.name") !== "session") fail("root must be session");
  const resolution = parseResolution(root);
  const padstacks = parsePadstacks(root, resolution);
  const networkOut = firstChild(firstChild(root, "routes"), "network_out");
  const netNames = new Set<string>();
  const tracks: BoardTrack[] = [];
  const vias: BoardVia[] = [];
  const rawTracks: SesRawTrack[] = [];
  const rawVias: SesRawVia[] = [];

  for (const net of childLists(networkOut, "net")) {
    if (net.values.length < 2) fail("net is missing a name");
    const netName = atom(net.values[1], "net.name");
    if (netNames.has(netName)) fail(`duplicate net name ${netName}`);
    netNames.add(netName);
    const netId = resolveNetId(netName);
    if (!netId) fail(`net ${netName} could not be resolved`);
    for (const wire of childLists(net, "wire")) {
      const paths = childLists(wire, "path");
      if (paths.length === 0) fail(`net ${netName} wire has no path`);
      for (const path of paths) {
        if (path.values.length < 3) fail(`net ${netName} path is malformed`);
        const layer = atom(path.values[1], `net ${netName} layer`);
        if (layer !== "F.Cu" && layer !== "B.Cu") fail(`unknown layer ${layer}`);
        const width = numberAtom(path.values[2], `net ${netName} width`);
        const rawPoints = parsePointList(path.values, `net ${netName} path`);
        rawTracks.push({ netName, layer, width, points: rawPoints });
        for (let index = 0; index < rawPoints.length - 1; index += 1) {
          const start = rawPoints[index];
          const end = rawPoints[index + 1];
          if (!start || !end) return fail(`net ${netName} path has an invalid point pair`);
          tracks.push({
            netId,
            layer,
            widthMm: convertDimension(width, resolution, `net ${netName} width`),
            startMm: {
              xMm: convertCoordinate(start.x, resolution, `net ${netName} start.x`),
              yMm: -convertCoordinate(start.y, resolution, `net ${netName} start.y`),
            },
            endMm: {
              xMm: convertCoordinate(end.x, resolution, `net ${netName} end.x`),
              yMm: -convertCoordinate(end.y, resolution, `net ${netName} end.y`),
            },
          });
        }
      }
    }
    for (const via of childLists(net, "via")) {
      if (via.values.length !== 4) fail(`net ${netName} via is malformed`);
      const padstack = atom(via.values[1], `net ${netName} via.padstack`);
      const definition = padstacks.get(padstack);
      if (!definition) return fail(`unknown padstack ${padstack}`);
      const padstackDefinition = definition;
      const x = numberAtom(via.values[2], `net ${netName} via.x`);
      const y = numberAtom(via.values[3], `net ${netName} via.y`);
      rawVias.push({ netName, padstack, x, y });
      vias.push({
        netId,
        atMm: {
          xMm: convertCoordinate(x, resolution, `net ${netName} via.x`),
          yMm: -convertCoordinate(y, resolution, `net ${netName} via.y`),
        },
        diameterMm: convertDimension(
          padstackDefinition.diameter,
          resolution,
          `padstack ${padstack}`,
        ),
        drillMm: convertDimension(
          padstackDefinition.drill,
          resolution,
          `padstack ${padstack}.drill`,
        ),
        layers: padstackDefinition.layers,
      });
    }
  }

  const trackKey = (track: BoardTrack): string =>
    [
      track.netId,
      track.layer,
      track.startMm.xMm,
      track.startMm.yMm,
      track.endMm.xMm,
      track.endMm.yMm,
      track.widthMm,
    ].join("\u0000");
  const viaKey = (via: BoardVia): string =>
    [via.netId, via.atMm.xMm, via.atMm.yMm, via.diameterMm, via.drillMm, via.layers.join(",")].join(
      "\u0000",
    );
  const compareKeys = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  tracks.sort((left, right) => compareKeys(trackKey(left), trackKey(right)));
  vias.sort((left, right) => compareKeys(viaKey(left), viaKey(right)));

  return {
    tracks,
    vias,
    provenance: {
      resolutionUnit: "um",
      resolution,
      rawTracks,
      rawVias,
    },
  };
};
